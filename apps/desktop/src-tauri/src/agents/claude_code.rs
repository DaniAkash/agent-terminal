//! Claude Code agent profile.
//!
//! Hooks: native config merge into `~/.claude/settings.json`. State comes from
//! the native lifecycle hooks (already proven in agent-terminal) with OSC title
//! as a corrector. OSC signature is wired in the OSC-signatures step.

use super::{is_braille, AgentProfile, EventRole, HookEvent, HookInstall, HookSpec, OscState, OscView};

/// Claude's OSC signature (reference: herdr `src/detect/manifests/claude.toml`,
/// facts re-implemented fresh):
/// - a Braille-prefixed title is the animated spinner → Working,
/// - OSC 9 progress `4;0;` is Claude's explicit idle marker → Idle,
/// - anything else → no opinion.
///
/// Both positive signals are absent from Claude 2.x, which paints one static
/// title for the life of the session and emits no OSC 9 at all. A settled title
/// therefore carries no liveness information, so this returns None rather than
/// inferring Idle from it. Inferring Idle made the fused state machine stale
/// every hook-reported Working back to Idle after OSC_STALE, which suppressed
/// the in-progress badge for every Claude tab. The two positive branches stay
/// so the detector self-heals if either signal returns.
///
/// Claude does not surface "blocked" via OSC; that comes from the hook channel.
fn state_from_osc(view: &OscView) -> Option<OscState> {
    let first = view.title.trim_start().chars().next();
    if first.is_some_and(is_braille) {
        return Some(OscState::Working);
    }
    if view.progress.starts_with("4;0;") {
        return Some(OscState::Idle);
    }
    None
}

static EVENTS: &[HookEvent] = &[
    HookEvent { name: "SessionStart", role: EventRole::SessionStart },
    HookEvent { name: "UserPromptSubmit", role: EventRole::Working },
    // PreToolUse is Working, except tool_name == "AskUserQuestion", which the
    // engine intercepts to stash the question text (see EventRole docs).
    HookEvent { name: "PreToolUse", role: EventRole::Working },
    // Post-tool edges matter as much as pre-tool ones. With only PreToolUse
    // mapped, a turn whose Stop is never delivered (Ctrl-C, crash, closed tab)
    // pins the badge on Working forever. PostToolUse re-asserts Working on
    // every completed tool call, so the state keeps advancing on its own.
    HookEvent { name: "PostToolUse", role: EventRole::Working },
    HookEvent { name: "PostToolUseFailure", role: EventRole::Working },
    // A subagent finishing returns control to the parent, which is still
    // working. Without this the parent can look idle mid-turn.
    HookEvent { name: "SubagentStop", role: EventRole::Working },
    // Two blocked signals on purpose. PermissionRequest is what current
    // builds emit when a prompt is waiting; Notification is the older
    // spelling. Both are registered so the badge is correct across
    // versions, and a duplicate Blocked transition is idempotent.
    HookEvent { name: "PermissionRequest", role: EventRole::Blocked },
    HookEvent { name: "Notification", role: EventRole::Blocked },
    HookEvent { name: "Stop", role: EventRole::Completed },
    HookEvent { name: "SessionEnd", role: EventRole::SessionEnd },
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "claude-code",
    display_name: "Claude Code",
    process_names: &["claude"],
    runtime_wrapped: false,
    hook: Some(HookSpec {
        install: HookInstall::NativeConfig { config_tilde_path: "~/.claude/settings.json" },
        events: EVENTS,
        timeout_ms: 10_000,
    }),
    osc: Some(state_from_osc),
    interrupt_ends_turn: true,
};

#[cfg(test)]
mod tests {
    use super::{state_from_osc, EVENTS};
    use crate::agents::{EventRole, OscState, OscView};

    /// Pins the registered lifecycle events.
    ///
    /// Claude Code emits more events than the badge originally subscribed
    /// to, and the missing ones are silent: an unregistered event simply
    /// never arrives, so the badge sticks on a stale state instead of
    /// failing loudly. This test makes a dropped subscription a test
    /// failure rather than a bug report.
    #[test]
    fn subscribes_to_every_state_bearing_event() {
        let got: Vec<(&str, EventRole)> =
            EVENTS.iter().map(|e| (e.name, e.role)).collect();
        assert_eq!(
            got,
            vec![
                ("SessionStart", EventRole::SessionStart),
                ("UserPromptSubmit", EventRole::Working),
                ("PreToolUse", EventRole::Working),
                ("PostToolUse", EventRole::Working),
                ("PostToolUseFailure", EventRole::Working),
                ("SubagentStop", EventRole::Working),
                ("PermissionRequest", EventRole::Blocked),
                ("Notification", EventRole::Blocked),
                ("Stop", EventRole::Completed),
                ("SessionEnd", EventRole::SessionEnd),
            ]
        );
    }

    /// Both spellings of the blocked signal stay registered: current
    /// builds emit PermissionRequest, older ones Notification. Dropping
    /// either silently breaks the blocked badge on that version.
    #[test]
    fn keeps_both_blocked_signals() {
        let blocked: Vec<&str> = EVENTS
            .iter()
            .filter(|e| e.role == EventRole::Blocked)
            .map(|e| e.name)
            .collect();
        assert_eq!(blocked, vec!["PermissionRequest", "Notification"]);
    }

    fn view<'a>(title: &'a str, progress: &'a str) -> OscView<'a> {
        OscView { title, progress }
    }

    #[test]
    fn braille_title_is_working() {
        // U+2802 Braille glyph prefix, as Claude paints while working.
        assert_eq!(state_from_osc(&view("\u{2802} Claude", "")), Some(OscState::Working));
    }

    #[test]
    fn progress_marker_is_idle() {
        assert_eq!(state_from_osc(&view("", "4;0;")), Some(OscState::Idle));
    }

    #[test]
    fn settled_title_yields_no_opinion() {
        // "✳ Claude Code" (U+2733, not Braille) is the only title Claude 2.x
        // ever sets, and it never changes. Reading Idle out of it vetoed the
        // hook channel's Working state and hid the in-progress badge outright.
        assert_eq!(state_from_osc(&view("\u{2733} Claude Code", "")), None);
        assert_eq!(state_from_osc(&view("~/project", "")), None);
    }

    #[test]
    fn empty_signals_are_unknown() {
        assert_eq!(state_from_osc(&view("", "")), None);
    }
}
