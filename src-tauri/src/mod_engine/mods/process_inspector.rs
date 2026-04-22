use std::collections::HashMap;

use crate::mod_engine::{AsyncAgentSignaler, Mod, ModContext};
use tokio::sync::watch;

struct InspectorTabState {
    cwd_tx: watch::Sender<Option<String>>,
    handle: tokio::task::JoinHandle<()>,
}

/// Periodically scans for agent processes (claude, codex, node) in the tab's cwd
/// and emits `process_info` events with per-process metadata and listening ports.
///
/// CWD matching uses `lsof -d cwd` because macOS restricts proc_pidinfo CWD reads
/// (sysinfo's `process.cwd()` always returns None without special entitlements).
/// Metrics (CPU, memory) are read via sysinfo for the matched PIDs.
/// Listening ports are detected via `lsof -iTCP -sTCP:LISTEN`.
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
        let (cwd_tx, cwd_rx) = watch::channel::<Option<String>>(None);
        let emitter = ctx.async_emitter();
        let signaler = ctx.async_agent_signaler();

        let handle = tokio::spawn(async move {
            let mut prev_pids: HashMap<String, u32> = HashMap::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
            let mut cwd_rx = cwd_rx;

            loop {
                interval.tick().await;
                let cwd = cwd_rx.borrow().clone();
                let Some(cwd) = cwd else {
                    eprintln!("[process_inspector] tick: no CWD yet, skipping");
                    continue;
                };

                eprintln!("[process_inspector] scanning cwd={cwd}");
                let processes = scan_processes(&cwd).await;
                eprintln!("[process_inspector] found {} process(es)", processes.len());

                emitter.emit(
                    "process_inspector",
                    "process_info",
                    serde_json::json!({ "processes": processes }),
                );

                diff_agent_pids(&processes, &mut prev_pids, &cwd, &signaler);
            }
        });

        self.tabs.insert(ctx.tab_id.to_string(), InspectorTabState { cwd_tx, handle });
    }

    fn on_cwd_changed(&mut self, cwd: &str, ctx: &ModContext) {
        eprintln!("[process_inspector] on_cwd_changed tab={} cwd={cwd}", ctx.tab_id);
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

fn diff_agent_pids(
    processes: &[serde_json::Value],
    prev_pids: &mut HashMap<String, u32>,
    cwd: &str,
    signaler: &AsyncAgentSignaler,
) {
    let mut current_pids: HashMap<String, (u32, String)> = HashMap::new();
    for proc in processes {
        let name = proc.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if name == "claude" || name == "codex" {
            if let Some(pid) = proc.get("pid").and_then(|p| p.as_u64()) {
                let cmd = proc.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string();
                current_pids.insert(name.to_string(), (pid as u32, cmd));
            }
        }
    }

    for (agent, prev_pid) in prev_pids.iter() {
        match current_pids.get(agent) {
            None => signaler.agent_cleared(agent),
            Some((curr_pid, _)) if curr_pid != prev_pid => { signaler.agent_cleared(agent); }
            _ => {}
        }
    }
    for (agent, (curr_pid, cmd)) in &current_pids {
        match prev_pids.get(agent) {
            None => signaler.agent_detected(agent, cwd, cmd),
            Some(prev_pid) if prev_pid != curr_pid => { signaler.agent_detected(agent, cwd, cmd); }
            _ => {}
        }
    }

    *prev_pids = current_pids.into_iter().map(|(k, (pid, _))| (k, pid)).collect();
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessEntry {
    pid: u32,
    command: String,
    name: String,
    /// Interval-sampled CPU % via sysinfo — accurate for live display.
    cpu_percent: f32,
    /// Resident memory in KB.
    memory_kb: u64,
    elapsed_time: String,
    listening_ports: Vec<u16>,
}

/// Scan for agent processes in `cwd` and return enriched entries.
///
/// Step 1: `lsof -d cwd` to find agent PIDs whose CWD matches (macOS restricts
///         proc_pidinfo CWD reads, so sysinfo's process.cwd() always returns None).
/// Step 2: sysinfo to read CPU/memory/elapsed for those specific PIDs.
/// Step 3: lsof TCP to find listening ports per PID.
async fn scan_processes(cwd: &str) -> Vec<serde_json::Value> {
    // Step 1: find agent PIDs in this cwd via lsof
    let pids = find_agent_pids_in_cwd(cwd).await;
    eprintln!("[process_inspector] agent PIDs in cwd: {:?}", pids);

    if pids.is_empty() {
        return Vec::new();
    }

    // Step 2a: get cmd args via ps (sysinfo can't read cmd on macOS)
    let args_map = get_process_args(&pids).await;

    // Step 2b: get metrics for matched PIDs via sysinfo (not Send — spawn_blocking)
    let pids_for_metrics = pids.clone();
    let raw = tokio::task::spawn_blocking(move || get_process_metrics(&pids_for_metrics))
        .await
        .unwrap_or_default();

    if raw.is_empty() {
        return Vec::new();
    }

    // Step 3: listening ports via lsof TCP
    let metric_pids: Vec<u32> = raw.iter().map(|p| p.0).collect();
    let ports_map = find_listening_ports_per_pid(&metric_pids).await;

    raw.into_iter()
        .map(|(pid, name, cpu_percent, memory_kb, elapsed_time)| {
            let command = args_map.get(&pid).cloned().unwrap_or_default();
            let listening_ports = ports_map.get(&pid).cloned().unwrap_or_default();
            serde_json::to_value(ProcessEntry {
                pid, command, name, cpu_percent, memory_kb, elapsed_time, listening_ports,
            })
            .unwrap_or(serde_json::json!(null))
        })
        .collect()
}

/// Use `lsof -d cwd` to find PIDs of agent processes (claude, codex, node) whose
/// working directory matches `cwd`. Returns matched PIDs.
///
/// macOS does not allow reading other processes' CWDs via proc_pidinfo without
/// special entitlements, so sysinfo's process.cwd() always returns None.
/// lsof uses a different kernel interface that works for same-user processes.
async fn find_agent_pids_in_cwd(cwd: &str) -> Vec<u32> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        tokio::process::Command::new("lsof")
            .args(["-a", "-c", "claude", "-c", "codex", "-d", "cwd", "-Fpn"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    // lsof -Fpn output per process (with -d cwd, one entry per process):
    //   p<pid>
    //   fcwd
    //   n<path>
    let mut pids = Vec::new();
    let mut current_pid: Option<u32> = None;

    for line in text.lines() {
        if let Some(pid_str) = line.strip_prefix('p') {
            current_pid = pid_str.parse().ok();
        } else if let Some(path) = line.strip_prefix('n') {
            if let Some(pid) = current_pid {
                eprintln!("[process_inspector] lsof cwd: pid={pid} path={path}");
                if path == cwd {
                    pids.push(pid);
                }
            }
        }
    }

    pids
}

/// Get cmd args for specific PIDs via `ps -o args=`.
/// sysinfo's `process.cmd()` always returns empty on macOS without entitlements.
async fn get_process_args(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let pid_list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        tokio::process::Command::new("ps")
            .args(["-p", &pid_list, "-o", "pid=,args="])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return HashMap::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut result = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        // format: "12345 claude --some-flag"
        if let Some(space) = line.find(char::is_whitespace) {
            if let Ok(pid) = line[..space].trim().parse::<u32>() {
                let cmd = line[space..].trim().to_string();
                result.insert(pid, cmd);
            }
        }
    }
    result
}

/// Read name, CPU, memory, and elapsed time for specific PIDs via sysinfo.
/// Returns (pid, name, cpu_percent, memory_kb, elapsed_time).
fn get_process_metrics(pids: &[u32]) -> Vec<(u32, String, f32, u64, String)> {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let sysinfo_pids: Vec<Pid> = pids.iter().map(|&p| Pid::from(p as usize)).collect();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&sysinfo_pids), true);

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    pids.iter()
        .filter_map(|&pid| {
            let process = sys.process(Pid::from(pid as usize))?;

            let name = process.name().to_string_lossy().to_lowercase();
            let name = name.trim_end_matches('\0').to_string();

            let cpu_percent = process.cpu_usage();
            let memory_kb = process.memory() / 1024;
            let elapsed_secs = now_secs.saturating_sub(process.start_time());
            let elapsed_time = format_elapsed(elapsed_secs);

            Some((pid, name, cpu_percent, memory_kb, elapsed_time))
        })
        .collect()
}

fn format_elapsed(secs: u64) -> String {
    if secs < 3600 {
        format!("{}:{:02}", secs / 60, secs % 60)
    } else if secs < 86400 {
        format!("{}:{:02}:{:02}", secs / 3600, (secs % 3600) / 60, secs % 60)
    } else {
        format!("{}-{:02}:{:02}", secs / 86400, (secs % 86400) / 3600, (secs % 3600) / 60)
    }
}

/// Run `lsof -nP -a -p <pids> -iTCP -sTCP:LISTEN -Fpn` and return pid → ports.
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
