//! `AgentTurnMod` — tracks the turn state of AI coding agent sessions via
//! structured hook events delivered by each agent's own hook system.
//!
//! State machine per session:
//!
//! ```text
//! SessionStart   → Idle
//! UserPromptSubmit / PreToolUse (non-question) → InProgress
//! PreToolUse (tool_name == "AskUserQuestion")  → saves question, state unchanged
//! Notification   → Awaiting { message }
//! Stop           → Completed (async: reads transcript for last message)
//! SessionEnd     → session removed, emit Idle to clear badge
//! ```
//!
//! The mod emits `agent_state_changed` events to the frontend, which writes
//! into `$tabMeta.agentState`. `deriveAgentState()` in `agent.helpers.ts`
//! reads this field and renders the correct badge/animation.

use std::collections::HashMap;

use crate::hook_server::HookPayload;
use crate::mod_engine::{AsyncEmitter, Mod, ModContext};

// ─── State types ─────────────────────────────────────────────────────────────

struct SessionState {
    tab_id: String,
    /// Saved from PreToolUse(AskUserQuestion) — used as the Awaiting message.
    pending_question: Option<String>,
}

// ─── Mod ─────────────────────────────────────────────────────────────────────

/// Tracks per-session agent turn state via hook events.
pub struct AgentTurnMod {
    /// tab_id → AsyncEmitter (populated on_open, removed on_close).
    emitters: HashMap<String, AsyncEmitter>,
    /// tab_id → current cwd (updated via on_cwd_changed).
    tab_cwds: HashMap<String, String>,
    /// session_id → SessionState (populated on SessionStart).
    sessions: HashMap<String, SessionState>,
}

impl AgentTurnMod {
    pub fn new() -> Self {
        Self {
            emitters: HashMap::new(),
            tab_cwds: HashMap::new(),
            sessions: HashMap::new(),
        }
    }

    // ── Resolution helpers ────────────────────────────────────────────────────

    /// Resolves a tab_id from a hook payload.
    /// Tries session_id lookup first, then CWD prefix match as fallback.
    fn tab_id_for(&self, payload: &HookPayload) -> Option<String> {
        // 1. Direct session_id lookup (fastest — mapping established at SessionStart).
        if let Some(sid) = &payload.session_id {
            if let Some(state) = self.sessions.get(sid.as_str()) {
                return Some(state.tab_id.clone());
            }
        }
        // 2. CWD prefix match fallback.
        self.cwd_match(payload.cwd.as_deref())
    }

    /// Finds a tab whose tracked CWD matches `cwd` via prefix matching.
    fn cwd_match(&self, cwd: Option<&str>) -> Option<String> {
        let cwd = cwd?;
        self.tab_cwds
            .iter()
            .find(|(_, tab_cwd)| {
                tab_cwd.starts_with(cwd) || cwd.starts_with(tab_cwd.as_str())
            })
            .map(|(tab_id, _)| tab_id.clone())
    }

    /// Gets or creates a session keyed by session_id (or a synthetic key for
    /// sessions whose SessionStart was missed).
    fn session_key(payload: &HookPayload, tab_id: &str) -> String {
        payload
            .session_id
            .clone()
            .unwrap_or_else(|| format!("synthetic:{tab_id}"))
    }

    // ── Emit helper ───────────────────────────────────────────────────────────

    fn emit_state(&self, tab_id: &str, state: &str, message: Option<&str>) {
        let Some(emitter) = self.emitters.get(tab_id) else { return };
        let mut data = serde_json::json!({ "state": state });
        if let Some(msg) = message {
            data["message"] = serde_json::Value::String(msg.to_string());
        }
        emitter.emit("agent_turn", "agent_state_changed", data);
    }
}

// ─── Mod trait implementation ─────────────────────────────────────────────────

impl Mod for AgentTurnMod {
    fn id(&self) -> &'static str {
        "agent_turn"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.emitters.insert(ctx.tab_id.to_string(), ctx.async_emitter());
    }

    fn on_cwd_changed(&mut self, cwd: &str, ctx: &ModContext) {
        self.tab_cwds.insert(ctx.tab_id.to_string(), cwd.to_string());
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.emitters.remove(ctx.tab_id);
        self.tab_cwds.remove(ctx.tab_id);
        self.sessions.retain(|_, s| s.tab_id != ctx.tab_id);
    }

    fn on_agent_cleared(&mut self, _agent: &str, ctx: &ModContext) {
        // Fallback cleanup if SessionEnd hook was missed (e.g. agent crashed).
        self.sessions.retain(|_, s| s.tab_id != ctx.tab_id);
    }

    fn on_hook_event(&mut self, payload: &HookPayload) {
        // Filter to known agents so stray POSTs from other tools don't affect state.
        match payload.agent.as_str() {
            "claude-code" | "codex" => {}
            _ => return,
        }
        match payload.event.as_str() {
            "SessionStart" => self.handle_session_start(payload),
            "UserPromptSubmit" => self.handle_in_progress(payload),
            "PreToolUse" => {
                if payload.tool_name.as_deref() == Some("AskUserQuestion") {
                    self.handle_save_question(payload);
                } else {
                    self.handle_in_progress(payload);
                }
            }
            "Notification" => self.handle_awaiting(payload),
            "Stop" => self.handle_completed(payload),
            "SessionEnd" => self.handle_session_end(payload),
            _ => {}
        }
    }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

