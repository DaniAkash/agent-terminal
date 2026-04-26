//! Agent hook installation — silently wires hook configs at app startup.
//!
//! `ensure_hooks_installed()` is called once per launch. It writes a small
//! shell helper script for each registered agent and appends our hook entries
//! to the agent's config file — non-destructively. Existing entries from
//! cmux, the user, or any other tool are preserved.
//!
//! Design goals:
//! - **Idempotent**: calling it N times has the same effect as calling it once.
//! - **Non-destructive**: never removes or modifies existing hook entries.
//! - **Silent**: all errors are logged to stderr and swallowed. Never crashes
//!   the app, never shows a prompt.
//! - **Atomic writes**: config changes go through a temp-file rename so a
//!   crash mid-write can't produce a corrupt config.

use serde_json::Value;
use std::path::{Path, PathBuf};

// ─── Static registry ─────────────────────────────────────────────────────────

/// Distinguishes how hook entries are serialised into the agent's config file.
pub enum HookConfigFormat {
    /// `{"type":"command","command":"...","timeout":N}` — used by Claude Code.
    Claude,
    /// `{"command":"..."}` — used by Codex CLI.
    Codex,
}

pub struct AgentHookEvent {
    /// Name used as the key in the agent's config (e.g. `"UserPromptSubmit"`).
    pub event_name: &'static str,
}

pub struct AgentHookConfig {
    /// Human-readable name for log messages.
    pub agent_name: &'static str,
    /// Stem used to name the hook script: `<stem>-hook`.
    pub hook_stem: &'static str,
    /// Value injected as `"agent"` in the POST payload.
    pub agent_id: &'static str,
    /// Tilde path to the agent's hook config file.
    pub config_tilde_path: &'static str,
    pub config_format: HookConfigFormat,
    /// Timeout (ms) written into Claude-format entries.
    pub timeout_ms: u64,
    pub events: &'static [AgentHookEvent],
}

pub static AGENT_HOOK_CONFIGS: &[AgentHookConfig] = &[
    AgentHookConfig {
        agent_name: "Claude Code",
        hook_stem: "claude",
        agent_id: "claude-code",
        config_tilde_path: "~/.claude/settings.json",
        config_format: HookConfigFormat::Claude,
        timeout_ms: 10_000,
        events: &[
            AgentHookEvent { event_name: "SessionStart" },
            AgentHookEvent { event_name: "UserPromptSubmit" },
            AgentHookEvent { event_name: "PreToolUse" },
            AgentHookEvent { event_name: "Notification" },
            AgentHookEvent { event_name: "Stop" },
            AgentHookEvent { event_name: "SessionEnd" },
        ],
    },
    AgentHookConfig {
        agent_name: "Codex CLI",
        hook_stem: "codex",
        agent_id: "codex",
        config_tilde_path: "~/.codex/hooks.json",
        config_format: HookConfigFormat::Codex,
        timeout_ms: 5_000,
        events: &[
            AgentHookEvent { event_name: "SessionStart" },
            AgentHookEvent { event_name: "UserPromptSubmit" },
            AgentHookEvent { event_name: "Stop" },
        ],
    },
];

// ─── Public entry point ───────────────────────────────────────────────────────

/// Silently installs/verifies hooks for all registered agents.
/// Called once at app startup. Never panics, never returns an error to the caller.
pub async fn ensure_hooks_installed() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            eprintln!(
                "[hook_config] could not determine home directory — skipping hook install"
            );
            return;
        }
    };
    let hooks_dir = home.join(".agent-terminal").join("hooks");
    for config in AGENT_HOOK_CONFIGS {
        if let Err(e) = install_for_agent(config, &home, &hooks_dir).await {
            eprintln!(
                "[hook_config] failed to install hooks for {}: {e}",
                config.agent_name
            );
        }
    }
}

