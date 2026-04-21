use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::mod_engine::{CwdRegistry, Mod, ModContext};

struct GitTabState {
    last_queried_cwd: Option<String>,
    /// Periodic refresh handle (60s interval).
    timer: Option<tokio::task::JoinHandle<()>>,
}

/// Monitors git context for the tab's current working directory.
///
/// Triggers:
/// 1. CWD change (detected via CwdRegistry comparison in on_output)
/// 2. 60-second periodic refresh timer
///
/// Emits `git_info` events with branch, ahead/behind, dirty, worktree, and PR.
pub struct GitMonitorMod {
    cwd_registry: CwdRegistry,
    tabs: HashMap<String, GitTabState>,
    /// Async git query results, drained in on_output.
    pending: Arc<Mutex<VecDeque<(String, serde_json::Value)>>>,
}

impl GitMonitorMod {
    pub fn new(cwd_registry: CwdRegistry) -> Self {
        Self {
            cwd_registry,
            tabs: HashMap::new(),
            pending: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn spawn_git_query(&self, tab_id: &str, cwd: String) {
        let tab_id = tab_id.to_string();
        let pending = Arc::clone(&self.pending);
        tokio::spawn(async move {
            let data = query_git_info(&cwd).await;
            pending.lock().unwrap().push_back((tab_id, data));
        });
    }
}

impl Mod for GitMonitorMod {
    fn id(&self) -> &'static str {
        "git_monitor"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let tab_id = ctx.tab_id.to_string();
        let cwd_registry = Arc::clone(&self.cwd_registry);
        let pending = Arc::clone(&self.pending);
        let tab_id_clone = tab_id.clone();

        // 60-second periodic refresh
        let timer = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            interval.tick().await; // skip immediate tick
            loop {
                interval.tick().await;
                let cwd = {
                    let reg = cwd_registry.read().await;
                    reg.get(&tab_id_clone).cloned()
                };
                if let Some(cwd) = cwd {
                    let data = query_git_info(&cwd).await;
                    pending.lock().unwrap().push_back((tab_id_clone.clone(), data));
                }
            }
        });

        self.tabs.insert(
            tab_id,
            GitTabState {
                last_queried_cwd: None,
                timer: Some(timer),
            },
        );
    }

    fn on_output(&mut self, _data: &[u8], ctx: &ModContext) {
        // Drain pending git results for this tab
        {
            let mut queue = self.pending.lock().unwrap();
            let mut remaining = VecDeque::new();
            while let Some((tid, data)) = queue.pop_front() {
                if tid == ctx.tab_id {
                    ctx.emit(self.id(), "git_info", data);
                } else {
                    remaining.push_back((tid, data));
                }
            }
            *queue = remaining;
        }

        // Check for cwd change
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
            return;
        };

        let current_cwd = {
            let reg = self.cwd_registry.blocking_read();
            reg.get(ctx.tab_id).cloned()
        };

        if let Some(ref cwd) = current_cwd {
            if state.last_queried_cwd.as_deref() != Some(cwd.as_str()) {
                state.last_queried_cwd = Some(cwd.clone());
                self.spawn_git_query(ctx.tab_id, cwd.clone());
            }
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(state) = self.tabs.remove(ctx.tab_id) {
            if let Some(handle) = state.timer {
                handle.abort();
            }
        }
        // Clean up pending results for this tab
        let mut queue = self.pending.lock().unwrap();
        queue.retain(|(tid, _)| tid != ctx.tab_id);
    }
}

/// Run all git queries for the given cwd and return a `git_info` payload.
async fn query_git_info(cwd: &str) -> serde_json::Value {
    // 1. Check if it's a git repo
    let root = match run_git(&["rev-parse", "--show-toplevel"], cwd).await {
        Some(r) => r.trim().to_string(),
        None => {
            return serde_json::json!(null);
        }
    };

    // 2. Run parallel queries
    let (branch, counts, dirty, worktree_out) = tokio::join!(
        run_git(&["branch", "--show-current"], &root),
        run_git(&["rev-list", "--count", "--left-right", "HEAD...@{u}"], &root),
        run_git(&["status", "--short"], &root),
        run_git(&["worktree", "list", "--porcelain"], &root),
    );

    let branch = branch.unwrap_or_default().trim().to_string();
    let (ahead, behind) = parse_ahead_behind(counts.as_deref());
    let is_dirty = dirty.map(|s| !s.trim().is_empty()).unwrap_or(false);
    let worktree_name = parse_worktree_name(worktree_out.as_deref().unwrap_or(""), &root);

    // 3. gh pr view — best-effort
    let pr = run_gh_pr(&root).await;

    serde_json::json!({
        "branch": branch,
        "aheadBy": ahead,
        "behindBy": behind,
        "isDirty": is_dirty,
        "worktree": worktree_name,
        "pr": pr,
    })
}

async fn run_git(args: &[&str], cwd: &str) -> Option<String> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        tokio::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        None
    }
}

async fn run_gh_pr(root: &str) -> Option<serde_json::Value> {
    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        tokio::process::Command::new("gh")
            .args(["pr", "view", "--json", "number,title,state,url"])
            .current_dir(root)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if output.status.success() {
        serde_json::from_slice(&output.stdout).ok()
    } else {
        None
    }
}

/// Parse `git rev-list --count --left-right` output format: `"ahead\tbehind"`.
fn parse_ahead_behind(output: Option<&str>) -> (u32, u32) {
    let s = match output {
        Some(s) => s.trim(),
        None => return (0, 0),
    };
    let mut parts = s.splitn(2, '\t');
    let ahead: u32 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
    let behind: u32 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
    (ahead, behind)
}

/// Extract the worktree name from `git worktree list --porcelain` output.
/// Returns the worktree name (last path component) if different from the root.
fn parse_worktree_name(output: &str, root: &str) -> Option<String> {
    // Porcelain format: each block starts with "worktree <path>"
    // The first block is the main worktree — skip it.
    let mut blocks = output.split("\n\n");
    blocks.next(); // skip main

    for block in blocks {
        for line in block.lines() {
            if let Some(path) = line.strip_prefix("worktree ") {
                let path = path.trim();
                // Check if we're currently in this worktree
                if path == root || root.starts_with(path) {
                    return std::path::Path::new(path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }
    None
}
