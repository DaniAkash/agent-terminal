//! `AgentStateMod` — the agent-state engine.
//!
//! Fuses three signals into one effective per-tab state so a missed hook edge
//! self-heals rather than sticking forever:
//!
//! - **hooks** (`on_hook_event`): precise lifecycle transitions, primary source.
//! - **OSC** (`on_output`): the agent's own window title / progress (Claude,
//!   Codex), a continuous corrector for stale hook state.
//! - **floor** (`on_agent_detected`/`on_agent_cleared` + OSC 133): agent-agnostic
//!   process liveness and shell-prompt return. Releases any stuck active state
//!   to Idle, for every agent including hook-less ones.
//!
//! A per-tab reconcile tick recomputes on a timer so time-based corrections
//! (OSC idle held past a threshold, long PTY silence) fire even when no further
//! event arrives. The arbiter (`effective_state`) is a pure function.
//!
//! Frontend contract is unchanged: emits `("agent_turn", "agent_state_changed",
//! { state, message? })` with `state ∈ {idle, in-progress, awaiting, completed}`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::agents::{self, OscState, OscView};
use crate::hook_server::HookPayload;
use crate::mod_engine::osc_parser::OscParser;
use crate::mod_engine::{AsyncEmitter, Mod, ModContext};
use crate::notifications::{AgentNotifyState, NotificationService};

/// Reconcile tick interval. Small enough that time-based corrections feel
/// prompt, large enough to be free.
const RECONCILE: Duration = Duration::from_millis(500);
/// How long OSC must report Idle before it stales a hook stuck in Working.
const OSC_STALE: Duration = Duration::from_millis(1500);
/// Last-resort backstop: Working with no PTY output and no OSC for this long
/// releases to Idle (covers hook-less, OSC-less agents whose stop was missed).
const PTY_SILENCE: Duration = Duration::from_secs(20);

// ─── State model ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentState {
    Idle,
    Working,
    Blocked,
    Completed,
}

impl AgentState {
    fn wire(self) -> &'static str {
        match self {
            AgentState::Idle => "idle",
            AgentState::Working => "in-progress",
            AgentState::Blocked => "awaiting",
            AgentState::Completed => "completed",
        }
    }

    fn notify(self) -> AgentNotifyState {
        match self {
            AgentState::Idle => AgentNotifyState::Idle,
            AgentState::Working => AgentNotifyState::InProgress,
            AgentState::Blocked => AgentNotifyState::Awaiting,
            AgentState::Completed => AgentNotifyState::Completed,
        }
    }
}

/// Per-tab fused state. Lives behind an `Arc<Mutex<…>>` so the sync mod
/// callbacks and the async reconcile tick share one copy.
struct TabState {
    /// Which agent occupies this tab (drives the OSC signature). Set by the
    /// first hook or process detection; `None` means no agent, engine idle.
    agent_id: Option<String>,

    // hook channel
    hook_state: AgentState,
    awaiting_message: Option<String>,
    completed_message: Option<String>,
    pending_question: Option<String>,

    // osc channel
    parser: OscParser,
    osc_title: String,
    osc_progress: String,
    osc: Option<(OscState, Instant)>,

    // floor
    proc_alive: bool,
    prompt_returned: bool,
    last_activity: Instant,

    // last state pushed to the frontend
    emitted: Option<AgentState>,
}

impl TabState {
    fn new(now: Instant) -> Self {
        Self {
            agent_id: None,
            hook_state: AgentState::Idle,
            awaiting_message: None,
            completed_message: None,
            pending_question: None,
            parser: OscParser::new(),
            osc_title: String::new(),
            osc_progress: String::new(),
            osc: None,
            proc_alive: false,
            prompt_returned: false,
            last_activity: now,
            emitted: None,
        }
    }

