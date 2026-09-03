//! Amp agent profile.
//!
//! Amp reports state via its OSC window title and has no hook integration, so
//! it is an OSC + floor agent. Signature reference: herdr
//! `src/detect/manifests/amp.toml` (facts re-implemented fresh).

use super::{is_braille, AgentProfile, OscState, OscView};

fn state_from_osc(view: &OscView) -> Option<OscState> {
    let title = view.title;
    if title.contains("Plugin confirmation needed") {
        return Some(OscState::Blocked);
    }
    if title.trim_start().chars().next().is_some_and(is_braille) {
        return Some(OscState::Working);
    }
    if title.contains(" - amp - ") {
        return Some(OscState::Idle);
    }
    None
}

pub static PROFILE: AgentProfile = AgentProfile {
    id: "amp",
    display_name: "Amp",
    process_names: &["amp"],
    runtime_wrapped: true,
    hook: None,
    osc: Some(state_from_osc),
    interrupt_ends_turn: false,
};

#[cfg(test)]
mod tests {
    use super::state_from_osc;
    use crate::agents::{OscState, OscView};

    fn view<'a>(title: &'a str) -> OscView<'a> {
        OscView { title, progress: "" }
    }

    #[test]
    fn plugin_confirmation_is_blocked() {
        assert_eq!(
            state_from_osc(&view("Plugin confirmation needed")),
            Some(OscState::Blocked)
        );
    }

    #[test]
    fn braille_title_is_working() {
        assert_eq!(state_from_osc(&view("\u{2802} amp")), Some(OscState::Working));
    }

    #[test]
    fn amp_marker_title_is_idle() {
        assert_eq!(state_from_osc(&view("~/project - amp - main")), Some(OscState::Idle));
    }

    #[test]
    fn unrelated_title_is_unknown() {
        assert_eq!(state_from_osc(&view("some shell prompt")), None);
    }
}
