use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::mod_engine::{CwdRegistry, Mod, ModContext};

type PortQueue = Arc<Mutex<VecDeque<(String, Vec<u16>)>>>;

/// Periodically scans for agent processes (claude, codex, node) in the tab's cwd
/// and emits `listening_ports` events with the TCP ports they are listening on.
///
/// Scan interval: every 2 seconds while the tab is open.
pub struct ProcessInspectorMod {
    cwd_registry: CwdRegistry,
    /// Per-tab: abort handle for the background timer task.
    handles: HashMap<String, tokio::task::JoinHandle<()>>,
    /// Results from async scan tasks, drained in on_output.
    pending: PortQueue,
}

impl ProcessInspectorMod {
    pub fn new(cwd_registry: CwdRegistry) -> Self {
        Self {
            cwd_registry,
            handles: HashMap::new(),
            pending: Arc::new(Mutex::new(VecDeque::new())) as PortQueue,
        }
    }
}

impl Mod for ProcessInspectorMod {
    fn id(&self) -> &'static str {
        "process_inspector"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let tab_id = ctx.tab_id.to_string();
        let cwd_registry = Arc::clone(&self.cwd_registry);
        let pending = Arc::clone(&self.pending);
        let tab_id_clone = tab_id.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
            loop {
                interval.tick().await;
                let cwd = {
                    let reg = cwd_registry.read().unwrap();
                    reg.get(&tab_id_clone).cloned()
                };
                let Some(cwd) = cwd else { continue };

                let ports = scan_ports(&cwd).await;
                pending.lock().unwrap().push_back((tab_id_clone.clone(), ports));
            }
        });

        self.handles.insert(tab_id, handle);
    }

    fn on_output(&mut self, _data: &[u8], ctx: &ModContext) {
        // Drain pending port scan results for this tab
        let mut queue = self.pending.lock().unwrap();
        let mut remaining = VecDeque::new();
        while let Some((tid, ports)) = queue.pop_front() {
            if tid == ctx.tab_id {
                ctx.emit(
                    self.id(),
                    "listening_ports",
                    serde_json::json!({ "ports": ports }),
                );
                // Take only the latest result — discard older ones for same tab
            } else {
                remaining.push_back((tid, ports));
            }
        }
        *queue = remaining;
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(handle) = self.handles.remove(ctx.tab_id) {
            handle.abort();
        }
        // Clean up any pending results for this tab
        let mut queue = self.pending.lock().unwrap();
        queue.retain(|(tid, _)| tid != ctx.tab_id);
    }
}

/// Scan for agent processes in the given cwd and return their listening TCP ports.
async fn scan_ports(cwd: &str) -> Vec<u16> {
    // Step 1: find PIDs of claude/codex/node processes whose working dir matches
    let pids = find_agent_pids(cwd).await;
    if pids.is_empty() {
        return Vec::new();
    }

    // Step 2: find listening ports for those PIDs via lsof
    find_listening_ports(&pids).await
}

/// Run `ps -ax -o pid=,wdir=,comm=` and filter for processes in cwd.
/// Returns a list of PIDs.
async fn find_agent_pids(cwd: &str) -> Vec<u32> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        tokio::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,wdir=,comm="])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut pids = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.trim().splitn(3, char::is_whitespace).collect();
        if parts.len() < 3 {
            continue;
        }
        let pid_str = parts[0].trim();
        let wdir = parts[1].trim();
        let comm = parts[2].trim();

        if wdir != cwd {
            continue;
        }

        let comm_lower = comm.to_lowercase();
        let is_agent = comm_lower == "claude"
            || comm_lower == "codex"
            || comm_lower == "node"
            || comm_lower.ends_with("/claude")
            || comm_lower.ends_with("/codex")
            || comm_lower.ends_with("/node");

        if !is_agent {
            continue;
        }

        if let Ok(pid) = pid_str.parse::<u32>() {
            pids.push(pid);
        }
    }

    pids
}

/// Run `lsof -nP -a -p <pids> -iTCP -sTCP:LISTEN -Fpn` and parse listening ports.
async fn find_listening_ports(pids: &[u32]) -> Vec<u16> {
    let pid_arg = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        tokio::process::Command::new("lsof")
            .args(["-nP", "-a", "-p", &pid_arg, "-iTCP", "-sTCP:LISTEN", "-Fpn"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut ports = std::collections::HashSet::new();
    for line in text.lines() {
        // lsof -F output: lines starting with 'n' contain the address
        // Format: n*:PORT or n127.0.0.1:PORT
        if let Some(addr) = line.strip_prefix('n') {
            if let Some(port_str) = addr.rsplit(':').next() {
                if let Ok(port) = port_str.parse::<u16>() {
                    ports.insert(port);
                }
            }
        }
    }

    let mut result: Vec<u16> = ports.into_iter().collect();
    result.sort_unstable();
    result
}
