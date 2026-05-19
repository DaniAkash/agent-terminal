use std::collections::HashMap;
use std::time::Instant;

use crate::mod_engine::{AsyncEmitter, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;
use tokio::sync::watch;

/// Baseline refresh interval when no PR checks are pending.
const REFRESH_BASELINE_SECS: u64 = 60;

/// Faster refresh interval used while a PR has pending checks. Keeps the
/// status bar responsive during active CI runs without spawning a separate
/// polling task.
const REFRESH_PENDING_CHECKS_SECS: u64 = 15;

struct GitTabState {
    last_queried_cwd: Option<String>,
    /// Watch sender: updated on each on_cwd_changed; the refresh timer reads the receiver.
    cwd_tx: watch::Sender<Option<String>>,
    /// Watch sender for the desired refresh cadence. Flips between the
    /// baseline and the pending-checks interval as PR state evolves.
    interval_tx: watch::Sender<u64>,
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
/// 3. Adaptive periodic refresh timer: 60s baseline, 15s while a PR has
///    pending CI checks (fallback for shells without OSC 133, and what
///    drives status bar updates while the user isn't typing)
///
/// Trigger 2 fixes the common case where a command like `git push` or `git pull`
/// changes remote tracking state without changing the CWD. The periodic timer
/// remains as a safety net but should rarely be the first to catch an update.
///
/// Trigger 3's cadence is dynamic so that PR check transitions
/// (queued → running → pass/fail) surface within ~15s during CI, instead of
/// waiting up to 60s. Once `checks.pending` reaches zero the timer collapses
/// back to the baseline — no extra `gh` calls while CI is idle.
///
/// Emits `git_info` events with branch, ahead/behind, dirty, worktree, and PR.
pub struct GitMonitorMod {
    tabs: HashMap<String, GitTabState>,
}

impl GitMonitorMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }
}

/// Spawn a git query and, after it returns, update the per-tab refresh
/// cadence based on whether the PR has pending checks.
///
/// Lives as a free function (not a `&self` method) so callers holding a
/// `&mut GitTabState` from `self.tabs.get_mut(...)` can call it without
/// triggering a `self` re-borrow conflict.
fn spawn_git_query(
    cwd: String,
    emitter: AsyncEmitter,
    interval_tx: watch::Sender<u64>,
) {
    tokio::spawn(async move {
        let data = query_git_info(&cwd).await;
        let desired = desired_interval_secs(&data);
        if *interval_tx.borrow() != desired {
            let _ = interval_tx.send(desired);
        }
        emitter.emit("git_monitor", "git_info", data);
    });
}

impl Mod for GitMonitorMod {
    fn id(&self) -> &'static str {
        "git_monitor"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        let (cwd_tx, cwd_rx) = watch::channel::<Option<String>>(None);
        let (interval_tx, mut interval_rx) = watch::channel::<u64>(REFRESH_BASELINE_SECS);
        let emitter = ctx.async_emitter();
        let interval_tx_for_timer = interval_tx.clone();

        // Adaptive periodic refresh:
        //   - Sleeps for the current desired interval (baseline 60s, or 15s
        //     while PR checks are pending). The interval is re-read on every
        //     loop iteration AND we wake early on `interval_rx.changed()` so
        //     transitioning from idle → pending checks doesn't wait out a
        //     full 60s before catching up.
        //   - Reads the latest CWD from the watch receiver each tick.
        let timer = tokio::spawn(async move {
            loop {
                // borrow_and_update advances the watch's seen pointer, so a
                // `send` from the in-loop query below doesn't immediately
                // resolve the `.changed()` future on the next iteration (which
                // would trigger one redundant wake + `continue` per cadence
                // change).
                let secs = *interval_rx.borrow_and_update();
                let sleep = tokio::time::sleep(tokio::time::Duration::from_secs(secs));
                tokio::select! {
                    _ = sleep => {}
                    // Cadence changed — re-loop without firing a query so we
                    // pick up the new interval on the next iteration. Without
                    // this, going from 60s to 15s would still wait 60s once.
                    res = interval_rx.changed() => {
                        if res.is_err() {
                            return; // sender dropped — module closed
                        }
                        continue;
                    }
                }
                let cwd = cwd_rx.borrow().clone();
                if let Some(cwd) = cwd {
                    let data = query_git_info(&cwd).await;
                    let desired = desired_interval_secs(&data);
                    if *interval_tx_for_timer.borrow() != desired {
                        let _ = interval_tx_for_timer.send(desired);
                    }
                    emitter.emit("git_monitor", "git_info", data);
                }
            }
        });