    /// Recompute the OSC-derived state from the current title/progress using the
    /// occupying agent's signature. Only bumps the timestamp when the value
    /// changes, so the "held past OSC_STALE" check measures real dwell time.
    fn recompute_osc(&mut self, now: Instant) {
        let derived = self
            .agent_id
            .as_deref()
            .and_then(agents::by_id)
            .and_then(|p| p.osc)
            .and_then(|f| f(&OscView { title: &self.osc_title, progress: &self.osc_progress }));
        match (derived, self.osc) {
            (Some(s), Some((cur, _))) if s == cur => {}
            (Some(s), _) => self.osc = Some((s, now)),
            (None, _) => self.osc = None,
        }
    }

    fn inputs(&self) -> Inputs {
        Inputs {
            hook: self.hook_state,
            osc: self.osc,
            proc_alive: self.proc_alive,
            prompt_returned: self.prompt_returned,
            last_activity: self.last_activity,
        }
    }

    /// Clean slate for the next session in the same tab (after the agent exits).
    fn reset(&mut self) {
        self.agent_id = None;
        self.hook_state = AgentState::Idle;
        self.awaiting_message = None;
        self.completed_message = None;
        self.pending_question = None;
        self.osc_title.clear();
        self.osc_progress.clear();
        self.osc = None;
        self.prompt_returned = false;
        self.emitted = None;
        // Drop any half-parsed OSC sequence so bytes buffered at agent exit
        // cannot leak into the next session's parse.
        self.parser = OscParser::new();
    }
}

// ─── The arbiter (pure) ─────────────────────────────────────────────────────────

struct Inputs {
    hook: AgentState,
    osc: Option<(OscState, Instant)>,
    proc_alive: bool,
    prompt_returned: bool,
    last_activity: Instant,
}

/// Fuse the three channels into one effective state.
///
/// Order matters. The agent-agnostic floor resolves stuck states first; it can
/// only ever release an active state to Idle (never invent Working), which is
/// the safe direction. Then OSC corrects within a live session. The hook wins by
/// default; `Completed` is hook-only.
fn effective_state(i: &Inputs, now: Instant) -> AgentState {
    // FLOOR: a dead process or a returned shell prompt cannot be active.
    if !i.proc_alive || i.prompt_returned {
        return AgentState::Idle;
    }
    // OSC blocker beats a stale or absent hook (Codex "Action Required").
    if matches!(i.osc, Some((OscState::Blocked, _))) {
        return AgentState::Blocked;
    }
    // OSC working corrects a hook that thinks we are idle/done.
    if matches!(i.osc, Some((OscState::Working, _)))
        && matches!(i.hook, AgentState::Idle | AgentState::Completed)
    {
        return AgentState::Working;
    }
    // OSC idle, held past the threshold, stales a hook stuck in Working.
    if let Some((OscState::Idle, at)) = i.osc {
        if i.hook == AgentState::Working && now.duration_since(at) > OSC_STALE {
            return AgentState::Idle;
        }
    }
    // Backstop for hook-less + OSC-less agents: long silence under Working.
    if i.hook == AgentState::Working
        && i.osc.is_none()
        && now.duration_since(i.last_activity) > PTY_SILENCE
    {
        return AgentState::Idle;
    }
    i.hook
}

/// A lone ESC or Ctrl-C: the user reaching for "stop".
///
/// Matched as an exact single byte on purpose. Navigation keys arrive as
/// multi-byte escape sequences (arrow keys send `ESC [ A`), so requiring the
/// lone byte keeps ordinary cursor movement from reading as a cancel.
fn is_interrupt_key(data: &[u8]) -> bool {
    matches!(data, [0x1b] | [0x03])
}

/// Recompute the effective state and, if it changed, push it to the frontend
/// and fire a notification. Shared by the sync callbacks and the reconcile tick.
fn reconcile(
    st: &mut TabState,
    emitter: &AsyncEmitter,
    notifications: &Option<Arc<NotificationService>>,
    now: Instant,
) {
    // Only manage state while an agent occupies the tab.
    let Some(agent_id) = st.agent_id.clone() else { return };

    let eff = effective_state(&st.inputs(), now);
    if st.emitted == Some(eff) {
        return;
    }
    st.emitted = Some(eff);

    let message = match eff {
        AgentState::Blocked => st.awaiting_message.clone(),
        AgentState::Completed => st.completed_message.clone(),
        _ => None,
    };

    let mut data = serde_json::json!({ "state": eff.wire() });
    if let Some(m) = &message {
        data["message"] = serde_json::Value::String(m.clone());
    }
    emitter.emit("agent_turn", "agent_state_changed", data);

    if let Some(svc) = notifications {
        svc.clone().maybe_notify(emitter.tab_id.clone(), agent_id, eff.notify(), message);
    }
}

