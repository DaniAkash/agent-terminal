use std::collections::HashMap;

use crate::mod_engine::{Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;

/// Process lifecycle state for a single tab, driven by OSC 133 sequences.
///
/// Transitions:
///   OSC 133;A → Idle   (prompt displayed)
///   OSC 133;B → Running (command started)
///   OSC 133;D;0 → Done(0)  (success exit)
///   OSC 133;D;N → Error(N) (non-zero exit)
#[derive(PartialEq, Clone)]
enum ProcStatus {
    Idle,
    Running,
    Done(i32),
    Error(i32),
}

struct TabState {
    parser: OscParser,
    status: ProcStatus,
}

/// Watches OSC 133 sequences and emits `status_changed` events.
pub struct ProcessTrackerMod {
    tabs: HashMap<String, TabState>,
}

impl ProcessTrackerMod {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
        }
    }
}

impl Mod for ProcessTrackerMod {
    fn id(&self) -> &'static str {
        "process_tracker"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.tabs.insert(
            ctx.tab_id.to_string(),
            TabState {
                parser: OscParser::new(),
                status: ProcStatus::Idle,
            },
        );
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
            return;
        };

        let mut events: Vec<serde_json::Value> = Vec::new();

        for seq in state.parser.feed(data) {
            if seq.code != 133 {
                continue;
            }

            let new_status = if seq.arg.starts_with('A') {
                ProcStatus::Idle
            } else if seq.arg.starts_with('B') {
                ProcStatus::Running
            } else if let Some(rest) = seq.arg.strip_prefix('D') {
                // rest is either "" (treated as 0) or ";N"
                let exit_code: i32 = if let Some(code_str) = rest.strip_prefix(';') {
                    code_str.parse().unwrap_or(0)
                } else {
                    0
                };
                if exit_code == 0 {
                    ProcStatus::Done(0)
                } else {
                    ProcStatus::Error(exit_code)
                }
            } else {
                continue;
            };

            // Only emit on actual state transition
            if new_status == state.status {
                continue;
            }
            state.status = new_status.clone();

            let (status_str, exit_code) = match &new_status {
                ProcStatus::Idle => ("idle", None),
                ProcStatus::Running => ("running", None),
                ProcStatus::Done(c) => ("done", Some(*c)),
                ProcStatus::Error(c) => ("error", Some(*c)),
            };

            let event_data = if let Some(code) = exit_code {
                serde_json::json!({ "status": status_str, "exitCode": code })
            } else {
                serde_json::json!({ "status": status_str })
            };

            events.push(event_data);
        }

        let mod_id = self.id();
        for event_data in events {
            ctx.emit(mod_id, "status_changed", event_data);
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.tabs.remove(ctx.tab_id);
    }
}
