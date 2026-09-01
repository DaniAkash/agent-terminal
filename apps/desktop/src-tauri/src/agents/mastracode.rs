//! Mastra agent profile.
//!
//! Mastra registers hooks in `~/.mastracode/hooks.json` (flat format: each event
//! maps to `[{ type: "command", command, timeout }]`). The action hook script
//! posts a resolved state, which the registry maps to roles. The
//! lifecycle-event-to-action mapping is referenced from herdr, re-implemented
//! fresh.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

/// Actions the hook script posts, mapped to state-engine roles.
static EVENTS: &[HookEvent] = &[
    HookEvent { name: "idle", role: EventRole::Idle },
    HookEvent { name: "working", role: EventRole::Working },
    HookEvent { name: "blocked", role: EventRole::Blocked },
    HookEvent { name: "release", role: EventRole::SessionEnd },
];

/// Mastra lifecycle event -> action posted (drives config generation).
static INSTALL_EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "idle"),
    ("UserPromptSubmit", "working"),
    ("AgentStart", "working"),
    ("PreToolUse", "working"),
    ("PermissionRequest", "blocked"),
    ("PermissionResult", "working"),
    ("SubagentStart", "working"),
    ("SubagentEnd", "working"),
    ("Interrupt", "idle"),
    ("AgentEnd", "idle"),
    ("Stop", "idle"),
    ("SessionEnd", "release"),
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "mastracode",
    display_name: "Mastra",
    process_names: &["mastracode"],
    runtime_wrapped: true,
    hook: Some(HookSpec {
        install: HookInstall::FlatJson {
            config_tilde_path: "~/.mastracode/hooks.json",
            hooks_dir_tilde_path: "~/.mastracode/hooks",
            script_name: "agent-terminal-state",
            events: INSTALL_EVENTS,
        },
        events: EVENTS,
        timeout_ms: 10_000,
    }),
    osc: None,
};
