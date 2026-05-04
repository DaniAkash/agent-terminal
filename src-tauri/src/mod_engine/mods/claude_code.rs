use crate::hook_config::config_for_agent_id;
use crate::mod_engine::{Mod, ModContext};

/// Emits tab type changes when `ProcessInspectorMod` detects or loses a `claude` process.
///
/// No session file scanning. No per-tab state. The process cmd line carries the
/// launch flags; git info comes from `GitMonitorMod`.
///
/// Display name flows on the event so consumers (badges, notifications, future
/// status-bar widgets) read it from `TabMeta` rather than maintaining their
/// own `agent_id → display_name` lookup tables. The display name comes from
/// `AGENT_HOOK_CONFIGS` so the registry stays the single source of truth.
///
/// Emits:
/// - `tab_type_changed` `{ type: "agent", agent_id, display_name, cmd }` on detection
/// - `tab_type_changed` `{ type: "shell" }` on process exit
pub struct ClaudeCodeMod;

const AGENT_ID: &str = "claude-code";

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
        let display_name = config_for_agent_id(AGENT_ID)
            .map(|c| c.agent_name)
            .unwrap_or(AGENT_ID);
        ctx.emit(
            "claude_code",
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
        if agent != "claude" {
            return;
        }
        ctx.emit("claude_code", "tab_type_changed", serde_json::json!({ "type": "shell" }));
    }
}
