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

use crate::agents::{self, HookInstall};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

// ─── Native-config install view ──────────────────────────────────────────────
//
// The agent registry (`crate::agents`) is the single source of truth. This
// module materialises the subset of agents whose hooks install via a settings
// -file merge (Claude, Codex) into `AGENT_HOOK_CONFIGS`. Both speak the same
// hook protocol: nested matcher+hooks JSON entries with
// `{type:"command", command:"…", timeout:N}`. Codex's engine is literally named
// `ClaudeHooksEngine` and reads the same shape from `~/.codex/hooks.json` that
// Claude reads from `~/.claude/settings.json`.
//
// Plugin-based agents (opencode) install differently and are handled by
// `install_plugin_agents`, not this list.

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
    /// Timeout (ms) written into each hook entry.
    pub timeout_ms: u64,
    pub events: Vec<AgentHookEvent>,
}

/// The native-config install view, derived from the agent registry. Only agents
/// with a `HookInstall::NativeConfig` appear here (Claude, Codex). Order follows
/// the registry, so index 0 is Claude and index 1 is Codex.
pub static AGENT_HOOK_CONFIGS: LazyLock<Vec<AgentHookConfig>> = LazyLock::new(|| {
    agents::AGENTS
        .iter()
        .filter_map(|a| {
            let hook = a.hook.as_ref()?;
            let HookInstall::NativeConfig { config_tilde_path } = &hook.install else {
                return None;
            };
            Some(AgentHookConfig {
                agent_name: a.display_name,
                // Script filename stem — the agent's primary process name keeps
                // the on-disk name stable (`claude-hook`, `codex-hook`).
                hook_stem: a.process_names.first().copied().unwrap_or(a.id),
                agent_id: a.id,
                config_tilde_path,
                timeout_ms: hook.timeout_ms,
                events: hook
                    .events
                    .iter()
                    .map(|e| AgentHookEvent { event_name: e.name })
                    .collect(),
            })
        })
        .collect()
});

// ─── Registry lookup ──────────────────────────────────────────────────────────

/// Looks up an `AgentHookConfig` by its `agent_id` (e.g. `"claude-code"`).
///
/// Resolves the native-config view for consumers that need an agent's display
/// name or event list. For display name alone, `crate::agents::by_id` is the
/// direct path.
pub fn config_for_agent_id(agent_id: &str) -> Option<&'static AgentHookConfig> {
    AGENT_HOOK_CONFIGS.iter().find(|c| c.agent_id == agent_id)
}

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
    let hooks_dir = home
        .join(format!(".{}", crate::identity::NAMESPACE))
        .join("hooks");
    for config in AGENT_HOOK_CONFIGS.iter() {
        if let Err(e) = install_for_agent(config, &home, &hooks_dir).await {
            eprintln!(
                "[hook_config] failed to install hooks for {}: {e}",
                config.agent_name
            );
        }
    }
    install_registry_hook_agents(&home).await;
}

const TOML_BLOCK_BEGIN: &str = "# >>> agent-terminal hooks";
const TOML_BLOCK_END: &str = "# <<< agent-terminal hooks";

/// Installs the registry's non-native hook integrations (plugin, TOML block,
/// flat JSON). Each is only written when the agent's config directory already
/// exists, so we never create an agent's config tree for a user who does not
/// have it.
async fn install_registry_hook_agents(home: &Path) {
    for a in agents::AGENTS {
        let Some(hook) = a.hook.as_ref() else { continue };
        let result = match &hook.install {
            HookInstall::NativeConfig { .. } => continue, // handled via AGENT_HOOK_CONFIGS
            HookInstall::Plugin { dir_tilde_path, install_name, asset } => {
                install_plugin_asset(&expand_tilde(dir_tilde_path, home), install_name, asset).await
            }
            HookInstall::TomlBlock { config_tilde_path, hooks_dir_tilde_path, script_name, events } => {
                install_toml_block(home, a.id, config_tilde_path, hooks_dir_tilde_path, script_name, events).await
            }
            HookInstall::FlatJson { config_tilde_path, hooks_dir_tilde_path, script_name, events } => {
                install_flat_json(home, a.id, config_tilde_path, hooks_dir_tilde_path, script_name, events).await
            }
        };
        if let Err(e) = result {
            eprintln!("[hook_config] failed to install {} hook: {e}", a.display_name);
        }
    }
}

