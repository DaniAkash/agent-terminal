use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
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

/// Context passed to every MOD callback. Provides tab identity and event emission.
pub struct ModContext<'a> {
    pub tab_id: &'a str,
    event_tx: &'a mpsc::Sender<ModEvent>,
    cwd_tx: &'a mpsc::Sender<CwdUpdate>,
    /// The engine's current CWD for this tab, as of the start of this dispatch cycle.
    pub current_cwd: Option<String>,
}

impl<'a> ModContext<'a> {
    pub fn new(
        tab_id: &'a str,
        event_tx: &'a mpsc::Sender<ModEvent>,
        cwd_tx: &'a mpsc::Sender<CwdUpdate>,
        current_cwd: Option<String>,
    ) -> Self {
        Self { tab_id, event_tx, cwd_tx, current_cwd }
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

    /// Returns the engine's current CWD for this tab (set by the most recent
    /// `on_cwd_changed` dispatch). `None` until the first OSC 7 fires.
    pub fn current_cwd(&self) -> Option<&str> {
        self.current_cwd.as_deref()
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

/// Shared registry of the current working directory per tab.
///
/// `DirTrackerMod` writes on each OSC 7 sequence. Other MODs
/// (`GitMonitorMod`, `ClaudeCodeMod`, `CodexMod`) read this to know where to
/// look for session files and git context without re-parsing OSC themselves.
///
/// **Deprecated** — being migrated to the `on_cwd_changed` push model.
/// Will be removed once all consumers use `on_cwd_changed`.
#[allow(dead_code)]
pub type CwdRegistry = Arc<RwLock<HashMap<String, String>>>;
