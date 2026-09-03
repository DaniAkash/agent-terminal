//! Kimi CLI agent profile.
//!
//! Kimi registers hooks in `~/.kimi-code/config.toml` via a managed block of
//! `[[hooks]]` tables. The action hook script posts a resolved state
//! (session/working/blocked/idle), which the registry maps to roles. The
//! lifecycle-event-to-action mapping is referenced from herdr, re-implemented
//! fresh.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

/// Actions the hook script posts, mapped to state-engine roles.
static EVENTS: &[HookEvent] = &[
    HookEvent { name: "session", role: EventRole::SessionStart },
    HookEvent { name: "working", role: EventRole::TurnStart },
    HookEvent { name: "blocked", role: EventRole::Blocked },
    HookEvent { name: "idle", role: EventRole::Idle },
];

/// Kimi lifecycle event -> action posted (drives config generation).
static INSTALL_EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "session"),
    ("UserPromptSubmit", "working"),
    ("PreToolUse", "working"),
    ("SubagentStart", "working"),
    ("PreCompact", "working"),
    ("PermissionRequest", "blocked"),
    ("PermissionResult", "working"),
    ("Stop", "idle"),
    ("Interrupt", "idle"),
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "kimi",
    display_name: "Kimi CLI",
    process_names: &["kimi"],
    runtime_wrapped: false,
    hook: Some(HookSpec {
        install: HookInstall::TomlBlock {
            config_tilde_path: "~/.kimi-code/config.toml",
            hooks_dir_tilde_path: "~/.kimi-code/hooks",
            script_name: "agent-terminal-state",
            events: INSTALL_EVENTS,
        },
        events: EVENTS,
        timeout_ms: 10_000,
    }),
    osc: None,
    interrupt_ends_turn: false,
};