/// Generates a hook script for agents that report a resolved state as the first
/// argument (Kimi, Mastra). Unlike `build_hook_script`, it does not read the
/// agent's JSON from stdin: it emits a well-formed payload from `$1` and the tab
/// env var alone. Fire-and-forget POST to the hook server.
fn build_action_hook_script(agent_id: &str) -> String {
    format!(
        "#!/bin/sh\n\
# Written by Agent Terminal. Do not edit; regenerated on each launch.\n\
# Reports a resolved agent state (passed as $1) to the hook server.\n\
EVENT=\"$1\"\n\
case \"$AGENT_TERMINAL_TAB_ID\" in\n\
  '') TAB_SUFFIX=\"\" ;;\n\
  *[!A-Za-z0-9:_-]*) TAB_SUFFIX=\"\" ;;\n\
  *) TAB_SUFFIX=\",\\\"tab_id\\\":\\\"$AGENT_TERMINAL_TAB_ID\\\"\" ;;\n\
esac\n\
PAYLOAD=\"{{\\\"agent\\\":\\\"{agent_id}\\\",\\\"event\\\":\\\"$EVENT\\\"${{TAB_SUFFIX}}}}\"\n\
{{ curl -sf --max-time 5 -X POST http://127.0.0.1:{port}/hook \\\n\
    -H 'Content-Type: application/json' \\\n\
    -d \"$PAYLOAD\" \\\n\
    >/dev/null 2>&1 & }} 2>/dev/null\n\
exit 0\n",
        agent_id = agent_id,
        port = crate::identity::HOOK_PORT,
    )
}

/// Writes the action hook script to `hooks_dir/name`, idempotently, chmod +x.
async fn write_action_script(
    hooks_dir: &Path,
    name: &str,
    agent_id: &str,
) -> std::io::Result<PathBuf> {
    tokio::fs::create_dir_all(hooks_dir).await?;
    let path = hooks_dir.join(name);
    let content = build_action_hook_script(agent_id);
    let needs_write = match tokio::fs::read_to_string(&path).await {
        Ok(existing) => existing != content,
        Err(_) => true,
    };
    if needs_write {
        tokio::fs::write(&path, &content).await?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms)?;
    }
    Ok(path)
}

/// Quotes a string as a TOML basic string.
fn toml_basic_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Replaces the marker-delimited managed block in `existing` with `block`, or
/// appends `block` when no managed block is present. `block` must include the
/// begin/end markers and a trailing newline.
fn replace_managed_block(existing: &str, begin: &str, end: &str, block: &str) -> String {
    if let Some(b) = existing.find(begin) {
        // Find the end marker AFTER the begin marker, so a stray end marker
        // earlier in unrelated content can't cause a mismatch.
        if let Some(rel) = existing[b..].find(end) {
            let e = b + rel;
            let mut tail = e + end.len();
            if existing[tail..].starts_with('\n') {
                tail += 1;
            }
            return format!("{}{block}{}", &existing[..b], &existing[tail..]);
        }
    }
    if existing.is_empty() {
        block.to_string()
    } else if existing.ends_with('\n') {
        format!("{existing}\n{block}")
    } else {
        format!("{existing}\n\n{block}")
    }
}

