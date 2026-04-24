use std::collections::HashMap;
use std::time::Instant;

use crate::mod_engine::{AsyncEmitter, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;
use tokio::sync::watch;

struct GitTabState {
    last_queried_cwd: Option<String>,
    /// Watch sender: updated on each on_cwd_changed; the 60s timer reads the receiver.
    cwd_tx: watch::Sender<Option<String>>,
    timer: Option<tokio::task::JoinHandle<()>>,
    /// OSC 133 parser — detects command-done sequences to trigger immediate git refresh.
    osc_parser: OscParser,
    /// Timestamp of the last triggered git query, used to debounce rapid re-runs.
    last_query_at: Option<Instant>,
}

/// Monitors git context for the tab's current working directory.
///
/// Triggers:
/// 1. CWD change (received via `on_cwd_changed` push from the engine)
/// 2. Command done — OSC 133;D fired by the shell after any command exits
/// 3. 60-second periodic refresh timer (fallback for shells without OSC 133)
///
/// Trigger 2 fixes the common case where a command like `git push` or `git pull`
/// changes remote tracking state without changing the CWD. The 60-second timer
/// remains as a safety net but should rarely be the first to catch an update.
///
/// Emits `git_info` events with branch, ahead/behind, dirty, worktree, and PR.
pub struct GitMonitorMod {
    tabs: HashMap<String, GitTabState>,
}

impl GitMonitorMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }

    fn spawn_git_query(&self, cwd: String, emitter: AsyncEmitter) {
        tokio::spawn(async move {
            let data = query_git_info(&cwd).await;
            emitter.emit("git_monitor", "git_info", data);
        });
    }
}

impl Mod for GitMonitorMod {
    fn id(&self) -> &'static str {
        "git_monitor"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let (cwd_tx, cwd_rx) = watch::channel::<Option<String>>(None);
        let emitter = ctx.async_emitter();

        // 60-second periodic refresh: reads the latest CWD from the watch receiver.
        let timer = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            interval.tick().await; // skip immediate tick
            loop {
                interval.tick().await;
                let cwd = cwd_rx.borrow().clone();
                if let Some(cwd) = cwd {
                    let data = query_git_info(&cwd).await;
                    emitter.emit("git_monitor", "git_info", data);
                }
            }
        });

        self.tabs.insert(
            ctx.tab_id.to_string(),
            GitTabState {
                last_queried_cwd: None,
                cwd_tx,
                timer: Some(timer),
                osc_parser: OscParser::new(),
                last_query_at: None,
            },
        );
    }

    /// Watches for OSC 133;D (command done) sequences and fires an immediate git
    /// re-query when one is detected. This keeps the status bar up-to-date after
    /// commands like `git push`, `git pull`, `git commit`, or `git merge` that
    /// change git state without changing the working directory.
    ///
    /// A 2-second debounce prevents a storm of parallel queries when commands
    /// complete in rapid succession.
    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
            return;
        };

        let mut command_done = false;
        for seq in state.osc_parser.feed(data) {
            // OSC 133;D = command done. Arg is "D" (exit 0) or "D;N" (exit N).
            if seq.code == 133 && seq.arg.starts_with('D') {
                command_done = true;
                break;
            }
        }

        if !command_done {
            return;
        }

        // Debounce: skip if a query fired within the last 2 seconds.
        let now = Instant::now();
        if let Some(last) = state.last_query_at {
            if now.duration_since(last).as_secs() < 2 {
                return;
            }
        }

        // No CWD known yet — shell integration may not have fired OSC 7 yet.
        let cwd = match state.cwd_tx.borrow().clone() {
            Some(c) => c,
            None => return,
        };

        state.last_query_at = Some(now);
        self.spawn_git_query(cwd, ctx.async_emitter());
    }

    fn on_cwd_changed(&mut self, cwd: &str, ctx: &ModContext) {
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
            return;
        };

        // Debounce: skip if same CWD as last query.
        if state.last_queried_cwd.as_deref() == Some(cwd) {
            return;
        }
        state.last_queried_cwd = Some(cwd.to_string());

        // Update the watch sender so the 60s timer picks up the new CWD.
        let _ = state.cwd_tx.send(Some(cwd.to_string()));

        // Fire an immediate git query for the new directory.
        state.last_query_at = Some(Instant::now());
        self.spawn_git_query(cwd.to_string(), ctx.async_emitter());
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(state) = self.tabs.remove(ctx.tab_id) {
            if let Some(handle) = state.timer {
                handle.abort();
            }
        }
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
