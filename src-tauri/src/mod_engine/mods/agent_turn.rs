//! `AgentTurnMod` — tracks the turn state of AI coding agent sessions via
//! structured hook events delivered by each agent's own hook system.
//!
//! State machine per session:
//!
//! ```text
//! SessionStart                                 → Idle
//! UserPromptSubmit / PreToolUse (non-question) → InProgress
//! PreToolUse (tool_name == "AskUserQuestion")  → saves question, state unchanged
//! Notification (Claude) | PermissionRequest (Codex) → Awaiting { message }
//! Stop                                         → Completed (async: reads transcript)
//! SessionEnd                                   → session removed, emit Idle to clear badge
//! ```
//!
//! Awaiting is dispatched from two different event names depending on the agent
//! — Claude calls it `Notification`, Codex calls it `PermissionRequest`. They
//! are functionally identical (agent is blocked, user attention required) and
//! funnel into a single `handle_awaiting` so the UI sees one state.
//!
//! The mod emits `agent_state_changed` events to the frontend, which writes
//! into `$tabMeta.agentState`. `deriveAgentState()` in `agent.helpers.ts`
//! reads this field and renders the correct badge/animation.

use std::collections::HashMap;
use std::sync::Arc;

use crate::hook_server::HookPayload;
use crate::mod_engine::{AsyncEmitter, Mod, ModContext};
use crate::notifications::{AgentNotifyState, NotificationService};

// ─── State types ─────────────────────────────────────────────────────────────

struct SessionState {
    tab_id: String,
    /// Saved from PreToolUse(AskUserQuestion) — used as the Awaiting message.
    pending_question: Option<String>,
}

// ─── Mod ─────────────────────────────────────────────────────────────────────

/// Tracks per-session agent turn state via hook events.
pub struct AgentTurnMod {
    /// tab_id → AsyncEmitter (populated on_open, removed on_close). Doubles
    /// as the registry of "tabs we own" — `on_hook_event` drops any payload
    /// whose `tab_id` isn't a key here.
    emitters: HashMap<String, AsyncEmitter>,
    /// session_id → SessionState (populated on SessionStart).
    sessions: HashMap<String, SessionState>,
    /// OS notification service. Optional so unit tests can construct a
    /// `AgentTurnMod` without a Tauri AppHandle. In production, set via
    /// `with_notifications` during engine wiring in `lib.rs`.
    notifications: Option<Arc<NotificationService>>,
}

impl AgentTurnMod {
    pub fn new() -> Self {
        Self {
            emitters: HashMap::new(),
            sessions: HashMap::new(),
            notifications: None,
        }
    }

    /// Builder-style: attach the notification service. Wired in `lib.rs` after
    /// the service is created with the AppHandle.
    pub fn with_notifications(mut self, service: Arc<NotificationService>) -> Self {
        self.notifications = Some(service);
        self
    }

    // ── Resolution helpers ────────────────────────────────────────────────────

    /// Resolves a tab_id from a hook payload.
    ///
    /// 1. **Authoritative**: `payload.tab_id` (sourced from
    ///    `$AGENT_TERMINAL_TAB_ID` by the hook script). Only accepted if the
    ///    tab id is in our `emitters` registry — i.e. a tab we actually own.
    /// 2. **Fallback**: `session_id` lookup — for events fired late in a
    ///    session lifecycle (e.g. `Stop`, `SessionEnd`) by an agent
    ///    subprocess that may have lost the env var across a fork. The
    ///    mapping was established at `SessionStart` from a known-good
    ///    `tab_id`, so this can't surface a session we don't own.
    ///
    /// CWD prefix matching is intentionally NOT used. It can't tell two
    /// terminals at the same path apart, which was the source of the
    /// cross-terminal-noise bug fixed here.
    fn tab_id_for(&self, payload: &HookPayload) -> Option<String> {
        if let Some(tid) = payload.tab_id.as_deref().filter(|s| !s.is_empty()) {
            if self.emitters.contains_key(tid) {
                return Some(tid.to_string());
            }
        }
        if let Some(sid) = &payload.session_id {
            if let Some(state) = self.sessions.get(sid.as_str()) {
                return Some(state.tab_id.clone());
            }
        }
        None
    }

