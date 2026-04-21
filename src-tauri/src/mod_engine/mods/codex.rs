use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::mod_engine::{CwdRegistry, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;

struct CodexTabState {
    parser: OscParser,
    last_cwd: Option<String>,
    active_session_id: Option<String>,
    awaiting_agent: bool,
}

/// Monitors `~/.codex/state_5.sqlite` for active Codex sessions in the tab's cwd.
///
/// Falls back to scanning `~/.codex/sessions/*.jsonl` when SQLite is unavailable.
pub struct CodexMod {
    cwd_registry: CwdRegistry,
    tabs: HashMap<String, CodexTabState>,
    pending: Arc<Mutex<VecDeque<PendingEvent>>>,
}

enum PendingEvent {
    Session { tab_id: String, data: serde_json::Value },
    Clear { tab_id: String },
}

impl CodexMod {
    pub fn new(cwd_registry: CwdRegistry) -> Self {
        Self {
            cwd_registry,
            tabs: HashMap::new(),
            pending: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn trigger_scan(&self, tab_id: &str, cwd: String, awaiting: bool) {
        let tab_id = tab_id.to_string();
        let pending = Arc::clone(&self.pending);
        tokio::spawn(async move {
            match scan_codex_session(&cwd, awaiting).await {
                Some(data) => {
                    pending.lock().unwrap().push_back(PendingEvent::Session { tab_id, data });
                }
                None => {
                    pending.lock().unwrap().push_back(PendingEvent::Clear { tab_id });
                }
            }
        });
    }
}

impl Mod for CodexMod {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.tabs.insert(
            ctx.tab_id.to_string(),
            CodexTabState {
                parser: OscParser::new(),
                last_cwd: None,
                active_session_id: None,
                awaiting_agent: false,
            },
        );
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        // 1. Drain all pending events into a local vec
        let events: Vec<PendingEvent> = {
            let mut queue = self.pending.lock().unwrap();
            queue.drain(..).collect()
        };

        // 2. Process events for this tab, requeue others
        let mut requeue = VecDeque::new();
        for event in events {
            match event {
                PendingEvent::Session { ref tab_id, .. } | PendingEvent::Clear { ref tab_id } => {
                    if tab_id != ctx.tab_id {
                        requeue.push_back(event);
                    } else {
                        match event {
                            PendingEvent::Session { tab_id: _, data: session_data } => {
                                if let Some(sid) = session_data.get("sessionId").and_then(|v| v.as_str()) {
                                    if let Some(state) = self.tabs.get_mut(ctx.tab_id) {
                                        state.active_session_id = Some(sid.to_string());
                                        state.awaiting_agent = false;
                                    }
                                }
                                ctx.emit(self.id(), "codex_session", session_data);
                                ctx.emit(
                                    self.id(),
                                    "tab_type_changed",
                                    serde_json::json!({ "type": "agent", "agent": "codex" }),
                                );
                            }
                            PendingEvent::Clear { tab_id: _ } => {
                                let should_clear = self
                                    .tabs
                                    .get(ctx.tab_id)
                                    .map(|s| s.active_session_id.is_some())
                                    .unwrap_or(false);
                                if should_clear {
                                    if let Some(state) = self.tabs.get_mut(ctx.tab_id) {
                                        state.active_session_id = None;
                                        state.awaiting_agent = false;
                                    }
                                    ctx.emit(self.id(), "codex_session_cleared", serde_json::json!({}));
                                    ctx.emit(
                                        self.id(),
                                        "tab_type_changed",
                                        serde_json::json!({ "type": "shell" }),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        if !requeue.is_empty() {
            self.pending.lock().unwrap().extend(requeue);
        }

        // 3. Parse OSC and read state — release mutable borrow before calling trigger_scan
        let (scan_trigger, staleness_scan_cwd): (Option<(String, bool)>, Option<String>) = {
            let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
                return;
            };
            let seqs = state.parser.feed(data);

            let current_cwd = {
                let reg = self.cwd_registry.read().unwrap();
                reg.get(ctx.tab_id).cloned()
            };

            let scan_trigger = if let Some(ref cwd) = current_cwd {
                if state.last_cwd.as_deref() != Some(cwd.as_str()) {
                    let awaiting = state.awaiting_agent;
                    state.last_cwd = Some(cwd.clone());
                    Some((cwd.clone(), awaiting))
                } else {
                    None
                }
            } else {
                None
            };

            let has_osc_a = seqs.iter().any(|s| s.code == 133 && s.arg.starts_with('A'));
            let staleness_scan_cwd = if has_osc_a && state.active_session_id.is_some() {
                current_cwd
            } else {
                None
            };

            (scan_trigger, staleness_scan_cwd)
        };

        if let Some((cwd, awaiting)) = scan_trigger {
            self.trigger_scan(ctx.tab_id, cwd, awaiting);
        }
        if let Some(cwd) = staleness_scan_cwd {
            self.trigger_scan(ctx.tab_id, cwd, false);
        }
    }

    fn on_input(&mut self, data: &[u8], ctx: &ModContext) {
        if data.windows(5).any(|w| w == b"codex") {
            let cwd_opt = {
                let state = self.tabs.get_mut(ctx.tab_id);
                if let Some(state) = state {
                    state.awaiting_agent = true;
                    state.last_cwd.clone()
                } else {
                    None
                }
            };
            if let Some(cwd) = cwd_opt {
                self.trigger_scan(ctx.tab_id, cwd, true);
            }
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.tabs.remove(ctx.tab_id);
    }
}

async fn scan_codex_session(cwd: &str, awaiting_agent: bool) -> Option<serde_json::Value> {
    let home = dirs::home_dir()?;

    // Try SQLite first
    if let Some(result) = scan_via_sqlite(&home, cwd, awaiting_agent).await {
        return Some(result);
    }

    // Fallback: scan ~/.codex/sessions/*.jsonl
    scan_via_jsonl(&home, cwd, awaiting_agent).await
}

async fn scan_via_sqlite(
    home: &std::path::Path,
    cwd: &str,
    awaiting_agent: bool,
) -> Option<serde_json::Value> {
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

    // Run blocking SQLite query on a thread pool thread
    let result = tokio::task::spawn_blocking(move || {
        query_codex_sqlite(&tmp_clone, &cwd_owned, awaiting_agent)
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

fn query_codex_sqlite(
    db_path: &std::path::Path,
    cwd: &str,
    awaiting_agent: bool,
) -> Option<serde_json::Value> {
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

    let (id, title, git_branch, model, approval_mode, sandbox_policy_json, reasoning_effort, updated_at_ms) =
        row?;

    // Check freshness
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let age_secs = (now_ms - updated_at_ms).max(0) / 1000;
    if age_secs > 120 && !awaiting_agent {
        return None;
    }

    // Parse sandbox_policy JSON to extract the type field
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

async fn scan_via_jsonl(
    home: &std::path::Path,
    cwd: &str,
    awaiting_agent: bool,
) -> Option<serde_json::Value> {
    let sessions_dir = home.join(".codex").join("sessions");
    if !sessions_dir.exists() {
        return None;
    }

    // Find most recently modified .jsonl matching cwd
    let entries = std::fs::read_dir(&sessions_dir).ok()?;
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        // Quick scan: peek at first line for cwd match
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
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

    let (jsonl_path, mtime) = best?;

    let age = std::time::SystemTime::now()
        .duration_since(mtime)
        .unwrap_or_default();
    if age.as_secs() > 120 && !awaiting_agent {
        return None;
    }

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
