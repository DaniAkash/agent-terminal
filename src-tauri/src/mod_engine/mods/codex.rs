use crate::mod_engine::{Mod, ModContext};

/// Emits tab type changes when `ProcessInspectorMod` detects or loses a `codex` process.
///
/// No session file scanning. No per-tab state. The process cmd line carries the
/// launch flags; git info comes from `GitMonitorMod`.
///
/// Emits:
/// - `tab_type_changed` `{ type: "agent", agent: "codex", cmd: "..." }` on detection
/// - `tab_type_changed` `{ type: "shell" }` on process exit
pub struct CodexMod;

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
        ctx.emit(
            "codex",
            "tab_type_changed",
            serde_json::json!({ "type": "agent", "agent": "codex", "cmd": cmd }),
        );
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agent != "codex" {
            return;
        }
        ctx.emit("codex", "tab_type_changed", serde_json::json!({ "type": "shell" }));
    }
}