/// Kimi: register hooks as a managed block of `[[hooks]]` tables in config.toml.
async fn install_toml_block(
    home: &Path,
    agent_id: &str,
    config_tilde: &str,
    hooks_dir_tilde: &str,
    script_name: &str,
    events: &[(&str, &str)],
) -> std::io::Result<()> {
    let config_path = expand_tilde(config_tilde, home);
    match config_path.parent() {
        Some(dir) if dir.exists() => {}
        _ => return Ok(()),
    }
    let script_path = write_action_script(&expand_tilde(hooks_dir_tilde, home), script_name, agent_id).await?;

    let mut body = String::new();
    for (event, action) in events {
        // Single-quote the path so a home dir with spaces does not split argv.
        let command = format!("bash '{}' {}", script_path.display(), action);
        body.push_str(&format!(
            "[[hooks]]\nevent = {}\ncommand = {}\ntimeout = 10\n\n",
            toml_basic_string(event),
            toml_basic_string(&command),
        ));
    }
    let block = format!("{TOML_BLOCK_BEGIN}\n{body}{TOML_BLOCK_END}\n");

    let existing = tokio::fs::read_to_string(&config_path).await.unwrap_or_default();
    let updated = replace_managed_block(&existing, TOML_BLOCK_BEGIN, TOML_BLOCK_END, &block);
    if updated != existing {
        tokio::fs::write(&config_path, updated).await?;
    }
    Ok(())
}

/// Mastra: register hooks in a flat JSON hooks file, non-destructively.
async fn install_flat_json(
    home: &Path,
    agent_id: &str,
    config_tilde: &str,
    hooks_dir_tilde: &str,
    script_name: &str,
    events: &[(&str, &str)],
) -> std::io::Result<()> {
    let config_path = expand_tilde(config_tilde, home);
    match config_path.parent() {
        Some(dir) if dir.exists() => {}
        _ => return Ok(()),
    }
    let script_path = write_action_script(&expand_tilde(hooks_dir_tilde, home), script_name, agent_id).await?;

    let raw = if config_path.exists() {
        tokio::fs::read_to_string(&config_path).await?
    } else {
        "{}".to_string()
    };
    let mut root: Value = serde_json::from_str(&raw)
        .map_err(|e| std::io::Error::other(format!("invalid JSON in {}: {e}", config_path.display())))?;
    if !root.is_object() {
        return Err(std::io::Error::other(format!("{} root is not a JSON object", config_path.display())));
    }

    let mut modified = false;
    {
        let obj = root.as_object_mut().unwrap();
        for (event, action) in events {
            // Single-quote the path so a home dir with spaces does not split argv.
            let command = format!("bash '{}' {}", script_path.display(), action);
            let arr = obj
                .entry(event.to_string())
                .or_insert_with(|| Value::Array(vec![]))
                .as_array_mut()
                .ok_or_else(|| std::io::Error::other(format!("hooks.{event} is not an array")))?;
            let present = arr.iter().any(|e| {
                e.get("type").and_then(Value::as_str) == Some("command")
                    && e.get("command").and_then(Value::as_str) == Some(command.as_str())
            });
            if !present {
                arr.push(serde_json::json!({
                    "type": "command",
                    "command": command,
                    "timeout": 10000,
                }));
                modified = true;
            }
        }
    }
    if modified {
        let serialized = serde_json::to_string_pretty(&root)?;
        let tmp = config_path.with_extension(format!("agent-terminal-{}.tmp", std::process::id()));
        tokio::fs::write(&tmp, format!("{serialized}\n")).await?;
        tokio::fs::rename(&tmp, &config_path).await?;
    }
    Ok(())
}