        self.tabs.insert(
            ctx.tab_id.to_string(),
            GitTabState {
                last_queried_cwd: None,
                cwd_tx,
                interval_tx,
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
    ///
    /// The CWD is read inside a short async delay (50 ms) rather than
    /// immediately. When the user runs `cd` the shell emits OSC 133;D *before*
    /// OSC 7, so reading the watch value synchronously would capture the old
    /// directory. The delay lets the engine process OSC 7 and call
    /// `on_cwd_changed`, which updates `cwd_tx`, before the git query starts.
    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
            return;
        };

        let mut command_done = false;
        for seq in state.osc_parser.feed(data) {
            // OSC 133;D = command done. Shell integration emits "D;<exit>"
            // (e.g. "D;0" on success). Accept bare "D" as well for
            // compatibility with any producer that omits the exit code.
            if seq.code == 133 && (seq.arg == "D" || seq.arg.starts_with("D;")) {
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
        if state.cwd_tx.borrow().is_none() {
            return;
        }

        state.last_query_at = Some(now);

        // Subscribe before the spawn so the receiver sees updates made during
        // the 50 ms sleep (i.e. OSC 7 processed by DirTrackerMod in this same
        // output chunk updating the watch via on_cwd_changed).
        let mut cwd_rx = state.cwd_tx.subscribe();
        let emitter = ctx.async_emitter();
        let interval_tx = state.interval_tx.clone();
        tokio::spawn(async move {
            // Yield briefly so the engine can process any OSC 7 that arrived
            // in the same PTY chunk as the OSC 133;D. After this sleep the
            // watch receiver holds the correct current directory.
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            // Wait for a Some value — cwd_rx starts as None only on fresh tabs
            // where the early-exit above already guards us, so this completes
            // immediately in practice.
            let cwd = cwd_rx.borrow_and_update().clone();
            if let Some(cwd) = cwd {
                let data = query_git_info(&cwd).await;
                let desired = desired_interval_secs(&data);
                if *interval_tx.borrow() != desired {
                    let _ = interval_tx.send(desired);
                }
                emitter.emit("git_monitor", "git_info", data);
            }
        });
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

        // Update the watch sender so the periodic timer picks up the new CWD.
        let _ = state.cwd_tx.send(Some(cwd.to_string()));

        // Fire an immediate git query for the new directory.
        state.last_query_at = Some(Instant::now());
        spawn_git_query(cwd.to_string(), ctx.async_emitter(), state.interval_tx.clone());
    }

    fn on_close(&mut self, ctx: &ModContext) {
        if let Some(state) = self.tabs.remove(ctx.tab_id) {
            if let Some(handle) = state.timer {
                handle.abort();
            }
        }
    }
}

/// Decide the next refresh interval based on the just-emitted git payload.
/// Pending PR checks earn the faster cadence; everything else uses the
/// baseline.
fn desired_interval_secs(payload: &serde_json::Value) -> u64 {
    let pending = payload
        .get("pr")
        .and_then(|pr| pr.get("checks"))
        .and_then(|c| c.get("pending"))
        .and_then(|p| p.as_u64())
        .unwrap_or(0);
    if pending > 0 {
        REFRESH_PENDING_CHECKS_SECS
    } else {
        REFRESH_BASELINE_SECS
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
        // statusCheckRollup adds ~100-200ms over the bare 4-field query but
        // stays well within the 5s timeout. The extra fields keep the PR
        // pill's checks dot + tooltip breakdown coming through the same call.
        tokio::time::Duration::from_secs(5),
        tokio::process::Command::new("gh")
            .args([
                "pr",
                "view",
                "--json",
                "number,title,state,url,isDraft,mergedAt,statusCheckRollup",
            ])
            .current_dir(root)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if output.status.success() {
        let raw: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        transform_pr(raw)
    } else {
        None
    }
}

/// Reduce the verbose `gh pr view` payload to the compact shape the frontend
/// consumes. Collapses `statusCheckRollup` (variable-length array) into a
/// 4-bucket counter, normalises state to `OPEN | MERGED | CLOSED`, and drops
/// every field the UI doesn't use so the IPC payload stays small.
///
/// `mergedAt` disambiguates older `gh` versions that return `state: "CLOSED"`
/// for merged PRs — when `mergedAt` is populated we treat the PR as merged.
///
/// Returns `None` when `number`, `title`, or `url` are missing or the wrong
/// JSON shape — the frontend's `PrInfo` type asserts those are non-null and
/// we'd rather drop the pill than emit a misshapen payload that the UI then
/// has to defensively guard against.
fn transform_pr(raw: serde_json::Value) -> Option<serde_json::Value> {
    let number = raw.get("number").and_then(|v| v.as_u64())?;
    let title = raw.get("title").and_then(|v| v.as_str())?;
    let url = raw.get("url").and_then(|v| v.as_str())?;

    let state = raw.get("state").and_then(|v| v.as_str()).unwrap_or("OPEN");
    let merged_at = raw.get("mergedAt").and_then(|v| v.as_str());
    let normalised_state = match (state, merged_at) {
        ("MERGED", _) => "MERGED",
        ("CLOSED", Some(_)) => "MERGED",
        ("CLOSED", _) => "CLOSED",
        _ => "OPEN",
    };

    let checks = raw
        .get("statusCheckRollup")
        .and_then(|v| v.as_array())
        .map(|arr| summarise_checks(arr));

    Some(serde_json::json!({
        "number": number,
        "title": title,
        "state": normalised_state,
        "isDraft": raw.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false),
        "url": url,
        "checks": checks,
    }))
}

#[derive(Default)]
struct CheckCounts {
    passing: u32,
    failing: u32,
    pending: u32,
    skipped: u32,
}

/// Collapse a `statusCheckRollup` array into a 4-bucket counter. Handles both
/// GitHub Actions check runs (state lives on `conclusion`/`status`) and
/// external status contexts (state lives on `state`).
///
/// Failing-side coverage is exhaustive on purpose: `STARTUP_FAILURE` and
/// `STALE` are real CheckRun conclusions that mean "the check broke" — if we
/// dropped them, a broken CI would render a green dot. `EXPECTED` is a
/// StatusContext sentinel for "a future check will be reported" and counts as
/// pending.
fn summarise_checks(items: &[serde_json::Value]) -> serde_json::Value {
    let mut c = CheckCounts::default();
    for item in items {
        let s = item
            .get("conclusion")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("status").and_then(|v| v.as_str()))
            .or_else(|| item.get("state").and_then(|v| v.as_str()))
            .unwrap_or("");
        match s {
            "SUCCESS" => c.passing += 1,
            "FAILURE"
            | "ERROR"
            | "CANCELLED"
            | "TIMED_OUT"
            | "ACTION_REQUIRED"
            | "STARTUP_FAILURE"
            | "STALE" => c.failing += 1,
            "PENDING" | "IN_PROGRESS" | "QUEUED" | "WAITING" | "EXPECTED" => {
                c.pending += 1
            }
            "SKIPPED" | "NEUTRAL" => c.skipped += 1,
            _ => {}
        }
    }
    let total = c.passing + c.failing + c.pending + c.skipped;
    serde_json::json!({
        "passing": c.passing,
        "failing": c.failing,
        "pending": c.pending,
        "skipped": c.skipped,
        "total": total,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transforms_open_pr_with_mixed_checks() {
        let raw = serde_json::json!({
            "number": 42,
            "title": "Fix login",
            "state": "OPEN",
            "url": "https://github.com/o/r/pull/42",
            "isDraft": false,
            "mergedAt": null,
            "statusCheckRollup": [
                {"conclusion": "SUCCESS"},
                {"conclusion": "FAILURE"},
                {"conclusion": "SKIPPED"},
                {"status": "IN_PROGRESS"},
            ],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["state"], "OPEN");
        assert_eq!(out["isDraft"], false);
        assert_eq!(out["number"], 42);
        assert_eq!(out["title"], "Fix login");
        assert_eq!(out["url"], "https://github.com/o/r/pull/42");
        assert_eq!(out["checks"]["passing"], 1);
        assert_eq!(out["checks"]["failing"], 1);
        assert_eq!(out["checks"]["pending"], 1);
        assert_eq!(out["checks"]["skipped"], 1);
        assert_eq!(out["checks"]["total"], 4);
    }

    #[test]
    fn collapses_closed_with_merged_at_to_merged() {
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "CLOSED",
            "url": "u", "isDraft": false, "mergedAt": "2026-01-01T00:00:00Z",
            "statusCheckRollup": [],
        });
        assert_eq!(transform_pr(raw).unwrap()["state"], "MERGED");
    }

    #[test]
    fn closed_without_merged_at_stays_closed() {
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "CLOSED",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [],
        });
        assert_eq!(transform_pr(raw).unwrap()["state"], "CLOSED");
    }

