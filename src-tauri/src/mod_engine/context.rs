use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};

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

/// Context passed to every MOD callback. Provides tab identity and event emission.
pub struct ModContext<'a> {
    pub tab_id: &'a str,
    event_tx: &'a mpsc::Sender<ModEvent>,
}

impl<'a> ModContext<'a> {
    pub fn new(tab_id: &'a str, event_tx: &'a mpsc::Sender<ModEvent>) -> Self {
        Self { tab_id, event_tx }
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
}

/// Shared registry of the current working directory per tab.
///
/// `DirTrackerMod` (PR 8) writes on each OSC 7 sequence. Other MODs
/// (`GitMonitorMod`, `ClaudeCodeMod`, `CodexMod`) read this to know where to
/// look for session files and git context without re-parsing OSC themselves.
#[allow(dead_code)]
pub type CwdRegistry = Arc<RwLock<HashMap<String, String>>>;
