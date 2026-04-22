use std::collections::HashMap;

use crate::mod_engine::{AsyncEmitter, Mod, ModContext};
use tokio::sync::watch;

struct InspectorTabState {
    /// Watch sender: updated on each on_cwd_changed; the 2s timer reads the receiver.
    cwd_tx: watch::Sender<Option<String>>,
    handle: tokio::task::JoinHandle<()>,
}

/// Periodically scans for agent processes (claude, codex, node) in the tab's cwd
/// and emits `process_info` events with per-process metadata and listening ports.
///
/// Scan interval: every 2 seconds while the tab is open.
pub struct ProcessInspectorMod {
    tabs: HashMap<String, InspectorTabState>,
}

impl ProcessInspectorMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }
}

impl Mod for ProcessInspectorMod {
    fn id(&self) -> &'static str {
        "process_inspector"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let (cwd_tx, mut cwd_rx) = watch::channel::<Option<String>>(None);
        let emitter = ctx.async_emitter();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
            loop {
                interval.tick().await;
                let cwd = cwd_rx.borrow().clone();
                let Some(cwd) = cwd else { continue };

                let processes = scan_processes(&cwd).await;
                emitter.emit(
                    "process_inspector",
                    "process_info",
                    serde_json::json!({ "processes": processes }),
                );
            }
        });

        self.tabs.insert(ctx.tab_id.to_string(), InspectorTabState { cwd_tx, handle });
    }

    fn on_cwd_changed(&mut self, cwd: &str, ctx: &ModContext) {
        if let Some(state) = self.tabs.get(ctx.tab_id) {
            let _ = state.cwd_tx.send(Some(cwd.to_string()));
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(state) = self.tabs.remove(ctx.tab_id) {
            state.handle.abort();
        }
    }
}

/// A single process entry in the `process_info` event.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessEntry {
    pid: u32,
    command: String,
    name: String,
    /// Lifetime CPU average from `ps pcpu=`. NOT suitable for live UI display —
    /// heavily diluted for long-running processes. Collected for completeness only.
    cpu_percent: f32,
    memory_kb: u64,
    elapsed_time: String,
    listening_ports: Vec<u16>,
}

/// Scan for agent processes in the given cwd and return enriched entries.
async fn scan_processes(cwd: &str) -> Vec<serde_json::Value> {
    let raw = find_agent_processes(cwd).await;
    if raw.is_empty() {
        return Vec::new();
    }

    let pids: Vec<u32> = raw.iter().map(|p| p.0).collect();
    let ports_map = find_listening_ports_per_pid(&pids).await;

    raw.into_iter()
        .map(|(pid, command, cpu_percent, memory_kb, elapsed_time)| {
            let name = process_name(&command);
            let listening_ports = ports_map.get(&pid).cloned().unwrap_or_default();
            let entry = ProcessEntry {
                pid,
                command,
                name,
                cpu_percent,
                memory_kb,
                elapsed_time,
                listening_ports,
            };
            serde_json::to_value(entry).unwrap_or(serde_json::json!(null))
        })
        .collect()
}

/// Extract the basename of the first token in a command string.
/// e.g. `/usr/local/bin/node server.js` → `node`
fn process_name(command: &str) -> String {
    let first = command.split_whitespace().next().unwrap_or(command);
    std::path::Path::new(first)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(first)
        .to_string()
}

/// Run `ps -ax -o pid=,wdir=,pcpu=,rss=,etime=,command=` and filter for
/// agent processes (claude, codex, node) whose wdir matches cwd.
///
/// Returns tuples of (pid, command, cpu_percent, memory_kb, elapsed_time).
/// `command=` is placed last so it captures the full argv including spaces.
async fn find_agent_processes(cwd: &str) -> Vec<(u32, String, f32, u64, String)> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        tokio::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,wdir=,pcpu=,rss=,etime=,command="])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut results = Vec::new();
    for line in text.lines() {
        // Fields: pid wdir pcpu rss etime command...
        // Split into 6 parts: first 5 are fixed, 6th is command (may have spaces).
        let mut parts = line.trim().splitn(6, char::is_whitespace);
        let pid_str = match parts.next() { Some(s) => s.trim(), None => continue };
        let wdir = match parts.next() { Some(s) => s.trim(), None => continue };
        let pcpu_str = match parts.next() { Some(s) => s.trim(), None => continue };
        let rss_str = match parts.next() { Some(s) => s.trim(), None => continue };
        let etime = match parts.next() { Some(s) => s.trim(), None => continue };
        let command = match parts.next() { Some(s) => s.trim(), None => continue };

        if wdir != cwd {
            continue;
        }

        let name = process_name(command).to_lowercase();
        let is_agent = name == "claude"
            || name == "codex"
            || name == "node";

        if !is_agent {
            continue;
        }

        let Ok(pid) = pid_str.parse::<u32>() else { continue };
        let cpu_percent = pcpu_str.parse::<f32>().unwrap_or(0.0);
        let memory_kb = rss_str.parse::<u64>().unwrap_or(0);

        results.push((pid, command.to_string(), cpu_percent, memory_kb, etime.to_string()));
    }

    results
}

/// Run `lsof -nP -a -p <pids> -iTCP -sTCP:LISTEN -Fpn` and parse listening
/// ports per PID. Returns a map of pid → sorted port list.
async fn find_listening_ports_per_pid(pids: &[u32]) -> HashMap<u32, Vec<u16>> {
    let pid_arg = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");

    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        tokio::process::Command::new("lsof")
            .args(["-nP", "-a", "-p", &pid_arg, "-iTCP", "-sTCP:LISTEN", "-Fpn"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return HashMap::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut result: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut current_pid: Option<u32> = None;

    for line in text.lines() {
        if let Some(pid_str) = line.strip_prefix('p') {
            current_pid = pid_str.parse().ok();
        } else if let Some(addr) = line.strip_prefix('n') {
            if let Some(pid) = current_pid {
                if let Some(port_str) = addr.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        result.entry(pid).or_default().push(port);
                    }
                }
            }
        }
    }

    for ports in result.values_mut() {
        ports.sort_unstable();
        ports.dedup();
    }

    result
}
