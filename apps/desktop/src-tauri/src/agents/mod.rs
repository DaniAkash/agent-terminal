//! Agent registry: the single declarative source of truth for every supported
//! coding agent.
//!
//! Adding an agent should be one `AgentProfile` entry (plus, for plugin-based
//! agents, one plugin asset). Identity detection, hook installation, and OSC
//! state detection all read this registry rather than hardcoding agent names.
//!
//! A profile describes three orthogonal things about an agent:
//! - **identity**: which foreground process name(s) mean "this agent is here",
//! - **hooks**: how to install the agent's lifecycle hook and what each event
//!   means (its `EventRole`),
//! - **osc**: an optional pure function mapping the agent's OSC title/progress
//!   to a coarse state, for the agents that emit it (Claude, Codex).
//!
//! The state engine fuses the hook and OSC signals with an agent-agnostic
//! process/prompt floor; see the agent-state mod.

pub mod amp;
pub mod claude_code;
pub mod codex;
pub mod kilo;
pub mod kimi;
pub mod mastracode;
pub mod opencode;

/// Coarse state derivable from an agent's OSC title/progress. Distinct from the
/// engine's full state (which also has a hook-only `Completed`); this is only
/// what the screen-independent OSC signal can express.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OscState {
    Working,
    Blocked,
    Idle,
}

/// The OSC signals a detector reads. `title` is the OSC 0/1 window title,
/// `progress` the OSC 9 progress string. Either may be empty.
#[derive(Debug, Clone, Copy)]
pub struct OscView<'a> {
    pub title: &'a str,
    pub progress: &'a str,
}

/// True if `c` is in the Braille Patterns block (U+2800..=U+28FF). Agents paint
/// animated spinner glyphs from this block into the OSC title while working, so
/// a Braille glyph in the title is a robust "working" signal that survives the
/// spinner-word rotation and prompt-box redraws that break screen matching.
pub(crate) fn is_braille(c: char) -> bool {
    ('\u{2800}'..='\u{28FF}').contains(&c)
}

/// Role a hook event plays in the state machine. The event-name-to-role mapping
/// is per agent (Claude's `Notification` and Codex's `PermissionRequest` both
/// map to `Blocked`, for example).
///
/// Note: Claude's `PreToolUse` carrying `tool_name == "AskUserQuestion"` is
/// special-cased by the engine (it stashes the question rather than changing
/// state); that is keyed on the tool name, not expressible as a role here, so
/// `PreToolUse` maps to `Working` and the engine intercepts the question case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventRole {
    SessionStart,
    Working,
    Blocked,
    /// Return to the idle baseline without ending the session. Used by agents
    /// whose hook reports a resolved `idle` state (Kimi, Mastra) rather than a
    /// `Stop`-style completion.
    Idle,
    Completed,
    SessionEnd,
}

/// A single hook event the agent emits, and what it means to us.
pub struct HookEvent {
    pub name: &'static str,
    pub role: EventRole,
}

/// How an agent's hook integration is installed on disk.
pub enum HookInstall {
    /// Patch the agent's own settings file with our hook command (Claude,
    /// Codex). The nested matcher+hooks JSON merge lives in `hook_config`.
    NativeConfig { config_tilde_path: &'static str },
    /// Drop a plugin/extension asset into the agent's plugin dir (opencode,
    /// kilo).
    Plugin {
        dir_tilde_path: &'static str,
        install_name: &'static str,
        asset: &'static str,
    },
    /// Register hooks in an agent's TOML config via a managed block of
    /// `[[hooks]]` tables (Kimi). The action hook script posts the resolved
    /// state (the second tuple field) as the event.
    TomlBlock {
        config_tilde_path: &'static str,
        hooks_dir_tilde_path: &'static str,
        script_name: &'static str,
        /// (agent lifecycle event, action posted).
        events: &'static [(&'static str, &'static str)],
    },
    /// Register hooks in an agent's flat JSON hooks file (Mastra): each event
    /// maps to `[{ type: "command", command: "...", timeout, ... }]`.
    FlatJson {
        config_tilde_path: &'static str,
        hooks_dir_tilde_path: &'static str,
        script_name: &'static str,
        /// (agent lifecycle event, action posted).
        events: &'static [(&'static str, &'static str)],
    },
}

/// Everything needed to install an agent's hook and interpret its events.
pub struct HookSpec {
    pub install: HookInstall,
    pub events: &'static [HookEvent],
    /// Timeout (ms) written into native-config hook entries. Ignored for
    /// plugin installs.
    pub timeout_ms: u64,
}

/// Declarative description of one agent.
pub struct AgentProfile {
    /// Stable id used on the hook wire (`HookPayload.agent`) and as the
    /// frontend `agent_id`. Example: `"claude-code"`.
    pub id: &'static str,
    /// Human-readable name shown in the UI and logs.
    pub display_name: &'static str,
    /// Foreground process basenames that identify this agent.
    pub process_names: &'static [&'static str],
    /// True if the agent can run under a runtime wrapper (node/bun/python), so
    /// identity must also walk argv for the script path, not just match the
    /// direct process name.
    pub runtime_wrapped: bool,
    /// Hook integration, if the agent has one. `None` means identity + OSC/floor
    /// only.
    pub hook: Option<HookSpec>,
    /// OSC title/progress signature, if the agent emits state via OSC. `None`
    /// for agents that do not (opencode).
    pub osc: Option<fn(&OscView) -> Option<OscState>>,
    /// True if a lone ESC or Ctrl-C ends the current turn without the agent
    /// firing its completion event, making the keypress the only signal that
    /// the turn is over. Opt-in per agent: an agent that does report its own
    /// cancellation must stay `false` so its hook stays the sole authority.
    pub interrupt_ends_turn: bool,
}

