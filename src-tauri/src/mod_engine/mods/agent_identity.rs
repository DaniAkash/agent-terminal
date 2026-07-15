use crate::agents;
use crate::mod_engine::{Mod, ModContext};

/// Emits `tab_type_changed` when an agent process is detected or cleared in a
/// tab. Registry-driven: `ShellProcessMod` resolves the agent id, and this mod
/// looks up the display name from `crate::agents`. Adding a new agent needs a
/// registry entry and no new mod.
///
/// Emits:
/// - `tab_type_changed` `{ type: "agent", agent_id, display_name, cmd }` on detect
/// - `tab_type_changed` `{ type: "shell" }` on clear (agent process gone)
///
/// Replaces the former per-agent `ClaudeCodeMod` / `CodexMod`.
pub struct AgentIdentityMod;

impl AgentIdentityMod {
    pub fn new() -> Self {
        Self
    }
}

impl Mod for AgentIdentityMod {
    fn id(&self) -> &'static str {
        "agent_identity"
    }

    fn on_agent_detected(&mut self, agent: &str, _cwd: &str, cmd: &str, ctx: &ModContext) {
        let Some(profile) = agents::by_id(agent) else {
            return;
        };
        ctx.emit(
            "agent_identity",
            "tab_type_changed",
            serde_json::json!({
                "type": "agent",
                "agent_id": profile.id,
                "display_name": profile.display_name,
                "cmd": cmd,
            }),
        );
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agents::by_id(agent).is_none() {
            return;
        }
        ctx.emit("agent_identity", "tab_type_changed", serde_json::json!({ "type": "shell" }));
    }
}
