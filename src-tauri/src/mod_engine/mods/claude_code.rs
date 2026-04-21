use std::collections::HashMap;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

use crate::mod_engine::{AsyncEmitter, CwdRegistry, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;

struct ClaudeTabState {
    parser: OscParser,
    last_cwd: Option<String>,
    /// Shared with async scan tasks — set true when a live session is found, false when cleared.
    session_active: Arc<AtomicBool>,
    awaiting_agent: bool,
    /// Rolling input buffer — cleared on Enter, used to detect "claude" typed across keystrokes.
    input_buf: Vec<u8>,
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
}

impl ClaudeCodeMod {
    pub fn new(cwd_registry: CwdRegistry) -> Self {
        Self {
            cwd_registry,
            tabs: HashMap::new(),
        }
    }

    fn trigger_scan(&self, cwd: String, awaiting: bool, session_active: Arc<AtomicBool>, emitter: AsyncEmitter) {
        tokio::spawn(async move {
            match scan_claude_session(&cwd, awaiting).await {
                Some(data) => {
                    session_active.store(true, Ordering::Relaxed);
                    emitter.emit("claude_code", "claude_session", data);
                    emitter.emit(
                        "claude_code",
                        "tab_type_changed",
                        serde_json::json!({ "type": "agent", "agent": "claude-code" }),
                    );
                }
                None => {
                    session_active.store(false, Ordering::Relaxed);
                    emitter.emit("claude_code", "claude_session_cleared", serde_json::json!({}));
                    emitter.emit(
                        "claude_code",
                        "tab_type_changed",
                        serde_json::json!({ "type": "shell" }),
                    );
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
                session_active: Arc::new(AtomicBool::new(false)),
                awaiting_agent: false,
                input_buf: Vec::new(),
            },
        );
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let (scan_trigger, staleness_scan_cwd, session_active): (Option<(String, bool)>, Option<String>, Arc<AtomicBool>) = {
            let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
                return;
            };
            let seqs = state.parser.feed(data);

            let current_cwd = {
                let reg = self.cwd_registry.read().unwrap();
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

            // OSC 133;A → staleness check (only if we previously found an active session)
            let has_osc_a = seqs.iter().any(|s| s.code == 133 && s.arg.starts_with('A'));
            let staleness_scan_cwd = if has_osc_a && state.session_active.load(Ordering::Relaxed) {
                current_cwd
            } else {
                None
            };

            (scan_trigger, staleness_scan_cwd, Arc::clone(&state.session_active))
        };

        if let Some((cwd, awaiting)) = scan_trigger {
            self.trigger_scan(cwd, awaiting, Arc::clone(&session_active), ctx.async_emitter());
        }
        if let Some(cwd) = staleness_scan_cwd {
            self.trigger_scan(cwd, false, Arc::clone(&session_active), ctx.async_emitter());
        }
    }

    fn on_input(&mut self, data: &[u8], ctx: &ModContext) {
        // Phase 1: update buffer state, extract what we need (mutable borrow ends here)
        let scan_info: Option<(String, Arc<AtomicBool>)> = {
            let Some(state) = self.tabs.get_mut(ctx.tab_id) else {
                return;
            };

            let mut trigger = false;
            for &b in data {
                if b == b'\r' || b == b'\n' {
                    let line = String::from_utf8_lossy(&state.input_buf).to_lowercase();
                    if line.contains("claude") {
                        state.awaiting_agent = true;
                        trigger = true;
                    }
                    state.input_buf.clear();
                } else if b == 0x7f || b == 0x08 {
                    state.input_buf.pop();
                } else if b >= 0x20 {
                    state.input_buf.push(b);
                    if state.input_buf.len() > 256 {
                        state.input_buf.drain(..128);
                    }
                }
            }

            if trigger {
                state.last_cwd.clone().map(|cwd| (cwd, Arc::clone(&state.session_active)))
            } else {
                None
            }
        };

        // Phase 2: trigger scan outside the mutable borrow
        if let Some((cwd, session_active)) = scan_info {
            self.trigger_scan(cwd, true, session_active, ctx.async_emitter());
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

    // Encode cwd: replace all '/' with '-' (Claude keeps the leading '-')
    let encoded = cwd.replace('/', "-");

    let dir = home.join(".claude").join("projects").join(&encoded);
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