async fn install_for_agent(
    config: &AgentHookConfig,
    home: &Path,
    hooks_dir: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let script_path = hooks_dir.join(format!("{}-hook", config.hook_stem));
    let config_path = expand_tilde(config.config_tilde_path, home);
    write_hook_script_to(config, &script_path).await?;
    merge_hook_config_at(config, &config_path, &script_path).await?;
    Ok(())
}

// ─── Hook script generation ───────────────────────────────────────────────────

/// Writes the hook shell script to `script_path`, creating parent dirs as needed.
/// Skips the write if the file already contains the current content (idempotent).
pub(crate) async fn write_hook_script_to(
    config: &AgentHookConfig,
    script_path: &Path,
) -> std::io::Result<()> {
    let content = build_hook_script(config.agent_id);

    if let Some(parent) = script_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Skip write if content is already up to date (S2 test case).
    if let Ok(existing) = tokio::fs::read_to_string(script_path).await {
        if existing == content {
            return Ok(());
        }
    }

    tokio::fs::write(script_path, &content).await?;

    // chmod +x (S1, S3 test cases).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(script_path)?;
        let mut perms = meta.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(script_path, perms)?;
    }

    Ok(())
}

/// Generates the hook shell script content for `agent_id`.
///
/// The script reads the agent's JSON payload from stdin, prepends `agent` and
/// `event` fields, and POSTs to the hook server. Always exits 0 so the agent
/// is never blocked by a hook failure.
fn build_hook_script(agent_id: &str) -> String {
    // The sed command removes the leading `{` from the agent's JSON payload so
    // we can inject our own fields at the front. The result is a valid JSON object:
    //   {"agent":"claude-code","event":"UserPromptSubmit","session_id":"...","cwd":"..."}
    format!(
        "#!/bin/sh\n\
# Written by Agent Terminal. Do not edit — regenerated on each launch.\n\
INPUT=$(cat)\n\
EVENT=\"$1\"\n\
curl -sf -X POST http://localhost:47384/hook \\\n\
  -H 'Content-Type: application/json' \\\n\
  -d \"{{\\\"agent\\\":\\\"{agent_id}\\\",\\\"event\\\":\\\"$EVENT\\\",$(echo \\\"$INPUT\\\" | sed 's/^{{//')}}\" \\\n\
  >/dev/null 2>&1 || true\n",
    )
}

// ─── Config merge ─────────────────────────────────────────────────────────────

/// Appends our hook entries to `config_path` for `config`.
///
/// Idempotency contract:
/// 1. Config does not exist → create with only our hooks.
/// 2. Config exists, no `"hooks"` key → add `"hooks"` with our entries; preserve all other keys.
/// 3. Config has `"hooks"` but missing an event key → add that event key.
/// 4. Config has the event key but not our command → append our entry.
/// 5. Our command already present → do nothing (no duplicate).
/// 6. Existing entries from cmux or user are always preserved.
/// 7. `"hooks"` keys for events we don't register are untouched.
/// 8. Invalid JSON → error returned, file not modified.
pub(crate) async fn merge_hook_config_at(
    config: &AgentHookConfig,
    config_path: &Path,
    script_path: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Read existing config or treat as empty object.
    let raw = if config_path.exists() {
        tokio::fs::read_to_string(config_path).await?
    } else {
        "{}".to_string()
    };

    // Fail fast on malformed JSON (C8 test case) — we never clobber a corrupt file.
    let mut root: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid JSON in {}: {e}", config_path.display()))?;

    if !root.is_object() {
        return Err(format!(
            "{} root is not a JSON object",
            config_path.display()
        )
        .into());
    }

    let script_path_str = script_path.to_string_lossy().to_string();
    let mut modified = false;

    {
        let root_obj = root.as_object_mut().unwrap();
        let hooks = root_obj
            .entry("hooks")
            .or_insert_with(|| Value::Object(serde_json::Map::new()));

        let hooks_obj = hooks
            .as_object_mut()
            .ok_or("\"hooks\" is not a JSON object")?;

        for event in config.events {
            let our_command = format!("{} {}", script_path_str, event.event_name);

            let arr = hooks_obj
                .entry(event.event_name)
                .or_insert_with(|| Value::Array(vec![]));

            let arr = arr
                .as_array_mut()
                .ok_or_else(|| format!("\"hooks.{}\" is not a JSON array", event.event_name))?;

            // Migration: remove stale flat-format entries (old Claude format was
            // {type, command} at the top level; Claude now requires the matcher+hooks
            // nesting). These cause Claude Code to report a "settings file damaged" error.
            let before = arr.len();
            arr.retain(|entry| {
                entry.get("command").and_then(|v| v.as_str()) != Some(our_command.as_str())
            });
            if arr.len() < before {
                modified = true;
            }

            // Idempotency check — skip if our command is already present in the
            // current (nested matcher+hooks) format (C5, C10, D3, D4).
            let already_installed = command_in_nested_entry(arr, &our_command);

            if !already_installed {
                arr.push(build_hook_entry(config, &our_command));
                modified = true;
            }
        }
    }

    if !modified {
        return Ok(());
    }

    // Create parent directory if needed.
    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Atomic write: temp file → rename.
    let serialized = serde_json::to_string_pretty(&root)?;
    let tmp_path = config_path.with_extension("agent-terminal.tmp");
    tokio::fs::write(&tmp_path, format!("{serialized}\n")).await?;
    tokio::fs::rename(&tmp_path, config_path).await?;

    Ok(())
}

