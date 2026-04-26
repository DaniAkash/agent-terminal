//! Minimal HTTP server that receives hook payloads from AI coding agents.
//!
//! Agent hooks (Claude Code, Codex) are configured to POST structured JSON to
//! `http://127.0.0.1:47384/hook` via a small shell helper script. This module
//! receives those POSTs and forwards them to the MOD engine via an unbounded
//! channel, where `AgentTurnMod` consumes them.
//!
//! The port is fixed so hook configs written to disk (e.g. `~/.claude/settings.json`)
//! don't need to be rewritten on every launch. `47384` is not assigned to any
//! common service in the IANA registry.

use axum::{Router, extract::State, http::StatusCode, routing::post, Json};
use serde::Deserialize;
use tokio::sync::mpsc;

/// Payload delivered by agent hook scripts to `POST /hook`.
///
/// The `agent` and `event` fields are injected by the hook script. All other
/// fields are passed through as-is from the agent's own stdin JSON.
#[derive(Deserialize, Clone, Debug)]
pub struct HookPayload {
    /// Which agent sent the event: `"claude-code"` or `"codex"`.
    pub agent: String,
    /// Lifecycle event name: `"SessionStart"`, `"UserPromptSubmit"`,
    /// `"PreToolUse"`, `"Notification"`, `"Stop"`, `"SessionEnd"`.
    pub event: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub tool_name: Option<String>,
    pub message: Option<String>,
    pub transcript_path: Option<String>,
    pub last_assistant_message: Option<String>,
}

/// Starts the hook HTTP server in a background task.
///
/// Binds to `127.0.0.1:47384`. If the port is unavailable (another
/// agent-terminal instance is already running, or a conflicting service),
/// logs a warning and returns — the rest of the app is unaffected. Hook-based
/// agent state tracking will degrade gracefully to the `ps`-based heuristics.
pub fn start_hook_server(hook_tx: mpsc::UnboundedSender<HookPayload>) {
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/hook", post(receive_hook))
            .with_state(hook_tx);

        match tokio::net::TcpListener::bind("127.0.0.1:47384").await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("[hook_server] server error: {e}");
                }
            }
            Err(e) => {
                eprintln!(
                    "[hook_server] failed to bind 127.0.0.1:47384 — \
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