// ─── Mod ────────────────────────────────────────────────────────────────────────

struct TabHandle {
    state: Arc<Mutex<TabState>>,
    emitter: AsyncEmitter,
    /// Reconcile tick. `None` only in unit tests (no runtime to spawn on).
    tick: Option<tokio::task::JoinHandle<()>>,
}

pub struct AgentStateMod {
    tabs: HashMap<String, TabHandle>,
    /// session_id → tab_id, for hook events that arrive with only a session id
    /// (a forked subprocess that lost `AGENT_TERMINAL_TAB_ID`).
    session_tabs: HashMap<String, String>,
    notifications: Option<Arc<NotificationService>>,
}

impl AgentStateMod {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
            session_tabs: HashMap::new(),
            notifications: None,
        }
    }

    pub fn with_notifications(mut self, service: Arc<NotificationService>) -> Self {
        self.notifications = Some(service);
        self
    }

    /// Resolve a hook payload to a tab we own: authoritative env-var `tab_id`
    /// first, then the `session_id` map established by an earlier event.
    fn tab_id_for(&self, payload: &HookPayload) -> Option<String> {
        if let Some(tid) = payload.tab_id.as_deref().filter(|s| !s.is_empty()) {
            if self.tabs.contains_key(tid) {
                return Some(tid.to_string());
            }
        }
        if let Some(sid) = payload.session_id.as_deref().filter(|s| !s.is_empty()) {
            if let Some(tid) = self.session_tabs.get(sid) {
                return Some(tid.clone());
            }
        }
        None
    }
}

impl Default for AgentStateMod {
    fn default() -> Self {
        Self::new()
    }
}

impl Mod for AgentStateMod {
    fn id(&self) -> &'static str {
        "agent_state"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let emitter = ctx.async_emitter();
        let state = Arc::new(Mutex::new(TabState::new(Instant::now())));

        let tick_state = state.clone();
        let tick_emitter = emitter.clone();
        let tick_notifications = self.notifications.clone();
        let tick = tokio::spawn(async move {
            let mut interval = tokio::time::interval(RECONCILE);
            loop {
                interval.tick().await;
                let mut st = tick_state.lock().unwrap();
                reconcile(&mut st, &tick_emitter, &tick_notifications, Instant::now());
            }
        });

        self.tabs.insert(
            ctx.tab_id.to_string(),
            TabHandle { state, emitter, tick: Some(tick) },
        );
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let Some(handle) = self.tabs.get(ctx.tab_id) else { return };
        let now = Instant::now();
        let mut st = handle.state.lock().unwrap();
        st.last_activity = now;

        for seq in st.parser.feed(data) {
            match seq.code {
                // OSC 0/1: window title.
                0 | 1 => st.osc_title = seq.arg,
                // OSC 9: progress.
                9 => st.osc_progress = seq.arg,
                // OSC 133: shell prompt lifecycle. A/D = shell at prompt or a
                // command finished (agent handed control back). B = a command
                // (the agent) is running.
                133 => {
                    if seq.arg.starts_with('A') || seq.arg.starts_with('D') {
                        st.prompt_returned = true;
                    } else if seq.arg.starts_with('B') {
                        st.prompt_returned = false;
                    }
                }
                _ => {}
            }
        }

