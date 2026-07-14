//! Claude Code agent profile.
//!
//! Hooks: native config merge into `~/.claude/settings.json`. State comes from
//! the native lifecycle hooks (already proven in agent-terminal) with OSC title
//! as a corrector. OSC signature is wired in the OSC-signatures step.

use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

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
    osc: None,
};