    #[test]
    fn merged_state_passes_through() {
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "MERGED",
            "url": "u", "isDraft": false, "mergedAt": "2026-01-01T00:00:00Z",
            "statusCheckRollup": [],
        });
        assert_eq!(transform_pr(raw).unwrap()["state"], "MERGED");
    }

    #[test]
    fn empty_rollup_returns_zero_counts() {
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["checks"]["total"], 0);
        assert_eq!(out["checks"]["passing"], 0);
    }

    #[test]
    fn external_status_state_field_classified() {
        // External status contexts (e.g. Vercel deployment) report via the
        // `state` field, not `conclusion`.
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [
                {"state": "SUCCESS"},
                {"state": "PENDING"},
                {"state": "FAILURE"},
            ],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["checks"]["passing"], 1);
        assert_eq!(out["checks"]["pending"], 1);
        assert_eq!(out["checks"]["failing"], 1);
        assert_eq!(out["checks"]["total"], 3);
    }

    #[test]
    fn draft_flag_preserved() {
        let raw = serde_json::json!({
            "number": 7, "title": "wip", "state": "OPEN",
            "url": "u", "isDraft": true, "mergedAt": null,
            "statusCheckRollup": [],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["state"], "OPEN");
        assert_eq!(out["isDraft"], true);
    }

    #[test]
    fn missing_isdraft_defaults_to_false() {
        let raw = serde_json::json!({
            "number": 7, "title": "t", "state": "OPEN",
            "url": "u", "mergedAt": null,
            "statusCheckRollup": [],
        });
        assert_eq!(transform_pr(raw).unwrap()["isDraft"], false);
    }

    #[test]
    fn missing_required_fields_returns_none() {
        // Defence against future `gh` payload shape changes — frontend
        // PrInfo asserts these are non-null, so drop the pill rather than
        // emit a malformed payload.
        let no_number = serde_json::json!({
            "title": "t", "url": "u", "state": "OPEN", "isDraft": false,
        });
        let no_title = serde_json::json!({
            "number": 1, "url": "u", "state": "OPEN", "isDraft": false,
        });
        let no_url = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN", "isDraft": false,
        });
        let null_title = serde_json::json!({
            "number": 1, "title": null, "url": "u", "state": "OPEN", "isDraft": false,
        });
        assert!(transform_pr(no_number).is_none());
        assert!(transform_pr(no_title).is_none());
        assert!(transform_pr(no_url).is_none());
        assert!(transform_pr(null_title).is_none());
    }

    #[test]
    fn startup_failure_and_stale_count_as_failing() {
        // Defence against the silent-green-dot bug — if these fell through
        // the match they'd disappear from the counter and a broken CI would
        // show green.
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [
                {"conclusion": "STARTUP_FAILURE"},
                {"conclusion": "STALE"},
            ],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["checks"]["failing"], 2);
        assert_eq!(out["checks"]["passing"], 0);
        assert_eq!(out["checks"]["total"], 2);
    }

    #[test]
    fn expected_status_counts_as_pending() {
        // `EXPECTED` is the StatusContext sentinel for "a future check will
        // be reported"; it should keep the dot yellow, not green.
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [
                {"state": "SUCCESS"},
                {"state": "EXPECTED"},
            ],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["checks"]["passing"], 1);
        assert_eq!(out["checks"]["pending"], 1);
    }

    #[test]
    fn unknown_check_state_dropped_from_buckets() {
        // A future `gh` adding a new conclusion enum should not crash or
        // miscategorise — unrecognised values are simply skipped.
        let raw = serde_json::json!({
            "number": 1, "title": "t", "state": "OPEN",
            "url": "u", "isDraft": false, "mergedAt": null,
            "statusCheckRollup": [
                {"conclusion": "SUCCESS"},
                {"conclusion": "BRAND_NEW_STATE_FROM_FUTURE_GH"},
            ],
        });
        let out = transform_pr(raw).expect("required fields present");
        assert_eq!(out["checks"]["passing"], 1);
        assert_eq!(out["checks"]["total"], 1);
    }

    #[test]
    fn desired_interval_uses_baseline_when_no_pr() {
        let payload = serde_json::json!({"branch": "main"});
        assert_eq!(desired_interval_secs(&payload), REFRESH_BASELINE_SECS);
    }

    #[test]
    fn desired_interval_uses_baseline_when_no_checks() {
        let payload = serde_json::json!({
            "pr": {
                "number": 1, "title": "t", "state": "OPEN", "isDraft": false, "url": "u",
                "checks": {
                    "passing": 5, "failing": 0, "pending": 0, "skipped": 0, "total": 5,
                },
            },
        });
        assert_eq!(desired_interval_secs(&payload), REFRESH_BASELINE_SECS);
    }

    #[test]
    fn desired_interval_switches_to_pending_cadence() {
        let payload = serde_json::json!({"pr": {"checks": {"pending": 2}}});
        assert_eq!(desired_interval_secs(&payload), REFRESH_PENDING_CHECKS_SECS);
    }

    #[test]
    fn desired_interval_handles_null_pr() {
        let payload = serde_json::json!({"pr": null});
        assert_eq!(desired_interval_secs(&payload), REFRESH_BASELINE_SECS);
    }
}
