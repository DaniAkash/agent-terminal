use std::collections::HashMap;

use crate::mod_engine::{AsyncAgentSignaler, Mod, ModContext};
use tokio::sync::watch;

struct InspectorTabState {
    cwd_tx: watch::Sender<Option<String>>,
    handle: tokio::task::JoinHandle<()>,
}

/// Periodically scans for ALL direct children of the tab's shell process and
/// emits `process_info` events, enabling the status bar to show live metrics
/// (name, PID, memory, elapsed time, listening ports) for any running process —
/// not only claude/codex agent sessions.
///
/// Uses `ps -o ppid=` to detect processes by parent PID — correctly scoped to
/// only processes launched FROM this terminal tab.
///
/// Memory and CPU are aggregated across the process subtree (direct child +
/// its children) so launchers like `npx`, `bun run`, and `cargo run` report
/// accurate totals rather than just the wrapper process's footprint.
///
/// Port scanning also covers every descendant of the shell (up to
/// `MAX_DESCENDANT_DEPTH`) so the actual listening server is detected even
/// when the tree is deep, e.g. an agent CLI spawning a subshell that spawns
/// the server.
///
/// Uses `ps -o args=` for command line args (sysinfo can't read cmd on macOS).
/// Uses `sysinfo` for CPU/memory metrics (fast, no subprocess).
/// Uses `lsof -iTCP` for listening port detection.
///
/// Agent detection is registry-driven via `diff_agent_pids` + `identify_agent`
/// (see `crate::agents`), emitting the agent's stable id so `AgentIdentityMod`
/// and the state engine resolve it without hardcoded names.
///
/// Scan interval: every 2 seconds while the tab is open.
pub struct ShellProcessMod {
    tabs: HashMap<String, InspectorTabState>,
}

impl ShellProcessMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }
}

impl Mod for ShellProcessMod {
    fn id(&self) -> &'static str {
        "shell_process"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let shell_pid = ctx.shell_pid;
        let (cwd_tx, cwd_rx) = watch::channel::<Option<String>>(None);
        let emitter = ctx.async_emitter();
        let signaler = ctx.async_agent_signaler();

