mod context;
mod engine;
pub mod mods;
pub mod osc_parser;

#[allow(unused_imports)]
pub use context::{AgentSignal, AgentSignalKind, AsyncAgentSignaler, AsyncEmitter, CwdUpdate, ModContext, ModEvent};
pub use engine::{ModEngine, ModEngineHandle};

/// The trait every MOD implements.
///
/// All callbacks are synchronous and run on the `ModEngine`'s single dispatcher
/// task — MODs must not block. Spawn `tokio::spawn` tasks for any I/O-bound work
/// (file reads, git queries, SQLite snapshots) and emit results via `ctx.emit()`.
///
/// Per-tab state is the MOD's own responsibility. Use `on_open` to initialise it
/// (keyed by `ctx.tab_id`) and `on_close` to drop it.
pub trait Mod: Send + 'static {
    /// Stable identifier used as the `modId` field in emitted events.
    fn id(&self) -> &'static str;

    /// Tab opened — allocate any per-tab state here.
    fn on_open(&mut self, _ctx: &ModContext) {}

    /// PTY output chunk arrived. The terminal has already received these bytes;
    /// MODs only observe and must not modify the stream.
    fn on_output(&mut self, _data: &[u8], _ctx: &ModContext) {}

    /// User input chunk, dispatched after `write_pty` delivers bytes to the PTY.
    fn on_input(&mut self, _data: &[u8], _ctx: &ModContext) {}

    /// PTY was resized.
    fn on_resize(&mut self, _cols: u16, _rows: u16, _ctx: &ModContext) {}

    /// Tab closed — drop any per-tab state here.
    fn on_close(&mut self, _ctx: &ModContext) {}

    /// Called by the engine when `DirTrackerMod` detects a CWD change for this tab.
    /// Mods that react to directory changes implement this instead of reading
    /// `CwdRegistry` inside `on_output`. Default is a no-op.
    fn on_cwd_changed(&mut self, _cwd: &str, _ctx: &ModContext) {}

    /// Called by the engine when `ProcessInspectorMod` detects a new agent process
    /// (or a PID change for the same agent name) in this tab's CWD.
    /// `agent` is the binary name: `"claude"` or `"codex"`. Default is a no-op.
    fn on_agent_detected(&mut self, _agent: &str, _cwd: &str, _ctx: &ModContext) {}

    /// Called by the engine when `ProcessInspectorMod` no longer sees an agent
    /// process that was previously detected in this tab's CWD. Default is a no-op.
    fn on_agent_cleared(&mut self, _agent: &str, _ctx: &ModContext) {}
}