        st.recompute_osc(now);
        reconcile(&mut st, &handle.emitter, &self.notifications, now);
    }

    /// Cancellation channel. Agents flagged `interrupt_ends_turn` abandon a turn
    /// on ESC without firing their completion event, so the keypress is the only
    /// evidence the turn ended. Releases to Idle rather than Completed: a
    /// cancelled turn produced no result and must not show as finished.
    ///
    /// Guessing wrong is self-correcting, since the next hook event restores
    /// Working. A missed cancellation is not: it pins the tab to Working until
    /// the next prompt.
    fn on_input(&mut self, data: &[u8], ctx: &ModContext) {
        if !is_interrupt_key(data) {
            return;
        }
        let Some(handle) = self.tabs.get(ctx.tab_id) else { return };
        let mut st = handle.state.lock().unwrap();
        if st.hook_state != AgentState::Working {
            return;
        }
        let ends_turn = st
            .agent_id
            .as_deref()
            .and_then(agents::by_id)
            .is_some_and(|p| p.interrupt_ends_turn);
        if !ends_turn {
            return;
        }
        st.hook_state = AgentState::Idle;
        st.pending_question = None;
        reconcile(&mut st, &handle.emitter, &self.notifications, Instant::now());
    }

    fn on_agent_detected(&mut self, agent: &str, _cwd: &str, _cmd: &str, ctx: &ModContext) {
        if agents::by_id(agent).is_none() {
            return;
        }
        let Some(handle) = self.tabs.get(ctx.tab_id) else { return };
        let mut st = handle.state.lock().unwrap();
        st.agent_id = Some(agent.to_string());
        st.proc_alive = true;
        st.prompt_returned = false;
        reconcile(&mut st, &handle.emitter, &self.notifications, Instant::now());
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agents::by_id(agent).is_none() {
            return;
        }
        let Some(handle) = self.tabs.get(ctx.tab_id) else { return };
        let mut st = handle.state.lock().unwrap();
        // Floor: the agent process is gone → release to Idle immediately.
        st.proc_alive = false;
        reconcile(&mut st, &handle.emitter, &self.notifications, Instant::now());
        st.reset();
        // Drop any session mappings pointing at this tab so a late, stray hook
        // cannot resurrect the finished session.
        self.session_tabs.retain(|_, t| t != ctx.tab_id);
        if let Some(svc) = &self.notifications {
            svc.cancel(ctx.tab_id);
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(handle) = self.tabs.remove(ctx.tab_id) {
            if let Some(tick) = handle.tick {
                tick.abort();
            }
        }
        self.session_tabs.retain(|_, t| t != ctx.tab_id);
    }

    fn on_hook_event(&mut self, payload: &HookPayload) {
        // Registry-gated: only known agents, only tabs we own.
        let Some(profile) = agents::by_id(&payload.agent) else { return };
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        // Repair the missed-SessionStart cascade: any event that resolves a tab
        // (re)establishes the session→tab mapping, so one dropped SessionStart
        // never orphans the rest of the session. An empty session id is treated
        // as absent so it can never become a shared, cross-tab key.
        if let Some(sid) = payload.session_id.as_deref().filter(|s| !s.is_empty()) {
            self.session_tabs.entry(sid.to_string()).or_insert_with(|| tab_id.clone());
        }

        // AskUserQuestion is special: stash the question, do not change state.
        if payload.event == "PreToolUse" && payload.tool_name.as_deref() == Some("AskUserQuestion") {
            if let Some(msg) = payload.message.clone().filter(|m| !m.trim().is_empty()) {
                if let Some(handle) = self.tabs.get(&tab_id) {
                    handle.state.lock().unwrap().pending_question = Some(msg);
                }
            }
            return;
        }

        let Some(role) = profile.event_role(&payload.event) else { return };
        let Some(handle) = self.tabs.get(&tab_id) else { return };

        // Stop/Completed reads the transcript asynchronously, then reconciles.
        if matches!(role, crate::agents::EventRole::Completed) {
            let state = handle.state.clone();
            let emitter = handle.emitter.clone();
            let notifications = self.notifications.clone();
            let direct = payload.last_assistant_message.clone().filter(|m| !m.trim().is_empty());
            let transcript = payload.transcript_path.clone();
            tokio::spawn(async move {
                let message = if let Some(m) = direct {
                    Some(m)
                } else if let Some(path) = transcript {
                    read_last_assistant_message(&path).await
                } else {
                    None
                };
                let truncated = message.map(|m| m.chars().take(200).collect::<String>());
                let mut st = state.lock().unwrap();
                st.completed_message = truncated;
                st.hook_state = AgentState::Completed;
                reconcile(&mut st, &emitter, &notifications, Instant::now());
            });
            return;
        }

        let mut st = handle.state.lock().unwrap();
        st.agent_id.get_or_insert_with(|| payload.agent.clone());

        use crate::agents::EventRole;
        match role {
            EventRole::SessionStart => {
                st.proc_alive = true;
                st.prompt_returned = false;
                st.hook_state = AgentState::Idle;
            }
            EventRole::Working => {
                st.proc_alive = true;
                st.prompt_returned = false;
                st.pending_question = None;
                st.hook_state = AgentState::Working;
            }
            EventRole::Blocked => {
                st.proc_alive = true;
                let message = st
                    .pending_question
                    .take()
                    .or_else(|| payload.prompt.clone().filter(|m| !m.trim().is_empty()))
                    .or_else(|| payload.message.clone().filter(|m| !m.trim().is_empty()))
                    .or_else(|| Some("Needs your attention".to_string()));
                st.awaiting_message = message;
                st.hook_state = AgentState::Blocked;
            }
            EventRole::Idle => {
                st.proc_alive = true;
                st.awaiting_message = None;
                st.hook_state = AgentState::Idle;
            }
            EventRole::SessionEnd => {
                st.hook_state = AgentState::Idle;
                st.awaiting_message = None;
                st.completed_message = None;
                if let Some(sid) = payload.session_id.as_deref().filter(|s| !s.is_empty()) {
                    self.session_tabs.remove(sid);
                }
            }
            EventRole::Completed => unreachable!("handled above"),
        }
        reconcile(&mut st, &handle.emitter, &self.notifications, Instant::now());
    }
}

