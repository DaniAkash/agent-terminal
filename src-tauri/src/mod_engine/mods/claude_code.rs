use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

use crate::mod_engine::{CwdRegistry, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;

struct ClaudeTabState {
    parser: OscParser,
    last_cwd: Option<String>,
    active_session_id: Option<String>,
    awaiting_agent: bool,
}

/// Monitors `~/.claude/projects/` for active Claude Code sessions in the tab's cwd.
///
/// Detection is triggered by:
/// 1. cwd change (compared against `CwdRegistry`)
/// 2. `claude` appearing in user input
/// 3. OSC 133;A (prompt returned) → staleness check to clear session
pub struct ClaudeCodeMod {
    cwd_registry: CwdRegistry,
    tabs: HashMap<String, ClaudeTabState>,
    /// Async results queued by spawned tokio tasks, drained in on_output.
    pending: Arc<Mutex<VecDeque<PendingEvent>>>,
}

enum PendingEvent {
    Session {
        tab_id: String,
        data: serde_json::Value,
    },
    Clear {
        tab_id: String,
    },
}

impl ClaudeCodeMod {
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
            match scan_claude_session(&cwd, awaiting).await {
                Some(data) => {
                    pending.lock().unwrap().push_back(PendingEvent::Session {
                        tab_id,
                        data,
                    });
                }
                None => {
                    // No session found — clear if one was active
                    pending.lock().unwrap().push_back(PendingEvent::Clear { tab_id });
                }
            }
        });
    }
}

impl Mod for ClaudeCodeMod {
    fn id(&self) -> &'static str {
        "claude_code"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.tabs.insert(
            ctx.tab_id.to_string(),
            ClaudeTabState {
                parser: OscParser::new(),
                last_cwd: None,
                active_session_id: None,
                awaiting_agent: false,
            },
        );
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        // 1. Drain pending async results into local vec (releases the Mutex fast)
        let events: Vec<PendingEvent> = {
            let mut queue = self.pending.lock().unwrap();
            queue.drain(..).collect()
        };

        // 2. Separate events for this tab vs others; put others back
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
                                ctx.emit(self.id(), "claude_session", session_data);
                                ctx.emit(
                                    self.id(),
                                    "tab_type_changed",
                                    serde_json::json!({ "type": "agent", "agent": "claude-code" }),
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
                                    ctx.emit(self.id(), "claude_session_cleared", serde_json::json!({}));
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

        // 3. Parse OSC and read state — all in one mutable borrow scope
        let (scan_trigger, staleness_scan_cwd): (Option<(String, bool)>, Option<String>) = {
            let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
                return;
            };
            let seqs = state.parser.feed(data);

            let current_cwd = {
                let reg = self.cwd_registry.blocking_read();
                reg.get(ctx.tab_id).cloned()
            };

            // CWD change → trigger scan
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

            // OSC 133;A → staleness check
            let has_osc_a = seqs.iter().any(|s| s.code == 133 && s.arg.starts_with('A'));
            let staleness_scan_cwd = if has_osc_a && state.active_session_id.is_some() {
                current_cwd
            } else {
                None
            };

            (scan_trigger, staleness_scan_cwd)
        };

        // 4. Now trigger async scans (no mutable borrow on self.tabs)
        if let Some((cwd, awaiting)) = scan_trigger {
            self.trigger_scan(ctx.tab_id, cwd, awaiting);
        }
        if let Some(cwd) = staleness_scan_cwd {
            self.trigger_scan(ctx.tab_id, cwd, false);
        }
    }

    fn on_input(&mut self, data: &[u8], ctx: &ModContext) {
        if data.windows(6).any(|w| w == b"claude") {
            // Extract cwd and set flag before calling trigger_scan
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

/// Scan `~/.claude/projects/<encoded-cwd>/` for an active session JSONL file.
/// Returns `Some(session_data)` if a recent session is found, `None` otherwise.
async fn scan_claude_session(cwd: &str, awaiting_agent: bool) -> Option<serde_json::Value> {
    let home = dirs::home_dir()?;

    // Encode cwd: replace all '/' with '-', strip leading '-'
    let encoded = cwd.replace('/', "-");
    let encoded = encoded.trim_start_matches('-');

    let dir = home.join(".claude").join("projects").join(encoded);
    if !dir.exists() {
        return None;
    }

    // Find the most recently modified .jsonl file
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    let entries = std::fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            if let Ok(mtime) = meta.modified() {
                match &best {
                    None => best = Some((path, mtime)),
                    Some((_, best_t)) if mtime > *best_t => best = Some((path, mtime)),
                    _ => {}
                }
            }
        }
    }

    let (jsonl_path, mtime) = best?;

    // Check freshness: if older than 120s and not awaiting, skip
    let age = std::time::SystemTime::now()
        .duration_since(mtime)
        .unwrap_or_default();
    if age.as_secs() > 120 && !awaiting_agent {
        return None;
    }

    // sessionId = filename stem
    let session_id = jsonl_path.file_stem()?.to_str()?.to_string();

    // Read first 64 KB
    let content = read_first_bytes(&jsonl_path, 65536).await?;
    let text = std::str::from_utf8(&content).ok()?;

    // Parse JSONL for session metadata
    let mut title: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut permission_mode: Option<String> = None;
    let mut model: Option<String> = None;
    let mut pr_number: Option<u64> = None;
    let mut pr_url: Option<String> = None;
    let mut found_user = false;

    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match msg_type {
            "user" if !found_user => {
                found_user = true;
                if let Some(b) = v.get("gitBranch").and_then(|b| b.as_str()) {
                    git_branch = Some(b.to_string());
                }
                if let Some(pm) = v.get("permissionMode").and_then(|p| p.as_str()) {
                    permission_mode = Some(pm.to_string());
                }
                // Extract first content string as title
                if let Some(content) = v.get("message").and_then(|m| m.get("content")) {
                    if let Some(s) = content.as_str() {
                        title = Some(truncate(s, 80));
                    } else if let Some(arr) = content.as_array() {
                        for item in arr {
                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(s) = item.get("text").and_then(|t| t.as_str()) {
                                    title = Some(truncate(s, 80));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            "assistant" if model.is_none() => {
                if let Some(m) = v
                    .get("message")
                    .and_then(|m| m.get("model"))
                    .and_then(|m| m.as_str())
                {
                    model = Some(m.to_string());
                }
            }
            "pr-link" => {
                pr_number = v.get("prNumber").and_then(|n| n.as_u64());
                pr_url = v.get("prUrl").and_then(|u| u.as_str()).map(|s| s.to_string());
            }
            _ => {}
        }
    }

    Some(serde_json::json!({
        "sessionId": session_id,
        "gitBranch": git_branch,
        "model": model,
        "permissionMode": permission_mode,
        "title": title,
        "prNumber": pr_number,
        "prUrl": pr_url,
    }))
}

async fn read_first_bytes(path: &std::path::Path, limit: usize) -> Option<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut buf = vec![0u8; limit];
    let n = file.read(&mut buf).await.ok()?;
    buf.truncate(n);
    Some(buf)
}

fn truncate(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let mut result: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        result.push('…');
    }
    result
}