    /// Gets or creates a session keyed by session_id (or a synthetic key for
    /// sessions whose SessionStart was missed).
    fn session_key(payload: &HookPayload, tab_id: &str) -> String {
        payload
            .session_id
            .clone()
            .unwrap_or_else(|| format!("synthetic:{tab_id}"))
    }

    // ── Emit helper ───────────────────────────────────────────────────────────

    fn emit_state(&self, tab_id: &str, state: &str, message: Option<&str>) {
        let Some(emitter) = self.emitters.get(tab_id) else { return };
        let mut data = serde_json::json!({ "state": state });
        if let Some(msg) = message {
            data["message"] = serde_json::Value::String(msg.to_string());
        }
        emitter.emit("agent_turn", "agent_state_changed", data);
    }

    /// Forward a state transition to the OS notification service. Caller
    /// passes the agent_id from the hook payload — `NotificationService`
    /// resolves the human-readable display name from the registry.
    fn notify(
        &self,
        tab_id: &str,
        agent_id: &str,
        state: AgentNotifyState,
        message: Option<&str>,
    ) {
        let Some(svc) = self.notifications.as_ref() else { return };
        svc.clone().maybe_notify(
            tab_id.to_string(),
            agent_id.to_string(),
            state,
            message.map(|s| s.to_string()),
        );
    }
}

// ─── Mod trait implementation ─────────────────────────────────────────────────

impl Mod for AgentTurnMod {
    fn id(&self) -> &'static str {
        "agent_turn"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.emitters.insert(ctx.tab_id.to_string(), ctx.async_emitter());
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.emitters.remove(ctx.tab_id);
        self.sessions.retain(|_, s| s.tab_id != ctx.tab_id);
    }

    fn on_agent_cleared(&mut self, _agent: &str, ctx: &ModContext) {
        // Fallback cleanup if SessionEnd hook was missed (e.g. agent crashed).
        self.sessions.retain(|_, s| s.tab_id != ctx.tab_id);
    }

    fn on_hook_event(&mut self, payload: &HookPayload) {
        // Filter to known agents so stray POSTs from other tools don't affect state.
        match payload.agent.as_str() {
            "claude-code" | "codex" => {}
            _ => return,
        }

        // Cross-terminal-noise gate. Drop any payload that we can't correlate
        // to a tab WE own — claude/codex sessions running in iTerm,
        // Terminal.app, or any other host won't have AGENT_TERMINAL_TAB_ID
        // set, so payload.tab_id is None and the event is silently
        // discarded. session_id falls through as a secondary correlation
        // path inside `tab_id_for` for events whose subprocess lost the
        // env var.
        if self.tab_id_for(payload).is_none() {
            return;
        }

        match payload.event.as_str() {
            "SessionStart" => self.handle_session_start(payload),
            "UserPromptSubmit" => self.handle_in_progress(payload),
            "PreToolUse" => {
                if payload.tool_name.as_deref() == Some("AskUserQuestion") {
                    self.handle_save_question(payload);
                } else {
                    self.handle_in_progress(payload);
                }
            }
            // Claude calls it Notification, Codex calls it PermissionRequest —
            // same role, same handler.
            "Notification" | "PermissionRequest" => self.handle_awaiting(payload),
            "Stop" => self.handle_completed(payload),
            "SessionEnd" => self.handle_session_end(payload),
            _ => {}
        }
    }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

impl AgentTurnMod {
    fn handle_session_start(&mut self, payload: &HookPayload) {
        let Some(session_id) = payload.session_id.clone() else { return };
        // `tab_id_for` is the same lookup the on_hook_event gate already ran;
        // calling it again here means SessionStart works even if a future
        // refactor weakens the gate (e.g. lets through a payload that only
        // has session_id). The `_` discard is intentional — by the time we
        // reach this handler the gate has guaranteed Some(_).
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        self.sessions.insert(
            session_id,
            SessionState { tab_id: tab_id.clone(), pending_question: None },
        );
        self.emit_state(&tab_id, "idle", None);
        // Notify with `Idle` so transition detection has the right baseline.
        // The notification service treats Idle as non-firing but tracks it.
        self.notify(&tab_id, &payload.agent, AgentNotifyState::Idle, None);
    }