// ─── Transcript reader ────────────────────────────────────────────────────────

/// Reads the last assistant message from a Claude session JSONL transcript.
///
/// Iterates lines in reverse and returns the first valid assistant message
/// found. Lines that fail to parse OR don't match the assistant-message shape
/// are skipped — we keep scanning earlier lines instead of aborting. Claude's
/// JSONL transcripts mix entry types (user, assistant, tool_use, system,
/// summary, etc.), so it's normal for the trailing lines near EOF to be
/// non-assistant entries. Using `?` on per-line `Option`s here would bail out
/// on the first such line and miss every assistant message before it.
async fn read_last_assistant_message(transcript_path: &str) -> Option<String> {
    let content = tokio::fs::read_to_string(transcript_path).await.ok()?;

    for line in content.lines().rev() {
        let entry: serde_json::Value = match serde_json::from_str(line) {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let Some(message) = entry.get("message") else { continue };
        let Some(role) = message.get("role").and_then(|r| r.as_str()) else { continue };
        if role != "assistant" {
            continue;
        }

        let content_val = &message["content"];
        let text = if let Some(s) = content_val.as_str() {
            s.to_string()
        } else if let Some(arr) = content_val.as_array() {
            arr.iter()
                .filter_map(|c| {
                    if c.get("type")?.as_str()? == "text" {
                        c.get("text")?.as_str().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            continue;
        };

        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    None
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hook_server::HookPayload;
    use crate::mod_engine::{AgentSignal, AsyncEmitter, CwdUpdate, Mod, ModContext, ModEvent};
    use std::time::{Duration, Instant};
    use tokio::sync::mpsc;

    /// Owns real engine channels so tests can build a genuine `ModContext`
    /// (the mod only reads `ctx.tab_id`, but the constructor needs the wiring).
    struct CtxHarness {
        ev_tx: mpsc::Sender<ModEvent>,
        _ev_rx: mpsc::Receiver<ModEvent>,
        cwd_tx: mpsc::Sender<CwdUpdate>,
        _cwd_rx: mpsc::Receiver<CwdUpdate>,
        agent_tx: mpsc::UnboundedSender<AgentSignal>,
        _agent_rx: mpsc::UnboundedReceiver<AgentSignal>,
    }

    impl CtxHarness {
        fn new() -> Self {
            let (ev_tx, _ev_rx) = mpsc::channel(64);
            let (cwd_tx, _cwd_rx) = mpsc::channel(64);
            let (agent_tx, _agent_rx) = mpsc::unbounded_channel();
            Self { ev_tx, _ev_rx, cwd_tx, _cwd_rx, agent_tx, _agent_rx }
        }

        fn ctx<'a>(&'a self, tab_id: &'a str) -> ModContext<'a> {
            ModContext::new(tab_id, &self.ev_tx, &self.cwd_tx, &self.agent_tx, None, 0)
        }
    }

    // ── Arbiter: pure, time-controlled ───────────────────────────────────────

    fn inputs(
        hook: AgentState,
        osc: Option<(OscState, Instant)>,
        proc_alive: bool,
        prompt_returned: bool,
        last_activity: Instant,
    ) -> Inputs {
        Inputs { hook, osc, proc_alive, prompt_returned, last_activity }
    }

    #[test]
    fn floor_process_gone_forces_idle() {
        let now = Instant::now();
        let i = inputs(AgentState::Working, None, false, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Idle);
    }

    #[test]
    fn floor_prompt_returned_forces_idle() {
        let now = Instant::now();
        let i = inputs(AgentState::Working, None, true, true, now);
        assert_eq!(effective_state(&i, now), AgentState::Idle);
    }

    #[test]
    fn osc_blocker_beats_hook() {
        let now = Instant::now();
        let i = inputs(AgentState::Working, Some((OscState::Blocked, now)), true, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Blocked);
    }

    #[test]
    fn osc_working_corrects_idle_hook() {
        let now = Instant::now();
        let i = inputs(AgentState::Idle, Some((OscState::Working, now)), true, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Working);
    }

    #[test]
    fn osc_idle_stales_stuck_working_hook() {
        let now = Instant::now();
        let held = now - Duration::from_secs(2); // past OSC_STALE (1.5s)
        let i = inputs(AgentState::Working, Some((OscState::Idle, held)), true, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Idle);
    }

    #[test]
    fn osc_idle_not_yet_stale_keeps_working() {
        let now = Instant::now();
        let held = now - Duration::from_millis(500); // under OSC_STALE
        let i = inputs(AgentState::Working, Some((OscState::Idle, held)), true, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Working);
    }

    #[test]
    fn pty_silence_backstop_releases_hookless_agent() {
        let now = Instant::now();
        let quiet_since = now - Duration::from_secs(21); // past PTY_SILENCE (20s)
        let i = inputs(AgentState::Working, None, true, false, quiet_since);
        assert_eq!(effective_state(&i, now), AgentState::Idle);
    }

    #[test]
    fn opinionless_osc_keeps_working_hook() {
        // An agent whose OSC carries no liveness signal (Claude 2.x: one static
        // title, no OSC 9) must leave the hook channel authoritative. When the
        // detector inferred Idle from that static title instead, this case took
        // the OSC_STALE branch and the in-progress badge never rendered.
        let now = Instant::now();
        // Past OSC_STALE (1.5s) and well under PTY_SILENCE (20s): the window
        // where the old permanent-Idle detector used to stale Working away.
        let active = now - Duration::from_secs(5);
        let i = inputs(AgentState::Working, None, true, false, active);
        assert_eq!(effective_state(&i, now), AgentState::Working);
    }

    #[test]
    fn hook_wins_by_default() {
        let now = Instant::now();
        let i = inputs(AgentState::Blocked, None, true, false, now);
        assert_eq!(effective_state(&i, now), AgentState::Blocked);
    }

    // ── Transcript reader (behavior preserved from the previous mod) ──────────

    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[tokio::test]
    async fn transcript_reader_skips_non_assistant_and_malformed_lines() {
        let pid = std::process::id();
        let path = write_temp(
            &format!("agent-terminal-state-transcript-{pid}.jsonl"),
            r#"{"message":{"role":"assistant","content":"earlier message"}}
{"message":{"role":"assistant","content":"the right answer"}}
{"message":{"role":"user","content":"a user line"}}
{"type":"summary","payload":42}
this line is not json at all
"#,
        );
        let got = read_last_assistant_message(path.to_str().unwrap()).await;
        assert_eq!(got.as_deref(), Some("the right answer"));
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn transcript_reader_handles_array_content() {
        let pid = std::process::id();
        let path = write_temp(
            &format!("agent-terminal-state-transcript-array-{pid}.jsonl"),
            r#"{"message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}
"#,
        );
        let got = read_last_assistant_message(path.to_str().unwrap()).await;
        assert_eq!(got.as_deref(), Some("hello world"));
        std::fs::remove_file(&path).ok();
    }

    // ── Mod-driven behavior ──────────────────────────────────────────────────

    fn payload(
        agent: &str,
        event: &str,
        tab_id: Option<&str>,
        session_id: Option<&str>,
    ) -> HookPayload {
        HookPayload {
            agent: agent.to_string(),
            event: event.to_string(),
            tab_id: tab_id.map(|s| s.to_string()),
            session_id: session_id.map(|s| s.to_string()),
            cwd: Some("/some/dir".to_string()),
            tool_name: None,
            message: None,
            transcript_path: None,
            last_assistant_message: None,
            prompt: None,
        }
    }

    /// Inserts a tab handle wired to a dummy channel, without a reconcile tick
    /// (no runtime needed). Returns the receiver so tests can inspect emissions.
    fn register_tab(m: &mut AgentStateMod, tab_id: &str) -> mpsc::Receiver<ModEvent> {
        let (tx, rx) = mpsc::channel::<ModEvent>(64);
        let emitter = AsyncEmitter::new_for_test(tab_id.to_string(), tx);
        let state = Arc::new(Mutex::new(TabState::new(Instant::now())));
        m.tabs.insert(tab_id.to_string(), TabHandle { state, emitter, tick: None });
        rx
    }

    fn drain_states(rx: &mut mpsc::Receiver<ModEvent>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if ev.event == "agent_state_changed" {
                if let Some(s) = ev.data.get("state").and_then(|v| v.as_str()) {
                    out.push(s.to_string());
                }
            }
        }
        out
    }

    #[test]
    fn gate_drops_payload_with_no_tab_id() {
        let mut m = AgentStateMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", None, Some("s-x")));
        assert!(m.session_tabs.is_empty(), "ungated payload must not map a session");
    }

    #[test]
    fn gate_drops_payload_with_unknown_tab_id() {
        let mut m = AgentStateMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-99"), Some("s-x")));
        assert!(m.session_tabs.is_empty());
    }

    #[test]
    fn gate_drops_unknown_agent() {
        let mut m = AgentStateMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("definitely-not-claude", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        assert!(m.session_tabs.is_empty());
    }

    #[test]
    fn gate_accepts_known_tab_and_emits_idle() {
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(m.session_tabs.get("s-y").map(String::as_str), Some("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);
    }

    #[test]
    fn empty_session_id_is_never_a_correlation_key() {
        // A payload can carry session_id == "" (e.g. a plugin fallback). It must
        // never become a shared key in session_tabs, or events with an empty id
        // and no tab_id could mis-route across tabs.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("opencode", "session_start", Some("proj:tab-1"), Some("")));
        assert!(m.session_tabs.is_empty(), "empty session id must not be mapped");
        // The event still resolved via tab_id and drove state.
        assert_eq!(drain_states(&mut rx), vec!["idle"]);
    }

    #[test]
    fn session_id_fallback_after_session_start() {
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        // Later event lost the env var: session_id alone must still resolve.
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", None, Some("s-y")));
        let states = drain_states(&mut rx);
        assert_eq!(states, vec!["idle", "in-progress"]);
    }

    // ── Regression: the exact stuck-state bug ────────────────────────────────

    #[test]
    fn dropped_stop_self_heals_to_idle() {
        // SessionStart + UserPromptSubmit, then the agent exits WITHOUT a Stop.
        // The process-gone floor must return the tab to idle.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        // No Stop hook fires; the process disappears.
        let h = CtxHarness::new();
        m.on_agent_cleared("claude-code", &h.ctx("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["idle"], "must self-heal to idle");
    }

    #[test]
    fn dropped_session_start_still_reaches_working() {
        // The SessionStart POST is lost; the first event we see is a Working
        // event carrying only tab_id. It must still advance, not stick at idle.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["in-progress"]);
        // And the session mapping was repaired for later session-only events.
        assert_eq!(m.session_tabs.get("s-y").map(String::as_str), Some("proj:tab-1"));
    }

    #[test]
    fn osc_working_corrects_idle_hook_end_to_end() {
        // Hook says idle (just SessionStart), but Claude paints a Braille
        // spinner in its title. OSC must correct the tab to working.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);

        // OSC 0 title with a U+2802 Braille prefix (spinner frame).
        let bytes = b"\x1b]0;\xe2\xa0\x82 Claude\x07";
        let h = CtxHarness::new();
        m.on_output(bytes, &h.ctx("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["in-progress"]);
    }

    #[test]
    fn interrupt_key_releases_a_cancelled_turn() {
        // Claude does not fire Stop when the user interrupts, so without this
        // channel the tab pulses as in-progress until the next prompt.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        let h = CtxHarness::new();
        m.on_input(b"\x1b", &h.ctx("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);
    }

    #[test]
    fn ctrl_c_also_releases_a_cancelled_turn() {
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        let h = CtxHarness::new();
        m.on_input(b"\x03", &h.ctx("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);
    }

    #[test]
    fn arrow_keys_are_not_a_cancel() {
        // ESC [ A and friends must not read as an interrupt, or ordinary cursor
        // movement would clear a live turn.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        let h = CtxHarness::new();
        for seq in [&b"\x1b[A"[..], b"\x1b[B", b"\x1bOP", b"hello"] {
            m.on_input(seq, &h.ctx("proj:tab-1"));
        }
        assert!(drain_states(&mut rx).is_empty(), "navigation must not change state");
    }

    #[test]
    fn interrupt_is_ignored_for_agents_that_report_their_own_cancel() {
        // Opt-in per agent: opencode is not flagged, so its hook stays the sole
        // authority and ESC must not move the tab.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("opencode", "session_start", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("opencode", "working", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        let h = CtxHarness::new();
        m.on_input(b"\x1b", &h.ctx("proj:tab-1"));
        assert!(drain_states(&mut rx).is_empty(), "unflagged agent must be untouched");
    }

    #[test]
    fn interrupt_does_not_disturb_an_idle_tab() {
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);

        let h = CtxHarness::new();
        m.on_input(b"\x1b", &h.ctx("proj:tab-1"));
        assert!(drain_states(&mut rx).is_empty());
    }

    #[test]
    fn osc133_prompt_return_forces_idle() {
        // Working per hook, then the shell prompt comes back (OSC 133;D): the
        // agent handed control to the shell, so the tab is idle even with no
        // Stop hook.
        let mut m = AgentStateMod::new();
        let mut rx = register_tab(&mut m, "proj:tab-1");
        m.on_hook_event(&payload("claude-code", "SessionStart", Some("proj:tab-1"), Some("s-y")));
        m.on_hook_event(&payload("claude-code", "UserPromptSubmit", Some("proj:tab-1"), Some("s-y")));
        assert_eq!(drain_states(&mut rx), vec!["idle", "in-progress"]);

        let h = CtxHarness::new();
        m.on_output(b"\x1b]133;D\x07", &h.ctx("proj:tab-1"));
        assert_eq!(drain_states(&mut rx), vec!["idle"]);
    }
}

