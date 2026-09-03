//! Kilo Code agent profile.
//!
//! Kilo runs under a JS runtime and loads plugins from `~/.config/kilo/plugin/`,
//! like opencode. The plugin translates kilo's session lifecycle into our
//! neutral event vocabulary. No OSC; floor covers exit.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

static EVENTS: &[HookEvent] = &[
    HookEvent { name: "session_start", role: EventRole::SessionStart },
    HookEvent { name: "working", role: EventRole::TurnStart },
    HookEvent { name: "blocked", role: EventRole::Blocked },
    HookEvent { name: "turn_end", role: EventRole::Completed },
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "kilo",
    display_name: "Kilo Code",
    process_names: &["kilo"],
    runtime_wrapped: true,
    hook: Some(HookSpec {
        install: HookInstall::Plugin {
            dir_tilde_path: "~/.config/kilo/plugin",
            install_name: "agent-terminal-state.js",
            asset: include_str!("assets/kilo-agent-state.js"),
        },
        events: EVENTS,
        timeout_ms: 0,
    }),
    osc: None,
    interrupt_ends_turn: false,
};