fn build_hook_entry(config: &AgentHookConfig, command: &str) -> Value {
    match config.config_format {
        // Claude Code format (as of Claude Code ≥1.x):
        // each array entry is a matcher object wrapping an inner hooks array.
        // Empty matcher string means "match all" (fires for every tool/event).
        HookConfigFormat::Claude => serde_json::json!({
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": command,
                    "timeout": config.timeout_ms,
                }
            ]
        }),
        HookConfigFormat::Codex => serde_json::json!({
            "command": command,
        }),
    }
}

/// Returns true if `our_command` is found inside any entry's nested `hooks` array.
/// Used for Claude's matcher+hooks format.
fn command_in_nested_entry(arr: &[Value], our_command: &str) -> bool {
    arr.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|inner| {
                inner.iter().any(|h| {
                    h.get("command").and_then(|v| v.as_str()) == Some(our_command)
                })
            })
            .unwrap_or(false)
    })
}

fn expand_tilde(path: &str, home: &Path) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(path)
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn claude_config() -> &'static AgentHookConfig {
        &AGENT_HOOK_CONFIGS[0]
    }

    fn codex_config() -> &'static AgentHookConfig {
        &AGENT_HOOK_CONFIGS[1]
    }

    fn temp_dir(suffix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("at_hook_test_{suffix}"));
        // Wipe from any previous run so each test starts clean.
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_json(path: &Path) -> Value {
        let content = fs::read_to_string(path).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    fn has_our_command(v: &Value, event: &str, script: &Path) -> bool {
        let expected = format!("{} {event}", script.display());
        v["hooks"][event]
            .as_array()
            .map(|arr| {
                arr.iter().any(|e| {
                    // Claude new format: command is nested inside hooks[].
                    let in_nested = e
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|inner| {
                            inner.iter().any(|h| {
                                h.get("command").and_then(|v| v.as_str())
                                    == Some(expected.as_str())
                            })
                        })
                        .unwrap_or(false);
                    // Codex flat format: command is at top level.
                    let at_top = e["command"].as_str() == Some(expected.as_str());
                    in_nested || at_top
                })
            })
            .unwrap_or(false)
    }

    // ── C1: fresh install — file does not exist ───────────────────────────────
    #[tokio::test]
    async fn c1_claude_fresh_install() {
        let dir = temp_dir("c1");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        assert!(!config_path.exists());
        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        assert!(config_path.exists());
        let v = read_json(&config_path);
        assert!(v["hooks"].is_object(), "hooks key must exist");
        for event in claude_config().events {
            assert!(
                has_our_command(&v, event.event_name, &script),
                "missing command for {}", event.event_name
            );
        }
        // File must contain exactly the hooks we wrote — no phantom keys.
        let obj = v.as_object().unwrap();
        assert_eq!(obj.len(), 1, "root should have exactly one key: hooks");
    }

    // ── C2: file exists, no "hooks" key ──────────────────────────────────────
    #[tokio::test]
    async fn c2_claude_no_hooks_key() {
        let dir = temp_dir("c2");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        fs::write(&config_path, r#"{"model":"sonnet","verbose":true}"#).unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Existing keys preserved.
        assert_eq!(v["model"].as_str(), Some("sonnet"));
        assert_eq!(v["verbose"].as_bool(), Some(true));
        // Our hooks added.
        assert!(v["hooks"].is_object());
        assert!(has_our_command(&v, "UserPromptSubmit", &script));
    }

    // ── C3: hooks key exists, event array missing ─────────────────────────────
    #[tokio::test]
    async fn c3_claude_event_array_missing() {
        let dir = temp_dir("c3");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        // File has hooks but only for one existing event (not ours).
        fs::write(
            &config_path,
            r#"{"hooks":{"PostToolUse":[{"type":"command","command":"my-tool"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Existing unrelated event preserved.
        let post_arr = v["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_arr.len(), 1, "PostToolUse should still have 1 entry");
        // Our events added.
        assert!(has_our_command(&v, "SessionStart", &script));
        assert!(has_our_command(&v, "Stop", &script));
    }

    // ── C4: event array present, our command absent → append ─────────────────
    #[tokio::test]
    async fn c4_claude_append_to_existing_array() {
        let dir = temp_dir("c4");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        fs::write(
            &config_path,
            r#"{"hooks":{"UserPromptSubmit":[{"type":"command","command":"other-tool prompt"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let arr = v["hooks"]["UserPromptSubmit"].as_array().unwrap();
        // Original entry preserved.
        assert!(arr.iter().any(|e| e["command"].as_str() == Some("other-tool prompt")));
        // Our entry appended.
        assert!(has_our_command(&v, "UserPromptSubmit", &script));
        assert!(arr.len() >= 2, "should have at least 2 entries");
    }

    // ── C5: our command already present → no change ───────────────────────────
    #[tokio::test]
    async fn c5_claude_already_installed_no_duplicate() {
        let dir = temp_dir("c5");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        // Pre-install once.
        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();
        let before = fs::read_to_string(&config_path).unwrap();

        // Second call — should not modify the file.
        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();
        let after = fs::read_to_string(&config_path).unwrap();

        assert_eq!(before, after, "file should be unchanged on re-install");
    }

    // ── C6: cmux entries preserved alongside ours ─────────────────────────────
    #[tokio::test]
    async fn c6_claude_cmux_entries_preserved() {
        let dir = temp_dir("c6");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        fs::write(
            &config_path,
            r#"{"hooks":{"UserPromptSubmit":[{"type":"command","command":"cmux claude-hook prompt-submit"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let arr = v["hooks"]["UserPromptSubmit"].as_array().unwrap();
        // cmux entry preserved.
        assert!(arr
            .iter()
            .any(|e| e["command"].as_str() == Some("cmux claude-hook prompt-submit")));
        // Our entry also present.
        assert!(has_our_command(&v, "UserPromptSubmit", &script));
    }

    // ── C7: unregistered event array untouched ────────────────────────────────
    #[tokio::test]
    async fn c7_claude_unregistered_event_untouched() {
        let dir = temp_dir("c7");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        fs::write(
            &config_path,
            r#"{"hooks":{"MyCustomHook":[{"type":"command","command":"custom-tool"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Custom hook still has exactly one entry.
        let arr = v["hooks"]["MyCustomHook"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "unregistered event should be untouched");
        assert_eq!(arr[0]["command"].as_str(), Some("custom-tool"));
    }

    // ── C8: invalid JSON → error, file not modified ───────────────────────────
    #[tokio::test]
    async fn c8_claude_invalid_json_not_modified() {
        let dir = temp_dir("c8");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");
        let bad_json = "{ this is not json }";

        fs::write(&config_path, bad_json).unwrap();

        let result = merge_hook_config_at(claude_config(), &config_path, &script).await;
        assert!(result.is_err(), "should error on invalid JSON");

        // File must not have been modified.
        let after = fs::read_to_string(&config_path).unwrap();
        assert_eq!(after, bad_json, "file must not be modified on parse error");
    }

    // ── C9: all six Claude events installed in a single pass ──────────────────
    #[tokio::test]
    async fn c9_claude_all_six_events_installed() {
        let dir = temp_dir("c9");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let hooks = v["hooks"].as_object().unwrap();
        assert_eq!(hooks.len(), 6, "should have exactly 6 event keys");

        let expected = [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "Notification",
            "Stop",
            "SessionEnd",
        ];
        for event in expected {
            assert!(
                has_our_command(&v, event, &script),
                "missing command for {event}"
            );
        }
    }

    // ── C10: idempotent — two calls equal one call ────────────────────────────
    #[tokio::test]
    async fn c10_claude_idempotent_two_calls() {
        let dir = temp_dir("c10");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();
        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Each event array should have exactly one entry (ours) in nested format.
        for event in claude_config().events {
            let arr = v["hooks"][event.event_name].as_array().unwrap();
            let our_cmd = format!("{} {}", script.display(), event.event_name);
            // Count entries whose inner hooks[] contains our command.
            let count = arr
                .iter()
                .filter(|e| {
                    e.get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|inner| inner.iter().any(|h| {
                            h.get("command").and_then(|v| v.as_str()) == Some(our_cmd.as_str())
                        }))
                        .unwrap_or(false)
                })
                .count();
            assert_eq!(count, 1, "event {} should have exactly one entry", event.event_name);
        }
    }

    // ── C11: stale flat-format entries are replaced with new nested format ────
    #[tokio::test]
    async fn c11_claude_migrates_old_flat_format() {
        let dir = temp_dir("c11");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");
        let our_cmd = format!("{} UserPromptSubmit", script.display());

        // Write the old (now-invalid) flat format that we used to produce.
        fs::write(
            &config_path,
            format!(
                r#"{{"hooks":{{"UserPromptSubmit":[{{"type":"command","command":"{our_cmd}","timeout":10000}}]}}}}"#
            ),
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let arr = v["hooks"]["UserPromptSubmit"].as_array().unwrap();

        // Old flat entry must be gone.
        let flat_still_there = arr.iter().any(|e| e["command"].as_str() == Some(&our_cmd));
        assert!(!flat_still_there, "stale flat entry should be removed");

        // New nested entry must be present.
        assert!(has_our_command(&v, "UserPromptSubmit", &script));

        // Only one entry for UserPromptSubmit (no duplicate).
        assert_eq!(arr.len(), 1, "should be exactly one entry after migration");
    }

    // ── D1: Codex fresh install ───────────────────────────────────────────────
    #[tokio::test]
    async fn d1_codex_fresh_install() {
        let dir = temp_dir("d1");
        let config_path = dir.join("hooks.json");
        let script = dir.join("codex-hook");

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        assert!(v["hooks"].is_object());
        for event in codex_config().events {
            let arr = v["hooks"][event.event_name].as_array().unwrap();
            let our_cmd = format!("{} {}", script.display(), event.event_name);
            assert!(
                arr.iter().any(|e| e["command"].as_str() == Some(our_cmd.as_str())),
                "missing {}", event.event_name
            );
            // Codex format: no "type" field.
            let our_entry = arr
                .iter()
                .find(|e| e["command"].as_str() == Some(our_cmd.as_str()))
                .unwrap();
            assert!(
                our_entry.get("type").is_none(),
                "Codex entries must not have a type field"
            );
        }
    }

    // ── D2: Codex file exists, entries absent → appended ─────────────────────
    #[tokio::test]
    async fn d2_codex_append_to_existing() {
        let dir = temp_dir("d2");
        let config_path = dir.join("hooks.json");
        let script = dir.join("codex-hook");

        fs::write(
            &config_path,
            r#"{"hooks":{"SessionStart":[{"command":"my-existing-hook start"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Existing entry preserved.
        let arr = v["hooks"]["SessionStart"].as_array().unwrap();
        assert!(arr
            .iter()
            .any(|e| e["command"].as_str() == Some("my-existing-hook start")));
        // Ours also present.
        assert!(has_our_command(&v, "SessionStart", &script));
    }

    // ── D3: Codex entries already present → unchanged ─────────────────────────
    #[tokio::test]
    async fn d3_codex_already_installed() {
        let dir = temp_dir("d3");
        let config_path = dir.join("hooks.json");
        let script = dir.join("codex-hook");

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();
        let before = fs::read_to_string(&config_path).unwrap();

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();
        let after = fs::read_to_string(&config_path).unwrap();

        assert_eq!(before, after, "Codex file unchanged on re-install");
    }

    // ── D4: Codex idempotent — two calls ─────────────────────────────────────
    #[tokio::test]
    async fn d4_codex_idempotent_two_calls() {
        let dir = temp_dir("d4");
        let config_path = dir.join("hooks.json");
        let script = dir.join("codex-hook");

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();
        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        for event in codex_config().events {
            let arr = v["hooks"][event.event_name].as_array().unwrap();
            let our_cmd = format!("{} {}", script.display(), event.event_name);
            let count = arr
                .iter()
                .filter(|e| e["command"].as_str() == Some(our_cmd.as_str()))
                .count();
            assert_eq!(count, 1, "event {} should have exactly one entry", event.event_name);
        }
    }

    // ── S1: script does not exist → written, chmod +x ────────────────────────
    #[tokio::test]
    async fn s1_script_written_executable() {
        let dir = temp_dir("s1");
        let script = dir.join("claude-hook");

        assert!(!script.exists());
        write_hook_script_to(claude_config(), &script).await.unwrap();

        assert!(script.exists(), "script should be created");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(&script).unwrap();
            let mode = meta.permissions().mode();
            assert!(mode & 0o100 != 0, "script should be executable by owner");
        }
    }

    // ── S2: script exists with correct content → not rewritten ───────────────
    #[tokio::test]
    async fn s2_script_not_rewritten_if_current() {
        let dir = temp_dir("s2");
        let script = dir.join("claude-hook");

        write_hook_script_to(claude_config(), &script).await.unwrap();
        let mtime_before = fs::metadata(&script).unwrap().modified().unwrap();

        // Brief pause to make mtime detectable.
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        write_hook_script_to(claude_config(), &script).await.unwrap();
        let mtime_after = fs::metadata(&script).unwrap().modified().unwrap();

        assert_eq!(mtime_before, mtime_after, "script should not be rewritten if already current");
    }

    // ── S3: script exists with outdated content → overwritten ─────────────────
    #[tokio::test]
    async fn s3_outdated_script_overwritten() {
        let dir = temp_dir("s3");
        let script = dir.join("claude-hook");

        // Write stale content.
        fs::write(&script, "#!/bin/sh\necho old").unwrap();

        write_hook_script_to(claude_config(), &script).await.unwrap();

        let content = fs::read_to_string(&script).unwrap();
        assert!(content.contains("localhost:47384"), "script should be updated");
        assert!(!content.contains("echo old"), "old content should be replaced");
    }
}
