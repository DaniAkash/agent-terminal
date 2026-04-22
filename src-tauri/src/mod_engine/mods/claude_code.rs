use crate::mod_engine::{Mod, ModContext};

/// Emits tab type changes when `ProcessInspectorMod` detects or loses a `claude` process.
///
/// No session file scanning. No per-tab state. The process cmd line carries the
/// launch flags; git info comes from `GitMonitorMod`.
///
/// Emits:
/// - `tab_type_changed` `{ type: "agent", agent: "claude-code", cmd: "..." }` on detection
/// - `tab_type_changed` `{ type: "shell" }` on process exit
pub struct ClaudeCodeMod;

impl ClaudeCodeMod {
    pub fn new() -> Self {
        Self
    }
}

impl Mod for ClaudeCodeMod {
    fn id(&self) -> &'static str {
        "claude_code"
    }

    fn on_agent_detected(&mut self, agent: &str, _cwd: &str, cmd: &str, ctx: &ModContext) {
        if agent != "claude" {
            return;
        }
        ctx.emit(
            "claude_code",
            "tab_type_changed",
            serde_json::json!({ "type": "agent", "agent": "claude-code", "cmd": cmd }),
        );
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agent != "claude" {
            return;
        }
        ctx.emit("claude_code", "tab_type_changed", serde_json::json!({ "type": "shell" }));
    }
}
