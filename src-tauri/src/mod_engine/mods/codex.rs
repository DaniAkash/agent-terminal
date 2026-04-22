use std::collections::HashMap;

use crate::mod_engine::{Mod, ModContext};

struct CodexTabState {
    /// True once the session file has been read for the current process instance.
    /// Reset to false on `on_agent_cleared` so the next invocation scans again.
    session_scanned: bool,
}

/// Reads Codex session metadata from `~/.codex/state_5.sqlite` (or JSONL fallback)
/// when `ProcessInspectorMod` confirms a `codex` process is running in the tab's CWD.
///
/// Emits:
/// - `codex_session`         — session metadata on detection
/// - `codex_session_cleared` — session gone (agent process ended)
/// - `tab_type_changed`      — `{ type: "agent", agent: "codex" }` / `{ type: "shell" }`
pub struct CodexMod {
    tabs: HashMap<String, CodexTabState>,
}

impl CodexMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }
}

impl Mod for CodexMod {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.tabs.insert(ctx.tab_id.to_string(), CodexTabState { session_scanned: false });
    }

    fn on_agent_detected(&mut self, agent: &str, cwd: &str, ctx: &ModContext) {
        if agent != "codex" {
            return;
        }
        let Some(state) = self.tabs.get_mut(ctx.tab_id) else { return };
        if state.session_scanned {
            return;
        }
        state.session_scanned = true;

        let emitter = ctx.async_emitter();
        let cwd = cwd.to_string();
        tokio::spawn(async move {
            match scan_codex_session(&cwd).await {
                Some(data) => {
                    emitter.emit("codex", "codex_session", data);
                    emitter.emit(
                        "codex",
                        "tab_type_changed",
                        serde_json::json!({ "type": "agent", "agent": "codex" }),
                    );
                }
                None => {
                    // Session not found yet; on_agent_cleared will reset session_scanned.
                }
            }
        });
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agent != "codex" {
            return;
        }
        if let Some(state) = self.tabs.get_mut(ctx.tab_id) {
            state.session_scanned = false;
        }
        ctx.emit("codex", "codex_session_cleared", serde_json::json!({}));
        ctx.emit(
            "codex",
            "tab_type_changed",
            serde_json::json!({ "type": "shell" }),
        );
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.tabs.remove(ctx.tab_id);
    }
}

async fn scan_codex_session(cwd: &str) -> Option<serde_json::Value> {
    let home = dirs::home_dir()?;

    // Try SQLite first
    if let Some(result) = scan_via_sqlite(&home, cwd).await {
        return Some(result);
    }

    // Fallback: scan ~/.codex/sessions/*.jsonl
    scan_via_jsonl(&home, cwd).await
}

async fn scan_via_sqlite(home: &std::path::Path, cwd: &str) -> Option<serde_json::Value> {
    let db_path = home.join(".codex").join("state_5.sqlite");
    if !db_path.exists() {
        return None;
    }

    // Copy DB to temp file to avoid WAL contention
    let tmp = std::env::temp_dir().join(format!(
        "codex_snap_{}.sqlite",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos()
    ));

    std::fs::copy(&db_path, &tmp).ok()?;

    let cwd_owned = cwd.to_string();
    let tmp_clone = tmp.clone();

    let result = tokio::task::spawn_blocking(move || {
        query_codex_sqlite(&tmp_clone, &cwd_owned)
    })
    .await
    .ok()??;

    std::fs::remove_file(&tmp).ok();
    Some(result)
}

type ThreadRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
);

fn query_codex_sqlite(db_path: &std::path::Path, cwd: &str) -> Option<serde_json::Value> {
    let conn = rusqlite::Connection::open(db_path).ok()?;

    let row: Option<ThreadRow> = conn
        .query_row(
            "SELECT id, title, git_branch, model, approval_mode, sandbox_policy, reasoning_effort, updated_at_ms
             FROM threads WHERE archived = 0 AND cwd = ?1 ORDER BY updated_at_ms DESC LIMIT 1",
            rusqlite::params![cwd],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .ok();

    let (id, title, git_branch, model, approval_mode, sandbox_policy_json, reasoning_effort, _updated_at_ms) =
        row?;

    let sandbox_mode = sandbox_policy_json.as_deref().and_then(|json| {
        serde_json::from_str::<serde_json::Value>(json)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|s| s.to_string()))
    });

    Some(serde_json::json!({
        "sessionId": id,
        "title": title,
        "gitBranch": git_branch,
        "model": model,
        "approvalPolicy": approval_mode,
        "sandboxMode": sandbox_mode,
        "effort": reasoning_effort,
    }))
}

async fn scan_via_jsonl(home: &std::path::Path, cwd: &str) -> Option<serde_json::Value> {
    let sessions_dir = home.join(".codex").join("sessions");
    if !sessions_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(&sessions_dir).ok()?;
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let first_line = content.lines().next().unwrap_or("");
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(first_line) {
            if v.get("cwd").and_then(|c| c.as_str()) != Some(cwd) {
                continue;
            }
        }

        if let Ok(meta) = path.metadata() {
            if let Ok(mtime) = meta.modified() {
                match &best {
                    None => best = Some((path, mtime)),
                    Some((_, bt)) if mtime > *bt => best = Some((path, mtime)),
                    _ => {}
                }
            }
        }
    }

    let (jsonl_path, _mtime) = best?;
    let session_id = jsonl_path.file_stem()?.to_str()?.to_string();

    Some(serde_json::json!({
        "sessionId": session_id,
        "title": null,
        "gitBranch": null,
        "model": null,
        "approvalPolicy": null,
        "sandboxMode": null,
        "effort": null,
    }))
}
