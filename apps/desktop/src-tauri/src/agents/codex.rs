//! Codex CLI agent profile.
//!
//! Hooks: native config merge into `~/.codex/hooks.json` (Codex implements
//! Claude's hook protocol verbatim). `PermissionRequest` is Codex's equivalent
//! of Claude's `Notification` (blocked, awaiting approval). OSC signature is
//! wired in the OSC-signatures step.

use super::{is_braille, AgentProfile, EventRole, HookEvent, HookInstall, HookSpec, OscState, OscView};

/// Codex's OSC signature (reference: herdr `src/detect/manifests/codex.toml`,
/// facts re-implemented fresh):
/// - title containing `Action Required` → Blocked (Codex's approval prompt),
/// - a Braille spinner frame in the title → Working,
/// - any other non-empty title → Idle.
fn state_from_osc(view: &OscView) -> Option<OscState> {
    let title = view.title;
    if title.contains("Action Required") {
        return Some(OscState::Blocked);
    }
    if title.chars().any(is_braille) {
        return Some(OscState::Working);
    }
    if !title.trim().is_empty() {
        return Some(OscState::Idle);
    }
    None
}

static EVENTS: &[HookEvent] = &[
    HookEvent { name: "SessionStart", role: EventRole::SessionStart },
    HookEvent { name: "UserPromptSubmit", role: EventRole::Working },
    HookEvent { name: "PermissionRequest", role: EventRole::Blocked },
    HookEvent { name: "Stop", role: EventRole::Completed },
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "codex",
    display_name: "Codex CLI",
    process_names: &["codex"],
    runtime_wrapped: false,
    hook: Some(HookSpec {
        install: HookInstall::NativeConfig { config_tilde_path: "~/.codex/hooks.json" },
        events: EVENTS,
        timeout_ms: 5_000,
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
    fn action_required_is_blocked() {
        assert_eq!(
            state_from_osc(&view("Codex: Action Required", "")),
            Some(OscState::Blocked)
        );
    }

    #[test]
    fn braille_frame_is_working() {
        // U+280B is one of Codex's spinner frames.
        assert_eq!(state_from_osc(&view("\u{280B} working", "")), Some(OscState::Working));
    }

    #[test]
    fn plain_title_is_idle() {
        assert_eq!(state_from_osc(&view("codex", "")), Some(OscState::Idle));
    }

    #[test]
    fn empty_title_is_unknown() {
        assert_eq!(state_from_osc(&view("   ", "")), None);
    }
}
