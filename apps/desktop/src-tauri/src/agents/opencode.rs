//! opencode agent profile.
//!
//! opencode runs under a JS runtime, so identity walks argv (`runtime_wrapped`).
//! It emits no OSC state, so it is a hooks + floor agent. Its hook is a JS
//! plugin installed into `~/.config/opencode/plugin/`; the plugin translates
//! opencode's session lifecycle into our neutral event vocabulary.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

static EVENTS: &[HookEvent] = &[
    HookEvent { name: "session_start", role: EventRole::SessionStart },
    HookEvent { name: "working", role: EventRole::Working },
    HookEvent { name: "blocked", role: EventRole::Blocked },
    HookEvent { name: "turn_end", role: EventRole::Completed },
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "opencode",
    display_name: "opencode",
    process_names: &["opencode"],
    runtime_wrapped: true,
    hook: Some(HookSpec {
        install: HookInstall::Plugin {
            dir_tilde_path: "~/.config/opencode/plugin",
            install_name: "agent-terminal-state.js",
            asset: include_str!("assets/opencode-agent-state.js"),
        },
        events: EVENTS,
        timeout_ms: 0,
    }),
    osc: None,
};
