use crate::hook_config::config_for_agent_id;
use crate::mod_engine::{Mod, ModContext};

/// Emits tab type changes when `ProcessInspectorMod` detects or loses a `codex` process.
///
/// No session file scanning. No per-tab state. The process cmd line carries the
/// launch flags; git info comes from `GitMonitorMod`.
///
/// Display name flows on the event — same pattern as `ClaudeCodeMod`. See
/// `ClaudeCodeMod` for the rationale.
///
/// Emits:
/// - `tab_type_changed` `{ type: "agent", agent_id, display_name, cmd }` on detection
/// - `tab_type_changed` `{ type: "shell" }` on process exit
pub struct CodexMod;

const AGENT_ID: &str = "codex";

impl CodexMod {
    pub fn new() -> Self {
        Self
    }
}

impl Mod for CodexMod {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn on_agent_detected(&mut self, agent: &str, _cwd: &str, cmd: &str, ctx: &ModContext) {
        if agent != "codex" {
            return;
        }
        let display_name = config_for_agent_id(AGENT_ID)
            .map(|c| c.agent_name)
            .unwrap_or(AGENT_ID);
        ctx.emit(
            "codex",
            "tab_type_changed",
            serde_json::json!({
                "type": "agent",
                "agent_id": AGENT_ID,
                "display_name": display_name,
                "cmd": cmd,
            }),
        );
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agent != "codex" {
            return;
        }
        ctx.emit("codex", "tab_type_changed", serde_json::json!({ "type": "shell" }));
    }
}