impl AgentTurnMod {
    fn handle_session_start(&mut self, payload: &HookPayload) {
        let Some(session_id) = payload.session_id.clone() else { return };
        let Some(tab_id) = self.cwd_match(payload.cwd.as_deref()) else { return };

        self.sessions.insert(
            session_id,
            SessionState { tab_id: tab_id.clone(), pending_question: None },
        );
        self.emit_state(&tab_id, "idle", None);
    }

    fn handle_in_progress(&mut self, payload: &HookPayload) {
        // Step 1 — resolve tab_id (immutable borrow).
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        // Step 2 — mutate / create session (mutable borrow, drops before emit).
        {
            let key = Self::session_key(payload, &tab_id);
            let state = self.sessions.entry(key).or_insert_with(|| SessionState {
                tab_id: tab_id.clone(),
                pending_question: None,
            });
            state.pending_question = None;
        }

        // Step 3 — emit (immutable borrow).
        self.emit_state(&tab_id, "in-progress", None);
    }

    fn handle_save_question(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };
        let Some(msg) = &payload.message else { return };
        if msg.trim().is_empty() { return; }

        let msg = msg.clone();
        let key = Self::session_key(payload, &tab_id);
        let state = self.sessions.entry(key).or_insert_with(|| SessionState {
            tab_id: tab_id.clone(),
            pending_question: None,
        });
        state.pending_question = Some(msg);
        // No state change — agent is still running.
    }

    fn handle_awaiting(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };

        // Step 2 — take pending_question out of session (mutable).
        let message: Option<String> = {
            let key = Self::session_key(payload, &tab_id);
            let state = self.sessions.entry(key).or_insert_with(|| SessionState {
                tab_id: tab_id.clone(),
                pending_question: None,
            });
            state.pending_question.take()
        };

        // Fall back to raw notification message, or a generic placeholder.
        let message = message
            .or_else(|| payload.message.clone().filter(|m| !m.trim().is_empty()))
            .or_else(|| Some("Needs your attention".to_string()));

        self.emit_state(&tab_id, "awaiting", message.as_deref());
    }

    fn handle_completed(&mut self, payload: &HookPayload) {
        let Some(tab_id) = self.tab_id_for(payload) else { return };
        let Some(emitter) = self.emitters.get(&tab_id).cloned() else { return };

        // Prefer direct payload field (Codex), then transcript file (Claude).
        let direct_msg = payload
            .last_assistant_message
            .clone()
            .filter(|m| !m.trim().is_empty());
        let transcript = payload.transcript_path.clone();

        tokio::spawn(async move {
            let message = if let Some(msg) = direct_msg {
                Some(msg)
            } else if let Some(path) = transcript {
                read_last_assistant_message(&path).await
            } else {
                None
            };

            let mut data = serde_json::json!({ "state": "completed" });
            if let Some(msg) = message {
                let truncated: String = msg.chars().take(200).collect();
                data["message"] = serde_json::Value::String(truncated);
            }
            emitter.emit("agent_turn", "agent_state_changed", data);
        });
    }

    fn handle_session_end(&mut self, payload: &HookPayload) {
        // Determine tab_id before removing the session.
        let tab_id = payload
            .session_id
            .as_ref()
            .and_then(|sid| self.sessions.get(sid.as_str()).map(|s| s.tab_id.clone()))
            .or_else(|| self.cwd_match(payload.cwd.as_deref()));

        // Remove the session.
        if let Some(sid) = &payload.session_id {
            self.sessions.remove(sid.as_str());
        }

        // Emit idle to clear the completed badge.
        if let Some(tab_id) = tab_id {
            self.emit_state(&tab_id, "idle", None);
        }
    }
}

// ─── Transcript reader ────────────────────────────────────────────────────────

/// Reads the last assistant message from a Claude session JSONL transcript.
async fn read_last_assistant_message(transcript_path: &str) -> Option<String> {
    let content = tokio::fs::read_to_string(transcript_path).await.ok()?;

    for line in content.lines().rev() {
        let entry: serde_json::Value = serde_json::from_str(line).ok()?;

        if entry.get("message")?.get("role")?.as_str()? != "assistant" {
            continue;
        }

        let content_val = &entry["message"]["content"];
        let text = if let Some(s) = content_val.as_str() {
            s.to_string()
        } else if let Some(arr) = content_val.as_array() {
            arr.iter()
                .filter_map(|c| {
                    if c.get("type")?.as_str()? == "text" {
                        c.get("text")?.as_str().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            continue;
        };

        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    None
}