        let handle = tokio::spawn(async move {
            let mut prev_pids: HashMap<String, u32> = HashMap::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
            let cwd_rx = cwd_rx;

            loop {
                interval.tick().await;

                let cwd = cwd_rx.borrow().clone();
                let processes = scan_processes(shell_pid).await;

                emitter.emit(
                    "shell_process",
                    "process_info",
                    serde_json::json!({ "processes": processes }),
                );

                // Skip agent diffing until the CWD is known — avoids emitting
                // agent_detected with an empty CWD string on the first scan tick.
                if let Some(ref cwd) = cwd {
                    diff_agent_pids(&processes, &mut prev_pids, cwd, &signaler);
                }
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

fn diff_agent_pids(
    processes: &[serde_json::Value],
    prev_pids: &mut HashMap<String, u32>,
    cwd: &str,
    signaler: &AsyncAgentSignaler,
) {
    let mut current_pids: HashMap<String, (u32, String)> = HashMap::new();
    for proc in processes {
        let name = proc.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let cmd = proc.get("command").and_then(|c| c.as_str()).unwrap_or("");
        if let Some(agent_id) = identify_agent(name, cmd) {
            if let Some(pid) = proc.get("pid").and_then(|p| p.as_u64()) {
                current_pids.insert(agent_id.to_string(), (pid as u32, cmd.to_string()));
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

/// Resolve a process (`name` from sysinfo, lowercased; `command` full argv) to
/// a known agent id, or `None`.
///
/// A direct process-name match wins. Otherwise, for agents that can run under a
/// JS/py runtime (`runtime_wrapped`), walk argv for a token whose basename names
/// such an agent, so `bun /…/opencode serve` resolves to opencode.
fn identify_agent(name: &str, command: &str) -> Option<&'static str> {
    if let Some(profile) = crate::agents::by_process_name(name) {
        return Some(profile.id);
    }
    if is_runtime_wrapper(name) {
        for token in command.split_whitespace() {
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            if let Some(profile) = crate::agents::by_process_name(base) {
                if profile.runtime_wrapped {
                    return Some(profile.id);
                }
            }
        }
    }
    None
}

fn is_runtime_wrapper(name: &str) -> bool {
    matches!(
        name,
        "node" | "bun" | "deno" | "python" | "python3" | "sh" | "bash" | "zsh" | "fish"
    )
}

#[cfg(test)]
mod tests {
    use super::{identify_agent, walk_descendants};
    use std::collections::HashMap;

    #[test]
    fn direct_process_names_resolve() {
        assert_eq!(identify_agent("claude", "claude"), Some("claude-code"));
        assert_eq!(identify_agent("codex", "codex --sandbox"), Some("codex"));
        assert_eq!(identify_agent("opencode", "/usr/local/bin/opencode"), Some("opencode"));
    }

    #[test]
    fn runtime_wrapped_opencode_resolves_via_argv() {
        assert_eq!(
            identify_agent("bun", "bun /Users/x/.opencode/bin/opencode serve"),
            Some("opencode")
        );
        assert_eq!(identify_agent("node", "node /opt/opencode tui"), Some("opencode"));
    }

    #[test]
    fn non_agents_are_ignored() {
        assert_eq!(identify_agent("bash", "bash"), None);
        assert_eq!(identify_agent("vim", "vim file.txt"), None);
        assert_eq!(identify_agent("node", "node /x/some-other-app.js"), None);
    }

    #[test]
    fn wrapper_walk_only_applies_to_runtime_wrapped_agents() {
        // claude is not runtime_wrapped, so a bun-wrapped `claude` token must
        // not match through the argv walk (direct name match is the only path).
        assert_eq!(identify_agent("bun", "bun /x/claude"), None);
    }

    // ---- walk_descendants ----

    #[test]
    fn walk_descendants_handles_deep_agent_subtree() {
        // Regression test for the port-visibility bug: an agent-nested server
        // sits 4 levels below the shell (shell → agent → subshell → server).
        // Every descendant must map back to the direct-child root so lsof
        // attribution finds it.
        //
        // Synthetic tree:
        //   shell (100)  ← not passed as root; the caller passes direct children
        //     node/claude (200)   ← ROOT (direct child of shell)
        //       bash (300)        ← depth 1 below root
        //         bun/dev (400)   ← depth 2, opens port
        //           node/vite (500) ← depth 3, real listener
        let mut edges = HashMap::new();
        edges.insert(100, vec![200]);
        edges.insert(200, vec![300]);
        edges.insert(300, vec![400]);
        edges.insert(400, vec![500]);

        let mut got = walk_descendants(&[200], &edges, 8);
        got.sort();
        assert_eq!(got, vec![(300, 200), (400, 200), (500, 200)]);
    }

    #[test]
    fn walk_descendants_respects_depth_cap() {
        // Chain of 10 processes with cap=3 must yield exactly 3 descendants.
        let mut edges = HashMap::new();
        let chain: Vec<u32> = (1..=10).map(|i| i * 10).collect();
        for pair in chain.windows(2) {
            edges.insert(pair[0], vec![pair[1]]);
        }

        let out = walk_descendants(&[chain[0]], &edges, 3);
        assert_eq!(out.len(), 3, "depth cap should stop the walk after 3 levels");
        assert!(
            out.iter().all(|(_, root)| *root == chain[0]),
            "every descendant should attribute to the single root",
        );
    }

    #[test]
    fn walk_descendants_handles_multiple_roots_and_siblings() {
        // root A (100) fans out to two children, each with one child.
        // root B (200) is a chain of 3.
        let mut edges = HashMap::new();
        edges.insert(100, vec![110, 120]);
        edges.insert(110, vec![111]);
        edges.insert(120, vec![121]);
        edges.insert(200, vec![210]);
        edges.insert(210, vec![211]);
        edges.insert(211, vec![212]);

        let out = walk_descendants(&[100, 200], &edges, 8);
        let root_of = |pid: u32| out.iter().find(|(d, _)| *d == pid).map(|(_, r)| *r);
        assert_eq!(root_of(110), Some(100));
        assert_eq!(root_of(111), Some(100));
        assert_eq!(root_of(120), Some(100));
        assert_eq!(root_of(121), Some(100));
        assert_eq!(root_of(210), Some(200));
        assert_eq!(root_of(211), Some(200));
        assert_eq!(root_of(212), Some(200));
    }

    #[test]
    fn walk_descendants_ignores_cycles_defensively() {
        // Real `ps` output cannot produce cycles, but if the parser saw one,
        // the `seen` set should prevent an infinite walk.
        let mut edges = HashMap::new();
        edges.insert(100, vec![200]);
        edges.insert(200, vec![300]);
        edges.insert(300, vec![100]); // cycle back to root

        let out = walk_descendants(&[100], &edges, 8);
        // 200 and 300 attributed to 100; 100 itself never re-attributed.
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|(_, r)| *r == 100));
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessEntry {
    pid: u32,
    command: String,
    name: String,
    cpu_percent: f32,
    memory_kb: u64,
    elapsed_time: String,
    listening_ports: Vec<u16>,
}

/// Scan for all direct children of `shell_pid` that have been running for at
/// least 2 seconds, collecting aggregated metrics across the process subtree.
async fn scan_processes(shell_pid: u32) -> Vec<serde_json::Value> {
    if shell_pid == 0 {
        return Vec::new();
    }

    // Step 1: find all direct children of shell_pid
    let pids = find_children_of_shell(shell_pid).await;
    if pids.is_empty() {
        return Vec::new();
    }

    // Step 2: get full cmd args via ps (sysinfo can't read cmd on macOS)
    let args_map = get_process_args(&pids).await;

    // Step 3: build the subtree attribution map (pid → root direct-child pid).
    // This single ps scan is shared by both metric aggregation and port scanning
    // so the system is only queried once per poll cycle for the whole subtree.
    //
    // Real-world trees run several levels deep. Common cases:
    //   shell → launcher (npx / bun run / cargo run) → server           (depth 2)
    //   shell → agent CLI (claude / codex / opencode) → subshell → server (depth 3)
    //   shell → tmux → shell → task-runner → server                     (depth 4+)
    // Without descendant attribution, memory shows only the top launcher's
    // footprint and port scanning misses the server's bound port entirely.
    let descendants = find_descendants(&pids).await;
    let mut attribution: HashMap<u32, u32> = pids.iter().map(|&p| (p, p)).collect();
    for (descendant, root) in &descendants {
        attribution.insert(*descendant, *root);
    }

    // Step 4: get CPU/memory/elapsed via sysinfo (not Send — spawn_blocking).
    // Memory and CPU are summed across the direct child + every descendant in
    // the attribution map so the status bar reflects the full process tree
    // footprint, not just the wrapper.
    let pids_clone = pids.clone();
    let attribution_clone = attribution.clone();
    let raw = tokio::task::spawn_blocking(move || {
        get_process_metrics(&pids_clone, &attribution_clone)
    })
    .await
    .unwrap_or_default();

    if raw.is_empty() {
        return Vec::new();
    }

    // Step 5: listening ports via lsof TCP, using the pre-built attribution map.
    let metric_pids: Vec<u32> = raw.iter().map(|p| p.0).collect();
    let ports_map = find_listening_ports_per_pid(&metric_pids, &attribution).await;

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

/// Find PIDs of all direct children of `shell_pid`.
///
/// Uses `ps -ax -o pid=,ppid=,comm=` — fast (no file I/O), cross-platform
/// (macOS and Linux). Elapsed-time filtering happens in `get_process_metrics`
/// using sysinfo, which avoids any reliance on `ps` keyword availability
/// (`etimes` is Linux-only; macOS `ps` does not support it).
async fn find_children_of_shell(shell_pid: u32) -> Vec<u32> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        tokio::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,ppid=,comm="])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut pids = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let pid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        let ppid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        // comm consumed but not used — any process name qualifies
        if parts.next().is_none() { continue; }

        if ppid == shell_pid {
            pids.push(pid);
        }
    }
    pids
}

/// Bounded recursion cap for descendant walk. Covers real-world agent stacks
/// (agent CLI → wrapper → shell → task-runner → server ≈ 5 levels) with
/// headroom for tmux-inside-tmux and future architectures. Any process tree
/// deeper than this is diagnosing itself; capping here hard-stops a malformed
/// `ps` stream from turning into a runaway walk.
const MAX_DESCENDANT_DEPTH: usize = 8;

/// Return (descendant_pid, root_direct_child_pid) pairs for every descendant
/// of `pids` up to `MAX_DESCENDANT_DEPTH` levels deep.
///
/// A single `ps -ax -o pid=,ppid=` scan captures every parent → child edge in
/// the system; BFS from each root walks the subtree without further process-
/// list queries. Attribution collapses each descendant to the top-level
/// ancestor in `pids` (the direct child of the shell), so downstream callers
/// (memory aggregation, port scanning) can group by that root.
///
/// Replaces the pre-2026-07 `find_grandchildren` which only expanded one
/// level. That was fine for the shell → launcher → server pattern but missed
/// servers spawned inside a Claude Code, Codex, or OpenCode subtree, where
/// the actual listener sits at depth 3+ (shell → agent → subshell → server).
async fn find_descendants(pids: &[u32]) -> Vec<(u32, u32)> {
    if pids.is_empty() {
        return Vec::new();
    }
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        tokio::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,ppid="])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else { return Vec::new() };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(child) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(ppid) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        children_by_parent.entry(ppid).or_default().push(child);
    }

    walk_descendants(pids, &children_by_parent, MAX_DESCENDANT_DEPTH)
}

/// Pure BFS core, extracted so tests can drive it with synthetic edge sets
/// without going through `ps`. See `find_descendants` for callsite semantics.
fn walk_descendants(
    roots: &[u32],
    children_by_parent: &HashMap<u32, Vec<u32>>,
    max_depth: usize,
) -> Vec<(u32, u32)> {
    let mut pairs = Vec::new();
    // `seen` includes the roots themselves so a root that (impossibly) shows
    // up as a child of another PID is not re-attributed.
    let mut seen: std::collections::HashSet<u32> = roots.iter().cloned().collect();
    for &root in roots {
        let mut frontier: Vec<u32> = vec![root];
        for _ in 0..max_depth {
            let mut next = Vec::new();
            for parent in &frontier {
                if let Some(kids) = children_by_parent.get(parent) {
                    for &child in kids {
                        if !seen.insert(child) {
                            continue;
                        }
                        pairs.push((child, root));
                        next.push(child);
                    }
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
    }
    pairs
}

/// Get full command + args for specific PIDs via `ps -o args=`.
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
        if let Some(space) = line.find(char::is_whitespace) {
            if let Ok(pid) = line[..space].trim().parse::<u32>() {
                let cmd = line[space..].trim().to_string();
                result.insert(pid, cmd);
            }
        }
    }
    result
}

/// Read metrics for `direct_pids`, aggregating memory and CPU across the full
/// subtree described by `attribution` (pid → root direct-child pid).
///
/// - **name / elapsed**: taken from the direct child only (the process the user
///   invoked). The launcher's identity is what matters for display.
/// - **memory_kb**: sum of the direct child + every descendant in the
///   attribution map. Reflects the true memory footprint of the process tree.
/// - **cpu_percent**: sum across the subtree. May exceed 100% on multi-core
///   systems when the server is CPU-bound, which is accurate and expected.
///
/// Processes where the direct child has been running for less than 2 seconds
/// are excluded to prevent transient commands from flashing in the status bar.
/// (`etimes` is Linux-only; sysinfo start_time is used instead.)
fn get_process_metrics(
    direct_pids: &[u32],
    attribution: &HashMap<u32, u32>,
) -> Vec<(u32, String, f32, u64, String)> {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    // Refresh sysinfo for every PID in the subtree at once.
    let all_pids: Vec<u32> = attribution.keys().cloned().collect();
    let sysinfo_pids: Vec<Pid> = all_pids.iter().map(|&p| Pid::from(p as usize)).collect();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&sysinfo_pids), true);

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Collect raw per-pid data from sysinfo.
    // (pid, name, cpu_percent, memory_kb, elapsed_secs)
    let raw: HashMap<u32, (String, f32, u64, u64)> = all_pids
        .iter()
        .filter_map(|&pid| {
            let p = sys.process(Pid::from(pid as usize))?;
            let name = p.name().to_string_lossy().to_lowercase();
            let name = name.trim_end_matches('\0').to_string();
            Some((pid, (name, p.cpu_usage(), p.memory() / 1024, now_secs.saturating_sub(p.start_time()))))
        })
        .collect();

    // For each direct child, aggregate subtree memory + CPU.
    direct_pids
        .iter()
        .filter_map(|&root_pid| {
            let (name, _, _, elapsed_secs) = raw.get(&root_pid)?;

            // Skip transient commands — they will likely exit before the next poll.
            if *elapsed_secs < 2 {
                return None;
            }

            let mut total_memory_kb: u64 = 0;
            let mut total_cpu: f32 = 0.0;

            // Sum across every pid attributed to this root (includes every
            // descendant up to MAX_DESCENDANT_DEPTH).
            for (&pid, &root) in attribution {
                if root == root_pid {
                    if let Some((_, cpu, mem, _)) = raw.get(&pid) {
                        total_memory_kb += mem;
                        total_cpu += cpu;
                    }
                }
            }

            let elapsed_time = format_elapsed(*elapsed_secs);
            Some((root_pid, name.clone(), total_cpu, total_memory_kb, elapsed_time))
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

/// Scan listening TCP ports for `direct_pids` using the pre-built `attribution`
/// map (pid → root direct-child pid) to include every descendant without an
/// extra ps call.
///
/// Descendant ports are attributed to the top-level direct-child PID so the
/// status bar entry stays stable and correct, regardless of how deep the
/// binding process actually sits.
async fn find_listening_ports_per_pid(
    direct_pids: &[u32],
    attribution: &HashMap<u32, u32>,
) -> HashMap<u32, Vec<u16>> {
    if direct_pids.is_empty() {
        return HashMap::new();
    }

    let all_pids: Vec<u32> = attribution.keys().cloned().collect();
    let pid_arg = all_pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");

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
    let mut current_attributed_pid: Option<u32> = None;

    for line in text.lines() {
        if let Some(pid_str) = line.strip_prefix('p') {
            // Resolve lsof's raw PID to the direct-child PID shown in the UI.
            current_attributed_pid = pid_str
                .parse::<u32>()
                .ok()
                .and_then(|raw| attribution.get(&raw).copied());
        } else if let Some(addr) = line.strip_prefix('n') {
            if let Some(pid) = current_attributed_pid {
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
