//! Minimal HTTP server that receives hook payloads from AI coding agents.
//!
//! Agent hooks (Claude Code, Codex) are configured to POST structured JSON to
//! `http://127.0.0.1:<HOOK_PORT>/hook` via a small shell helper script. This
//! module receives those POSTs and forwards them to the MOD engine via an
//! unbounded channel, where `AgentTurnMod` consumes them.
//!
//! `HOOK_PORT` is fixed per build variant (47384 for prod, 47385 for dev — see
//! `identity::HOOK_PORT`) so hook configs written to disk
//! (e.g. `~/.claude/settings.json`) don't need to be rewritten on every launch,
//! and a dev build can coexist with a prod install on the same machine without
//! fighting for the port. Neither port is assigned to any common service in
//! the IANA registry.

use axum::{Router, extract::State, http::StatusCode, routing::post, Json};
use serde::Deserialize;
use tokio::sync::mpsc;

/// Payload delivered by agent hook scripts to `POST /hook`.
///
/// The `agent`, `event`, and `tab_id` fields are injected by the hook script.
/// All other fields are passed through as-is from the agent's own stdin JSON.
#[derive(Deserialize, Clone, Debug)]
pub struct HookPayload {
    /// Which agent sent the event: `"claude-code"` or `"codex"`.
    pub agent: String,
    /// Lifecycle event name. Claude Code: `"SessionStart"`, `"UserPromptSubmit"`,
    /// `"PreToolUse"`, `"Notification"`, `"Stop"`, `"SessionEnd"`.
    /// Codex: same first three, plus `"PermissionRequest"`, `"PostToolUse"`, `"Stop"`.
    pub event: String,
    /// Tab id of the agent-terminal tab the shell is running inside.
    /// Carried via the `AGENT_TERMINAL_TAB_ID` env var, which `pty_manager`
    /// injects into every shell it spawns. `None` when the agent is running
    /// outside agent-terminal (iTerm, Terminal.app, etc.) — in that case
    /// `AgentTurnMod` drops the event at its top-of-handler gate. See
    /// `hook_config::build_hook_script` for the script-side half.
    pub tab_id: Option<String>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub tool_name: Option<String>,
    pub message: Option<String>,
    pub transcript_path: Option<String>,
    pub last_assistant_message: Option<String>,
    /// Sent by Codex `PermissionRequest` events — the human-readable
    /// description of what the agent wants to do (typically a shell command).
    /// Used as the awaiting-badge tooltip.
    pub prompt: Option<String>,
}

/// Starts the hook HTTP server in a background task.
///
/// Binds to `127.0.0.1:<HOOK_PORT>` (47384 for prod builds, 47385 for dev
/// builds — see `identity.rs`). If the port is unavailable (another instance
/// of the same build variant is already running, or a conflicting service),
/// logs a warning and returns — the rest of the app is unaffected. Hook-based
/// agent state tracking will degrade gracefully to the `ps`-based heuristics.
pub fn start_hook_server(hook_tx: mpsc::UnboundedSender<HookPayload>) {
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/hook", post(receive_hook))
            .with_state(hook_tx);

        let addr = format!("127.0.0.1:{}", crate::identity::HOOK_PORT);
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("[hook_server] server error: {e}");
                }
            }
            Err(e) => {
                eprintln!(
                    "[hook_server] failed to bind {addr} — \
                     hook-based agent state will not be available: {e}"
                );
            }
        }
    });
}

async fn receive_hook(
    State(tx): State<mpsc::UnboundedSender<HookPayload>>,
    Json(payload): Json<HookPayload>,
) -> StatusCode {
    let _ = tx.send(payload);
    StatusCode::OK
}