    fn handle_in_progress(&mut self, payload: &HookPayload) {
        // Step 1 — resolve tab_id (immutable borrow).
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        // Step 2 — mutate / create session (mutable borrow, drops before emit).
        {
            let key = Self::session_key(payload, &tab_id);
            let state = self.sessions.entry(key).or_insert_with(|| SessionState {
                tab_id: tab_id.clone(),
                pending_question: None,
            });
            state.pending_question = None;
        }

        // Step 3 — emit (immutable borrow).
        self.emit_state(&tab_id, "in-progress", None);
        self.notify(&tab_id, &payload.agent, AgentNotifyState::InProgress, None);
    }

    fn handle_save_question(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };
        let Some(msg) = &payload.message else { return };
        if msg.trim().is_empty() { return; }

        let msg = msg.clone();
        let key = Self::session_key(payload, &tab_id);
        let state = self.sessions.entry(key).or_insert_with(|| SessionState {
            tab_id: tab_id.clone(),
            pending_question: None,
        });
        state.pending_question = Some(msg);
        // No state change — agent is still running.
    }

    fn handle_awaiting(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        // Step 2 — take pending_question out of session (mutable).
        let message: Option<String> = {
            let key = Self::session_key(payload, &tab_id);
            let state = self.sessions.entry(key).or_insert_with(|| SessionState {
                tab_id: tab_id.clone(),
                pending_question: None,
            });
            state.pending_question.take()
        };

        // Fall back through: saved question (Claude AskUserQuestion) →
        // codex prompt (Codex PermissionRequest) → claude notification message →
        // generic placeholder.
        let message = message
            .or_else(|| payload.prompt.clone().filter(|m| !m.trim().is_empty()))
            .or_else(|| payload.message.clone().filter(|m| !m.trim().is_empty()))
            .or_else(|| Some("Needs your attention".to_string()));

        self.emit_state(&tab_id, "awaiting", message.as_deref());
        self.notify(
            &tab_id,
            &payload.agent,
            AgentNotifyState::Awaiting,
            message.as_deref(),
        );
    }

    fn handle_completed(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };
        let Some(emitter) = self.emitters.get(&tab_id).cloned() else { return };

        // Prefer direct payload field (Codex), then transcript file (Claude).
        let direct_msg = payload
            .last_assistant_message
            .clone()
            .filter(|m| !m.trim().is_empty());
        let transcript = payload.transcript_path.clone();
        let agent_id = payload.agent.clone();
        let notifications = self.notifications.clone();

        tokio::spawn(async move {
            let message = if let Some(msg) = direct_msg {
                Some(msg)
            } else if let Some(path) = transcript {
                read_last_assistant_message(&path).await
            } else {
                None
            };
            let truncated_message = message
                .as_ref()
                .map(|msg| msg.chars().take(200).collect::<String>());

            let mut data = serde_json::json!({ "state": "completed" });
            if let Some(msg) = truncated_message.as_ref() {
                data["message"] = serde_json::Value::String(msg.clone());
            }
            emitter.emit("agent_turn", "agent_state_changed", data);

            // Fire notification with the same truncated message.
            if let Some(svc) = notifications {
                svc.maybe_notify(
                    tab_id,
                    agent_id,
                    AgentNotifyState::Completed,
                    truncated_message,
                );
            }
        });
    }

    fn handle_session_end(&mut self, payload: &HookPayload) {
        // Determine tab_id before removing the session — `tab_id_for` covers
        // both the env-var path and the session_id mapping established at
        // SessionStart, which is enough for any SessionEnd payload we
        // actually want to handle.
        let tab_id = self.tab_id_for(payload);

        // Remove the session.
        if let Some(sid) = &payload.session_id {
            self.sessions.remove(sid.as_str());
        }

        // Cancel any pending notification for this tab — session is over,
        // any leftover banner is no longer relevant.
        if let (Some(svc), Some(tid)) = (self.notifications.as_ref(), tab_id.as_ref()) {
            svc.cancel(tid);
        }

        // Emit idle to clear the completed badge.
        if let Some(tab_id) = tab_id {
            self.emit_state(&tab_id, "idle", None);
        }
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

    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    /// Regression guard for the bug Copilot caught on PR #24:
    /// `read_last_assistant_message` previously used `?` on per-line `Option`s,
    /// so the very first non-assistant line near EOF (a tool_use record, a
    /// summary, or any malformed line) would abort the whole search and return
    /// `None` — even if earlier valid assistant messages existed.
    #[tokio::test]
    async fn transcript_reader_skips_non_assistant_and_malformed_lines() {
        let pid = std::process::id();
        let path = write_temp(
            &format!("agent-terminal-transcript-test-{pid}.jsonl"),
            // Reverse-chronological reading: line 1 (top) is the OLDEST, line 5 is the NEWEST.
            // The reader iterates lines.rev() so it sees line 5 first.
            // - line 5: malformed JSON                    → must not abort
            // - line 4: valid JSON, no `message` field    → must not abort
            // - line 3: valid JSON, role != "assistant"   → must not abort
            // - line 2: valid assistant message           → must be returned
            // - line 1: earlier assistant (should NOT win — line 2 is more recent)
            r#"{"message":{"role":"assistant","content":"earlier message"}}
{"message":{"role":"assistant","content":"the right answer"}}
{"message":{"role":"user","content":"a user line"}}
{"type":"summary","payload":42}
this line is not json at all
"#,
        );

        let got = read_last_assistant_message(path.to_str().unwrap()).await;
        assert_eq!(
            got.as_deref(),
            Some("the right answer"),
            "reader must skip malformed/non-assistant lines and return the most recent assistant message"
        );

        std::fs::remove_file(&path).ok();
    }

    /// Confirms array-shaped content (Claude's modern format) round-trips too.
    #[tokio::test]
    async fn transcript_reader_handles_array_content() {
        let pid = std::process::id();
        let path = write_temp(
            &format!("agent-terminal-transcript-array-{pid}.jsonl"),
            r#"{"message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}
"#,
        );

        let got = read_last_assistant_message(path.to_str().unwrap()).await;
        assert_eq!(got.as_deref(), Some("hello world"));
        std::fs::remove_file(&path).ok();
    }

    // ── Cross-terminal hook-noise gate ────────────────────────────────────────
    //
    // These tests cover the bug-1 fix: AgentTurnMod must drop hook events that
    // can't be correlated to a tab WE own. Before the fix, CWD prefix matching
    // routed any claude/codex session at the same path to whichever
    // agent-terminal tab happened to be tracking that path — surfacing
    // notifications for sessions running in iTerm, Terminal.app, etc.

    use crate::hook_server::HookPayload;
    use crate::mod_engine::{AsyncEmitter, Mod, ModEvent};
    use tokio::sync::mpsc;

    /// Builds a HookPayload with sensible defaults for testing the gate.
    /// Caller overrides `tab_id` and `session_id` per-test.
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

    /// Simulates `on_open` by inserting a no-op AsyncEmitter for `tab_id`. We
    /// can't run the full engine in a unit test without a Tauri runtime, so
    /// we wire the emitter directly to a dummy channel. The channel is sized
    /// generously so emit-side `try_send` never fails — tests that care about
    /// what was emitted can drain it; tests that only check state mutation
    /// can ignore it.
    fn register_tab(m: &mut AgentTurnMod, tab_id: &str) -> mpsc::Receiver<ModEvent> {
        let (tx, rx) = mpsc::channel::<ModEvent>(64);
        m.emitters.insert(
            tab_id.to_string(),
            AsyncEmitter::new_for_test(tab_id.to_string(), tx),
        );
        rx
    }

    #[test]
    fn gate_drops_payload_with_no_tab_id() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // Payload has session_id but no tab_id and no prior SessionStart →
        // tab_id_for returns None → handler short-circuits. State must not
        // change.
        m.on_hook_event(&payload(
            "claude-code",
            "UserPromptSubmit",
            None,
            Some("session-x"),
        ));

        assert!(
            m.sessions.is_empty(),
            "no session should be created for ungated payload"
        );
    }

    #[test]
    fn gate_drops_payload_with_unknown_tab_id() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // tab_id is set but doesn't match any known emitter (tab closed, or
        // the agent is running in a tab from a different agent-terminal
        // instance).
        m.on_hook_event(&payload(
            "claude-code",
            "UserPromptSubmit",
            Some("proj:tab-99"),
            Some("session-x"),
        ));

        assert!(m.sessions.is_empty());
    }

    #[test]
    fn gate_drops_payload_with_empty_tab_id() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // Empty string is what the shell would emit if AGENT_TERMINAL_TAB_ID
        // were set to "" — the script omits the field entirely in that case
        // (see hook_config), but defense-in-depth: the gate must still drop.
        m.on_hook_event(&payload(
            "claude-code",
            "SessionStart",
            Some(""),
            Some("session-x"),
        ));

        assert!(m.sessions.is_empty());
    }

    #[test]
    fn gate_accepts_payload_with_known_tab_id() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // Known tab_id + session_id + SessionStart event → mapping created.
        m.on_hook_event(&payload(
            "claude-code",
            "SessionStart",
            Some("proj:tab-1"),
            Some("session-y"),
        ));

        assert_eq!(m.sessions.len(), 1, "session must be created");
        assert_eq!(
            m.sessions.get("session-y").map(|s| s.tab_id.as_str()),
            Some("proj:tab-1"),
        );
    }

    #[test]
    fn session_id_fallback_after_session_start() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // SessionStart establishes session-y → proj:tab-1 mapping via tab_id.
        m.on_hook_event(&payload(
            "claude-code",
            "SessionStart",
            Some("proj:tab-1"),
            Some("session-y"),
        ));

        // A subsequent event for the same session loses the env var (e.g. a
        // detached subprocess fires a hook). session_id alone must still
        // resolve to the previously-registered tab.
        m.on_hook_event(&payload(
            "claude-code",
            "UserPromptSubmit",
            None,
            Some("session-y"),
        ));

        // The session record was reused (still 1 entry), pending_question
        // cleared by handle_in_progress.
        assert_eq!(m.sessions.len(), 1);
        assert!(m.sessions.get("session-y").unwrap().pending_question.is_none());
    }

    #[test]
    fn cwd_match_fallback_no_longer_fires() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // Pre-fix scenario: payload from a foreign claude session that
        // happens to share a CWD with our tab. Even though the CWD matches,
        // there's no tab_id and no prior session mapping — so the gate must
        // drop it. (Before the fix, cwd_match would have routed it to
        // proj:tab-1 and surfaced a notification.)
        let mut p = payload(
            "claude-code",
            "Notification",
            None,
            Some("foreign-session-z"),
        );
        p.cwd = Some("/some/dir".to_string());
        // Even if some other code somehow registered a CWD for our tab via
        // a deleted code path, no tracking is left in AgentTurnMod that
        // would let cwd_match work — the field has been removed entirely.

        m.on_hook_event(&p);

        assert!(
            m.sessions.is_empty(),
            "CWD match must NOT route foreign sessions to our tabs"
        );
    }

    #[test]
    fn unknown_agent_still_dropped() {
        let mut m = AgentTurnMod::new();
        let _rx = register_tab(&mut m, "proj:tab-1");

        // Even with a valid tab_id, unknown agent strings stay filtered out.
        m.on_hook_event(&payload(
            "definitely-not-claude",
            "SessionStart",
            Some("proj:tab-1"),
            Some("session-y"),
        ));

        assert!(m.sessions.is_empty());
    }
}