/// Writes a plugin `asset` to `plugin_dir/name`, idempotently. Skips entirely
/// when the agent is absent (its config dir, the parent of `plugin_dir`, does
/// not exist), and skips the write when the asset is already current.
async fn install_plugin_asset(
    plugin_dir: &Path,
    name: &str,
    asset: &str,
) -> std::io::Result<()> {
    match plugin_dir.parent() {
        Some(config_dir) if config_dir.exists() => {}
        _ => return Ok(()),
    }
    tokio::fs::create_dir_all(plugin_dir).await?;
    let path = plugin_dir.join(name);
    if let Ok(existing) = tokio::fs::read_to_string(&path).await {
        if existing == asset {
            return Ok(());
        }
    }
    tokio::fs::write(&path, asset).await?;
    Ok(())
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
/// The script reads the agent's JSON payload from stdin, prepends `agent`,
/// `event`, and (when set) `tab_id` fields, then fires a curl POST to the
/// hook server in a detached background subshell. The script exits in
/// milliseconds regardless of what curl does — Claude Code (and any other
/// agent) is never blocked waiting on the hook server.
///
/// `tab_id` comes from `$AGENT_TERMINAL_TAB_ID`, which `pty_manager` injects
/// into every shell it spawns. When the agent is running OUTSIDE
/// agent-terminal (iTerm, Terminal.app, etc.), the env var is unset and the
/// `tab_id` field is omitted entirely. Server-side that becomes
/// `HookPayload::tab_id == None` and `AgentTurnMod` drops the event. This is
/// the load-bearing piece of the cross-terminal-noise fix — without it, the
/// only correlation signal was CWD prefix matching, which can't distinguish
/// two terminals at the same path.
///
/// Why detach instead of `--connect-timeout`/`--max-time`: ECONNREFUSED is
/// instant on macOS, so a missing server doesn't hang. The hang we hit in
/// 2026-04-26 was from a zombie process holding port 47384 in LISTEN state
/// without responding — curl established the TCP connection then waited ~60s
/// for a response that never came. A timeout would bound the hang per call,
/// but every hook would still pay that cost. Fire-and-forget eliminates the
/// problem structurally: the script's only job is one-way notification, so
/// it has no business waiting for the HTTP response. `--max-time 5` stays as
/// a ceiling on background curl lifetime so they don't accumulate as zombies
/// if the server is hung and hooks fire repeatedly.
///
/// Why `127.0.0.1` and not `localhost`: the server binds `127.0.0.1:<HOOK_PORT>`
/// (IPv4 only — port is 47384 in prod, 47385 in dev, see `identity.rs`). On
/// macOS, `localhost` resolves to `::1` first, so curl tries IPv6 and gets
/// ECONNREFUSED before falling back to IPv4 (Happy Eyeballs). The fallback
/// works, but every hook eats the latency for nothing. Pinning the script to
/// `127.0.0.1` matches the server's address family directly.
fn build_hook_script(agent_id: &str) -> String {
    // The sed command removes the leading `{` from the agent's JSON payload so
    // we can inject our own fields at the front. The result is a valid JSON object:
    //   {"agent":"claude-code","event":"UserPromptSubmit","tab_id":"…","session_id":"…","cwd":"…"}
    //
    // CRITICAL: the inner echo uses bare "$INPUT" (shell-quoted), NOT \"$INPUT\".
    // The backslash-quote form prints LITERAL quote characters around the value,
    // so sed never sees the leading `{` and the merged payload is malformed JSON.
    // That bug shipped originally and silently broke every hook delivery —
    // serde rejected the bad JSON, ps-fallback kept the UI working, nobody
    // noticed until the integration tests caught it.
    //
    // TAB_FIELD is built BEFORE PAYLOAD so the `tab_id` field is omitted
    // entirely when AGENT_TERMINAL_TAB_ID is unset. Inserting an empty string
    // would produce a `"tab_id":""` field; the server's gate explicitly
    // rejects empty strings too, but emitting nothing is cleaner.
    //
    // Defense-in-depth: the env value is validated against a strict charset
    // before going into the JSON. Today, tab ids are composite frontend
    // identifiers (`<projectId>:<tabId>`) — never user-controllable — so a
    // hostile value can't actually arrive. But the script interpolates the
    // value raw into a JSON string, which would corrupt the payload (or
    // inject extra fields) if a `"`, `\`, or newline ever slipped through.
    // The case statement omits the field on any unexpected character, so a
    // future change to the tab-id format that introduces unsafe chars
    // degrades to "no correlation" rather than "malformed POST".
    format!(
        "#!/bin/sh\n\
# Written by Agent Terminal. Do not edit — regenerated on each launch.\n\
# Fire-and-forget: script returns immediately so Claude/Codex never block on hook delivery.\n\
INPUT=$(cat)\n\
EVENT=\"$1\"\n\
STRIPPED=$(printf '%s' \"$INPUT\" | sed 's/^{{//')\n\
case \"$AGENT_TERMINAL_TAB_ID\" in\n\
  '') TAB_FIELD=\"\" ;;\n\
  *[!A-Za-z0-9:_-]*) TAB_FIELD=\"\" ;;\n\
  *) TAB_FIELD=\"\\\"tab_id\\\":\\\"$AGENT_TERMINAL_TAB_ID\\\",\" ;;\n\
esac\n\
PAYLOAD=\"{{\\\"agent\\\":\\\"{agent_id}\\\",\\\"event\\\":\\\"$EVENT\\\",${{TAB_FIELD}}$STRIPPED\"\n\
{{ curl -sf --max-time 5 -X POST http://127.0.0.1:{port}/hook \\\n\
    -H 'Content-Type: application/json' \\\n\
    -d \"$PAYLOAD\" \\\n\
    >/dev/null 2>&1 & }} 2>/dev/null\n\
exit 0\n",
        port = crate::identity::HOOK_PORT,
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

        for event in &config.events {
            let our_command = format!("{} {}", script_path_str, event.event_name);

            let arr = hooks_obj
                .entry(event.event_name)
                .or_insert_with(|| Value::Array(vec![]));

            let arr = arr
                .as_array_mut()
                .ok_or_else(|| format!("\"hooks.{}\" is not a JSON array", event.event_name))?;

            // Idempotency check — skip if our command is already present in the
            // nested hooks[] array (C5, C10, D3, D4). Same check for both
            // Claude and Codex since they share the schema.
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
    // Per-PID temp filename so two instances writing the same config file
    // concurrently don't corrupt each other's atomic writes.
    //
    // TODO(DaniAkash): atomic write protects the temp file from corruption
    // but not the read-modify-write of the config file itself. If two
    // instances read concurrently, the second rename's content overwrites
    // the first instance's entry — self-heals on the loser's next launch
    // (re-add path), but means hooks in the missing-entry window are
    // dropped. Proper fix: advisory file lock around the load → merge →
    // write_atomic block (fs4 crate's `FileExt::lock_exclusive`).
    let tmp_path = config_path.with_extension(format!(
        "agent-terminal-{}.tmp",
        std::process::id()
    ));
    tokio::fs::write(&tmp_path, format!("{serialized}\n")).await?;
    tokio::fs::rename(&tmp_path, config_path).await?;

    Ok(())
}

/// Builds a single hook entry in the nested matcher+hooks JSON format.
///
/// Both Claude Code and Codex CLI use this exact schema. Codex implements
/// Claude's hook protocol verbatim (see codex-rs/hooks/ — the engine is named
/// `ClaudeHooksEngine`). Empty matcher string means "match all" (fires for
/// every tool/event).
fn build_hook_entry(config: &AgentHookConfig, command: &str) -> Value {
    serde_json::json!({
        "matcher": "",
        "hooks": [
            {
                "type": "command",
                "command": command,
                "timeout": config.timeout_ms,
            }
        ]
    })
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
        for event in &claude_config().events {
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
        // PreCompact is deliberately an event agent-terminal does not
        // register, so this asserts we leave a user's unrelated hooks alone.
        fs::write(
            &config_path,
            r#"{"hooks":{"PreCompact":[{"type":"command","command":"my-tool"}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        // Existing unrelated event preserved.
        let post_arr = v["hooks"]["PreCompact"].as_array().unwrap();
        assert_eq!(post_arr.len(), 1, "PreCompact should still have 1 entry");
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

    // ── C9: every Claude event installed in a single pass ─────────────────────
    #[tokio::test]
    async fn c9_claude_all_events_installed() {
        let dir = temp_dir("c9");
        let config_path = dir.join("settings.json");
        let script = dir.join("claude-hook");

        merge_hook_config_at(claude_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let hooks = v["hooks"].as_object().unwrap();
        assert_eq!(hooks.len(), 10, "should have exactly 10 event keys");

        let expected = [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "SubagentStop",
            "PermissionRequest",
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
        for event in &claude_config().events {
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

    // ── D1: Codex fresh install — nested matcher+hooks format ────────────────
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
        for event in &codex_config().events {
            // Same nested format as Claude: each entry has a "hooks" array
            // containing {type:"command", command:"…"} objects. Codex's hook
            // engine is literally Claude's — see codex-rs/hooks/.
            assert!(
                has_our_command(&v, event.event_name, &script),
                "missing {} in nested matcher+hooks format", event.event_name
            );
        }
    }

    // ── D2: Codex file exists, entries absent → appended (nested format) ─────
    #[tokio::test]
    async fn d2_codex_append_to_existing() {
        let dir = temp_dir("d2");
        let config_path = dir.join("hooks.json");
        let script = dir.join("codex-hook");

        // Pre-existing entry uses the same nested format too — that's the
        // canonical schema for codex hooks.
        fs::write(
            &config_path,
            r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"my-existing-hook start"}]}]}}"#,
        )
        .unwrap();

        merge_hook_config_at(codex_config(), &config_path, &script)
            .await
            .unwrap();

        let v = read_json(&config_path);
        let arr = v["hooks"]["SessionStart"].as_array().unwrap();
        // Existing entry preserved.
        let existing_present = arr.iter().any(|entry| {
            entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|inner| {
                    inner.iter().any(|h| {
                        h.get("command").and_then(|c| c.as_str()) == Some("my-existing-hook start")
                    })
                })
                .unwrap_or(false)
        });
        assert!(existing_present, "existing nested hook entry should be preserved");
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
        for event in &codex_config().events {
            let arr = v["hooks"][event.event_name].as_array().unwrap();
            let our_cmd = format!("{} {}", script.display(), event.event_name);
            // Count occurrences inside nested hooks[] arrays (same format as Claude).
            let count: usize = arr
                .iter()
                .map(|entry| {
                    entry
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|inner| {
                            inner
                                .iter()
                                .filter(|h| {
                                    h.get("command").and_then(|c| c.as_str())
                                        == Some(our_cmd.as_str())
                                })
                                .count()
                        })
                        .unwrap_or(0)
                })
                .sum();
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
        // 127.0.0.1 (not `localhost`) so the script's address family matches
        // the server's bind. See doc comment on `build_hook_script`.
        let expected = format!("127.0.0.1:{}", crate::identity::HOOK_PORT);
        assert!(content.contains(&expected), "script should contain {expected}");
        assert!(!content.contains("echo old"), "old content should be replaced");
    }

    // ── S4: script forwards AGENT_TERMINAL_TAB_ID into payload ───────────────
    /// The cross-terminal-noise fix lives in two halves: pty_manager injects
    /// `AGENT_TERMINAL_TAB_ID` into every spawned shell, and this script
    /// forwards it as a `tab_id` field in the POST body. If either half
    /// regresses, hooks from sessions outside agent-terminal start firing
    /// notifications again.
    #[tokio::test]
    async fn s4_script_forwards_tab_id_env_var() {
        let dir = temp_dir("s4");
        let script = dir.join("claude-hook");

        write_hook_script_to(claude_config(), &script).await.unwrap();
        let content = fs::read_to_string(&script).unwrap();

        // The env var name must appear in the script — without it, no
        // correlation signal reaches the server.
        assert!(
            content.contains("$AGENT_TERMINAL_TAB_ID"),
            "script must reference $AGENT_TERMINAL_TAB_ID"
        );
        // The `tab_id` JSON key must also appear — proves we're emitting it
        // into the payload, not just reading the env for some other purpose.
        assert!(
            content.contains("\\\"tab_id\\\":"),
            "script must emit a tab_id JSON field"
        );
    }

    // ── Registry: native list derives from the registry ──────────────────────
    #[test]
    fn native_configs_derive_from_registry() {
        // Only NativeConfig agents appear, in registry order: Claude then Codex.
        assert_eq!(AGENT_HOOK_CONFIGS.len(), 2);
        assert_eq!(claude_config().agent_id, "claude-code");
        assert_eq!(codex_config().agent_id, "codex");
        // opencode is plugin-based and must not appear in the native list.
        assert!(config_for_agent_id("opencode").is_none());
        // Event names round-trip from the registry.
        assert!(claude_config().events.iter().any(|e| e.event_name == "Stop"));
        assert!(codex_config().events.iter().any(|e| e.event_name == "PermissionRequest"));
    }

    // ── P1: plugin installed when the agent's config dir exists ──────────────
    #[tokio::test]
    async fn p1_plugin_installed_when_config_dir_present() {
        let dir = temp_dir("p1"); // stands in for the opencode config dir
        let plugin_dir = dir.join("plugin");
        let asset = "export const Plugin = async () => ({})\n";

        install_plugin_asset(&plugin_dir, "agent-terminal-state.js", asset)
            .await
            .unwrap();

        let installed = fs::read_to_string(plugin_dir.join("agent-terminal-state.js")).unwrap();
        assert_eq!(installed, asset);
    }

    // ── P2: plugin skipped when the agent's config dir is absent ─────────────
    #[tokio::test]
    async fn p2_plugin_skipped_when_config_dir_absent() {
        let dir = temp_dir("p2");
        // Parent (the agent's config dir) does not exist → must be a no-op.
        let plugin_dir = dir.join("no-such-agent").join("plugin");

        install_plugin_asset(&plugin_dir, "agent-terminal-state.js", "x")
            .await
            .unwrap();

        assert!(!plugin_dir.exists(), "must not create config tree for an absent agent");
    }

    // ── P3: plugin install is idempotent ─────────────────────────────────────
    #[tokio::test]
    async fn p3_plugin_install_idempotent() {
        let dir = temp_dir("p3");
        let plugin_dir = dir.join("plugin");
        let asset = "console.log('agent-terminal')\n";

        install_plugin_asset(&plugin_dir, "agent-terminal-state.js", asset)
            .await
            .unwrap();
        let path = plugin_dir.join("agent-terminal-state.js");
        let mtime_before = fs::metadata(&path).unwrap().modified().unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        install_plugin_asset(&plugin_dir, "agent-terminal-state.js", asset)
            .await
            .unwrap();
        let mtime_after = fs::metadata(&path).unwrap().modified().unwrap();

        assert_eq!(mtime_before, mtime_after, "unchanged asset must not be rewritten");
    }

    // ── Action hook script ───────────────────────────────────────────────────
    #[test]
    fn action_hook_script_is_well_formed() {
        let s = build_action_hook_script("kimi");
        assert!(s.contains("\\\"agent\\\":\\\"kimi\\\""), "must bake the agent id");
        assert!(s.contains("$AGENT_TERMINAL_TAB_ID"), "must read the tab env var");
        assert!(s.contains(&format!("127.0.0.1:{}", crate::identity::HOOK_PORT)));
        // Tab suffix carries its own leading comma, so there is no trailing comma.
        assert!(s.contains(",\\\"tab_id\\\":\\\"$AGENT_TERMINAL_TAB_ID\\\""));
    }

    // ── Kimi: TOML managed block ─────────────────────────────────────────────
    fn kimi_events() -> &'static [(&'static str, &'static str)] {
        &[("SessionStart", "session"), ("UserPromptSubmit", "working"), ("Stop", "idle")]
    }

    #[tokio::test]
    async fn toml_block_installs_and_is_idempotent() {
        let home = temp_dir("toml1");
        fs::create_dir_all(home.join(".kimi-code")).unwrap(); // agent present
        let cfg = home.join(".kimi-code/config.toml");

        install_toml_block(&home, "kimi", "~/.kimi-code/config.toml", "~/.kimi-code/hooks", "agent-terminal-state", kimi_events())
            .await
            .unwrap();

        let content = fs::read_to_string(&cfg).unwrap();
        assert!(content.contains(TOML_BLOCK_BEGIN) && content.contains(TOML_BLOCK_END));
        assert!(content.contains("event = \"UserPromptSubmit\""));
        assert!(content.contains("working"));

        // Second run must not change the file.
        let before = content;
        install_toml_block(&home, "kimi", "~/.kimi-code/config.toml", "~/.kimi-code/hooks", "agent-terminal-state", kimi_events())
            .await
            .unwrap();
        assert_eq!(fs::read_to_string(&cfg).unwrap(), before, "idempotent");
    }

    #[tokio::test]
    async fn toml_block_preserves_surrounding_config() {
        let home = temp_dir("toml2");
        fs::create_dir_all(home.join(".kimi-code")).unwrap();
        let cfg = home.join(".kimi-code/config.toml");
        fs::write(&cfg, "model = \"kimi-k2\"\n").unwrap();

        install_toml_block(&home, "kimi", "~/.kimi-code/config.toml", "~/.kimi-code/hooks", "agent-terminal-state", kimi_events())
            .await
            .unwrap();

        let content = fs::read_to_string(&cfg).unwrap();
        assert!(content.contains("model = \"kimi-k2\""), "existing config preserved");
        assert!(content.contains(TOML_BLOCK_BEGIN));
    }

    #[tokio::test]
    async fn toml_block_skipped_when_agent_absent() {
        let home = temp_dir("toml3"); // no ~/.kimi-code
        install_toml_block(&home, "kimi", "~/.kimi-code/config.toml", "~/.kimi-code/hooks", "agent-terminal-state", kimi_events())
            .await
            .unwrap();
        assert!(!home.join(".kimi-code/config.toml").exists(), "must not create the agent tree");
    }

    // ── Mastra: flat JSON ────────────────────────────────────────────────────
    fn mastra_events() -> &'static [(&'static str, &'static str)] {
        &[("SessionStart", "idle"), ("UserPromptSubmit", "working"), ("PermissionRequest", "blocked")]
    }

    #[tokio::test]
    async fn flat_json_installs_and_preserves_existing() {
        let home = temp_dir("flat1");
        fs::create_dir_all(home.join(".mastracode")).unwrap();
        let cfg = home.join(".mastracode/hooks.json");
        fs::write(&cfg, r#"{"CustomEvent":[{"type":"command","command":"other"}]}"#).unwrap();

        install_flat_json(&home, "mastracode", "~/.mastracode/hooks.json", "~/.mastracode/hooks", "agent-terminal-state", mastra_events())
            .await
            .unwrap();

        let v: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        // Existing untouched.
        assert_eq!(v["CustomEvent"][0]["command"].as_str(), Some("other"));
        // Ours added as flat command entries.
        let arr = v["UserPromptSubmit"].as_array().unwrap();
        assert!(arr.iter().any(|e| e["type"] == "command"
            && e["command"].as_str().unwrap().ends_with(" working")));
        assert!(v["PermissionRequest"][0]["command"].as_str().unwrap().ends_with(" blocked"));
    }

    #[tokio::test]
    async fn flat_json_is_idempotent() {
        let home = temp_dir("flat2");
        fs::create_dir_all(home.join(".mastracode")).unwrap();
        let cfg = home.join(".mastracode/hooks.json");

        install_flat_json(&home, "mastracode", "~/.mastracode/hooks.json", "~/.mastracode/hooks", "agent-terminal-state", mastra_events())
            .await
            .unwrap();
        let before = fs::read_to_string(&cfg).unwrap();
        install_flat_json(&home, "mastracode", "~/.mastracode/hooks.json", "~/.mastracode/hooks", "agent-terminal-state", mastra_events())
            .await
            .unwrap();
        assert_eq!(fs::read_to_string(&cfg).unwrap(), before, "idempotent");
    }
}
