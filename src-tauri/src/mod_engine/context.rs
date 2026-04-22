use serde::Serialize;
use tokio::sync::mpsc;

/// A structured event emitted by a MOD and forwarded to the frontend via `mod:event`.
#[derive(Serialize, Clone)]
pub struct ModEvent {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    #[serde(rename = "modId")]
    pub mod_id: &'static str,
    pub event: String,
    pub data: serde_json::Value,
}

/// Sent by `DirTrackerMod` via `ctx.set_cwd()` to notify the engine of a CWD change.
/// The engine drains these after each `on_output` round and dispatches `on_cwd_changed`.
pub struct CwdUpdate {
    pub tab_id: String,
    pub cwd: String,
}

pub enum AgentSignalKind {
    Detected,
    Cleared,
}

/// Sent by `ProcessInspectorMod`'s timer task to signal an agent appearing or
/// disappearing. The engine drains these and routes to `on_agent_detected` /
/// `on_agent_cleared` on all mods.
pub struct AgentSignal {
    pub tab_id: String,
    /// Binary name: `"claude"` or `"codex"`.
    pub agent: String,
    /// Non-empty for `Detected`; empty string for `Cleared`.
    pub cwd: String,
    /// Full command string for `Detected` (e.g. `"claude --dangerously-skip-permissions"`).
    /// Empty string for `Cleared`.
    pub cmd: String,
    pub kind: AgentSignalKind,
}

/// Context passed to every MOD callback. Provides tab identity and event emission.
pub struct ModContext<'a> {
    pub tab_id: &'a str,
    event_tx: &'a mpsc::Sender<ModEvent>,
    cwd_tx: &'a mpsc::Sender<CwdUpdate>,
    agent_tx: &'a mpsc::UnboundedSender<AgentSignal>,
    /// PID of the shell process for this tab's PTY. Used by ProcessInspectorMod
    /// to detect only agent processes that are children of this shell.
    pub shell_pid: u32,
}

impl<'a> ModContext<'a> {
    pub fn new(
        tab_id: &'a str,
        event_tx: &'a mpsc::Sender<ModEvent>,
        cwd_tx: &'a mpsc::Sender<CwdUpdate>,
        agent_tx: &'a mpsc::UnboundedSender<AgentSignal>,
        _current_cwd: Option<String>,
        shell_pid: u32,
    ) -> Self {
        Self { tab_id, event_tx, cwd_tx, agent_tx, shell_pid }
    }

    /// Emit a typed event to the frontend. Non-blocking — silently drops if the
    /// outbound channel is full (engine falling behind under extreme load).
    pub fn emit(&self, mod_id: &'static str, event: &str, data: serde_json::Value) {
        let _ = self.event_tx.try_send(ModEvent {
            tab_id: self.tab_id.to_string(),
            mod_id,
            event: event.to_string(),
            data,
        });
    }

    /// Signal the engine that this tab's CWD has changed. The engine will call
    /// `on_cwd_changed` on all mods after the current `on_output` round completes.
    pub fn set_cwd(&self, cwd: &str) {
        let _ = self.cwd_tx.try_send(CwdUpdate {
            tab_id: self.tab_id.to_string(),
            cwd: cwd.to_string(),
        });
    }

    /// Returns a cloneable emitter that can be moved into async tasks.
    /// The task can call `emitter.emit(...)` directly without going through
    /// the pending-queue pattern, so results reach the frontend immediately
    /// without waiting for the next PTY output chunk.
    pub fn async_emitter(&self) -> AsyncEmitter {
        AsyncEmitter {
            tab_id: self.tab_id.to_string(),
            event_tx: self.event_tx.clone(),
        }
    }

    /// Returns a cloneable signaler that async tasks (e.g. ProcessInspectorMod's
    /// timer) can use to notify the engine of agent lifecycle events.
    pub fn async_agent_signaler(&self) -> AsyncAgentSignaler {
        AsyncAgentSignaler {
            tab_id: self.tab_id.to_string(),
            agent_tx: self.agent_tx.clone(),
        }
    }
}


/// A `Clone + Send` emitter for use inside `tokio::spawn` tasks.
#[derive(Clone)]
pub struct AsyncEmitter {
    pub tab_id: String,
    event_tx: mpsc::Sender<ModEvent>,
}

impl AsyncEmitter {
    pub fn emit(&self, mod_id: &'static str, event: &str, data: serde_json::Value) {
        let _ = self.event_tx.try_send(ModEvent {
            tab_id: self.tab_id.clone(),
            mod_id,
            event: event.to_string(),
            data,
        });
    }
}

/// A `Clone + Send` agent lifecycle signaler for use inside `tokio::spawn` tasks.
#[derive(Clone)]
pub struct AsyncAgentSignaler {
    pub tab_id: String,
    agent_tx: mpsc::UnboundedSender<AgentSignal>,
}

impl AsyncAgentSignaler {
    pub fn agent_detected(&self, agent: &str, cwd: &str, cmd: &str) {
        let _ = self.agent_tx.send(AgentSignal {
            tab_id: self.tab_id.clone(),
            agent: agent.to_string(),
            cwd: cwd.to_string(),
            cmd: cmd.to_string(),
            kind: AgentSignalKind::Detected,
        });
    }

    pub fn agent_cleared(&self, agent: &str) {
        let _ = self.agent_tx.send(AgentSignal {
            tab_id: self.tab_id.clone(),
            agent: agent.to_string(),
            cwd: String::new(),
            cmd: String::new(),
            kind: AgentSignalKind::Cleared,
        });
    }
}

