use std::collections::HashMap;

use crate::mod_engine::{Mod, ModContext};

struct ClaudeTabState {
    /// True once the session file has been read for the current process instance.
    /// Reset to false on `on_agent_cleared` so the next invocation scans again.
    session_scanned: bool,
}

/// Reads Claude Code session metadata from `~/.claude/projects/` when
/// `ProcessInspectorMod` confirms a `claude` process is running in the tab's CWD.
///
/// Emits:
/// - `claude_session`         — session metadata on detection
/// - `claude_session_cleared` — session gone (agent process ended)
/// - `tab_type_changed`       — `{ type: "agent", agent: "claude-code" }` / `{ type: "shell" }`
pub struct ClaudeCodeMod {
    tabs: HashMap<String, ClaudeTabState>,
}

impl ClaudeCodeMod {
    pub fn new() -> Self {
        Self { tabs: HashMap::new() }
    }
}

impl Mod for ClaudeCodeMod {
    fn id(&self) -> &'static str {
        "claude_code"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.tabs.insert(ctx.tab_id.to_string(), ClaudeTabState { session_scanned: false });
    }

    fn on_agent_detected(&mut self, agent: &str, cwd: &str, ctx: &ModContext) {
        if agent != "claude" {
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
            match scan_claude_session(&cwd).await {
                Some(data) => {
                    emitter.emit("claude_code", "claude_session", data);
                    emitter.emit(
                        "claude_code",
                        "tab_type_changed",
                        serde_json::json!({ "type": "agent", "agent": "claude-code" }),
                    );
                }
                None => {
                    // Session file not found yet (may not be written yet); will retry on next detection.
                    // Reset so next on_agent_detected can try again.
                    // Note: state is not accessible here; the reset happens in on_agent_cleared.
                }
            }
        });
    }

    fn on_agent_cleared(&mut self, agent: &str, ctx: &ModContext) {
        if agent != "claude" {
            return;
        }
        if let Some(state) = self.tabs.get_mut(ctx.tab_id) {
            state.session_scanned = false;
        }
        ctx.emit("claude_code", "claude_session_cleared", serde_json::json!({}));
        ctx.emit(
            "claude_code",
            "tab_type_changed",
            serde_json::json!({ "type": "shell" }),
        );
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.tabs.remove(ctx.tab_id);
    }
}

/// Scan `~/.claude/projects/<encoded-cwd>/` for an active session JSONL file.
/// Returns `Some(session_data)` if a session file is found, `None` otherwise.
/// No freshness check — only called when the claude process is confirmed live.
async fn scan_claude_session(cwd: &str) -> Option<serde_json::Value> {
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

    let (jsonl_path, _mtime) = best?;

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
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
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