impl AgentProfile {
    /// Resolves the role of a hook event name for this agent, if registered.
    pub fn event_role(&self, event_name: &str) -> Option<EventRole> {
        let hook = self.hook.as_ref()?;
        hook.events
            .iter()
            .find(|e| e.name == event_name)
            .map(|e| e.role)
    }
}

/// Every supported agent. Order is not significant.
pub static AGENTS: &[&AgentProfile] = &[
    &claude_code::PROFILE,
    &codex::PROFILE,
    &opencode::PROFILE,
    &amp::PROFILE,
    &kilo::PROFILE,
    &kimi::PROFILE,
    &mastracode::PROFILE,
];

/// Look up a profile by its stable id (e.g. `"claude-code"`).
pub fn by_id(id: &str) -> Option<&'static AgentProfile> {
    AGENTS.iter().copied().find(|a| a.id == id)
}

/// Look up a profile by a foreground process basename (e.g. `"claude"`).
pub fn by_process_name(name: &str) -> Option<&'static AgentProfile> {
    AGENTS.iter().copied().find(|a| a.process_names.contains(&name))
}

/// Every process basename that identifies any known agent.
pub fn known_process_names() -> impl Iterator<Item = &'static str> {
    AGENTS.iter().flat_map(|a| a.process_names.iter().copied())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn by_id_resolves_known_agents() {
        assert_eq!(by_id("claude-code").map(|a| a.display_name), Some("Claude Code"));
        assert_eq!(by_id("codex").map(|a| a.id), Some("codex"));
        assert_eq!(by_id("opencode").map(|a| a.id), Some("opencode"));
        assert_eq!(by_id("amp").map(|a| a.id), Some("amp"));
        assert_eq!(by_id("kilo").map(|a| a.display_name), Some("Kilo Code"));
        assert_eq!(by_id("kimi").map(|a| a.display_name), Some("Kimi CLI"));
        assert_eq!(by_id("mastracode").map(|a| a.display_name), Some("Mastra"));
        assert!(by_id("nope").is_none());
    }

    #[test]
    fn by_process_name_resolves_binaries() {
        assert_eq!(by_process_name("claude").map(|a| a.id), Some("claude-code"));
        assert_eq!(by_process_name("codex").map(|a| a.id), Some("codex"));
        assert_eq!(by_process_name("opencode").map(|a| a.id), Some("opencode"));
        assert_eq!(by_process_name("amp").map(|a| a.id), Some("amp"));
        assert_eq!(by_process_name("kilo").map(|a| a.id), Some("kilo"));
        assert_eq!(by_process_name("kimi").map(|a| a.id), Some("kimi"));
        assert_eq!(by_process_name("mastracode").map(|a| a.id), Some("mastracode"));
        assert!(by_process_name("bash").is_none());
    }

    #[test]
    fn known_process_names_covers_all_agents() {
        let names: HashSet<&str> = known_process_names().collect();
        for name in ["claude", "codex", "opencode", "amp", "kilo", "kimi", "mastracode"] {
            assert!(names.contains(name), "missing process name: {name}");
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = HashSet::new();
        for a in AGENTS {
            assert!(seen.insert(a.id), "duplicate agent id: {}", a.id);
        }
    }

    #[test]
    fn process_names_are_unique_across_agents() {
        let mut seen = HashSet::new();
        for a in AGENTS {
            for name in a.process_names {
                assert!(seen.insert(*name), "process name {name} claimed by two agents");
            }
        }
    }

    #[test]
    fn hook_event_roles_resolve() {
        let claude = by_id("claude-code").unwrap();
        assert_eq!(claude.event_role("SessionStart"), Some(EventRole::SessionStart));
        assert_eq!(claude.event_role("Stop"), Some(EventRole::Completed));
        assert_eq!(claude.event_role("Notification"), Some(EventRole::Blocked));
        assert_eq!(claude.event_role("NotAnEvent"), None);

        let codex = by_id("codex").unwrap();
        assert_eq!(codex.event_role("PermissionRequest"), Some(EventRole::Blocked));
    }
}
