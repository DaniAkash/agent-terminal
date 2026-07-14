//! Codex CLI agent profile.
//!
//! Hooks: native config merge into `~/.codex/hooks.json` (Codex implements
//! Claude's hook protocol verbatim). `PermissionRequest` is Codex's equivalent
//! of Claude's `Notification` (blocked, awaiting approval). OSC signature is
//! wired in the OSC-signatures step.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

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
    osc: None,
};
