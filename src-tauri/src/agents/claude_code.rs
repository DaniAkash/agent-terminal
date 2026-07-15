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
/// - any other settled (non-Braille) title means the prompt is showing → Idle.
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
    if first.is_some() {
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
};

#[cfg(test)]
mod tests {
    use super::state_from_osc;
    use crate::agents::{OscState, OscView};

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
    fn settled_title_is_idle() {
        // U+2733 static glyph (not Braille) → prompt showing.
        assert_eq!(state_from_osc(&view("\u{2733} Claude", "")), Some(OscState::Idle));
        assert_eq!(state_from_osc(&view("~/project", "")), Some(OscState::Idle));
    }

    #[test]
    fn empty_signals_are_unknown() {
        assert_eq!(state_from_osc(&view("", "")), None);
    }
}
