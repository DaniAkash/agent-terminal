//! Read-only, bounded access to the enabled provider's own credential source.
//! Secrets and fingerprints never enter the renderer snapshot or error text.
use super::types::{now, CollectionError, UsageStatus};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct Credential {
    pub token: String,
    pub account: Option<String>,
    pub source: String,
    pub headers: Vec<(String, String)>,
}

impl Credential {
    pub fn fingerprint(&self) -> String {
        // Token-scoped retention deliberately fails closed on token rotation.
        format!(
            "{:x}",
            Sha256::digest(format!(
                "{}\0{}",
                self.token,
                self.account.as_deref().unwrap_or_default()
            ))
        )
    }
}

pub fn home() -> Result<PathBuf, CollectionError> {
    dirs::home_dir().ok_or_else(|| missing("The home folder is unavailable."))
}

pub fn provider_home(variable: &str, fallback: &str) -> Result<PathBuf, CollectionError> {
    match std::env::var_os(variable) {
        Some(value) if !value.is_empty() => {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err(missing(
                    "The provider home override must be an absolute path.",
                ));
            }
            Ok(path)
        }
        _ => Ok(home()?.join(fallback)),
    }
}

pub fn data_home() -> Result<PathBuf, CollectionError> {
    provider_home("XDG_DATA_HOME", ".local/share")
}

pub fn read_json(path: &Path) -> Result<Value, CollectionError> {
    let bytes = read_bounded(path, 1024 * 1024)?;
    serde_json::from_slice(&bytes).map_err(|_| {
        missing(
            "The provider credential file is invalid. Open the provider CLI, sign in, and refresh.",
        )
    })
}

fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, CollectionError> {
    if !std::fs::metadata(path)
        .map(|m| m.is_file())
        .unwrap_or(false)
    {
        return Err(missing(
            "No regular local credential file was found. Sign in with the provider CLI.",
        ));
    }
    let file = std::fs::File::open(path).map_err(|_| {
        missing("No readable local session was found. Sign in with the provider CLI, then refresh.")
    })?;
    if !file.metadata().map(|m| m.is_file()).unwrap_or(false) {
        return Err(missing(
            "The provider credential source is not a regular file.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| missing("The provider credential file could not be read."))?;
    if bytes.len() > limit {
        return Err(missing("The provider credential file is too large."));
    }
    Ok(bytes)
}

pub fn missing(message: &str) -> CollectionError {
    CollectionError::new(UsageStatus::NotConfigured, message)
}

fn token(value: &Value, pointer: &str) -> Result<String, CollectionError> {
    value.pointer(pointer).and_then(Value::as_str).map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 32_768).map(String::from)
        .ok_or_else(|| missing("This local session does not contain a supported usage credential. Sign in with the provider CLI."))
}

fn env_token(variable: &str, source: &str) -> Option<Credential> {
    std::env::var(variable)
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty() && s.len() <= 32_768)
        .map(|token| Credential {
            token,
            account: None,
            source: source.into(),
            headers: vec![],
        })
}

pub fn resolve(id: &str) -> Result<Credential, CollectionError> {
    match id {
        "codex" => {
            let json = read_json(&provider_home("CODEX_HOME", ".codex")?.join("auth.json"))?;
            Ok(Credential {
                token: token(&json, "/tokens/access_token")?,
                account: json
                    .pointer("/tokens/account_id")
                    .and_then(Value::as_str)
                    .map(String::from),
                source: "Codex local OAuth session".into(),
                headers: vec![],
            })
        }
        "claude-code" => claude(),
        "opencode" => opencode_candidates()?
            .into_iter()
            .next()
            .ok_or_else(|| missing("Connect OpenCode Go in OpenCode, then refresh.")),
        "kilo" => {
            if let Some(c) = env_token("KILO_API_KEY", "Kilo API key from environment") {
                return Ok(c);
            }
            let json = read_json(&data_home()?.join("kilo/auth.json"))?;
            Ok(Credential {
                token: token(&json, "/kilo/access")?,
                account: None,
                source: "Kilo local OAuth session".into(),
                headers: vec![],
            })
        }
        "kimi" => kimi(),
        _ => Err(missing(
            "This provider does not expose a local usage credential.",
        )),
    }
}

/// Only OpenCode-owned keys can reach its usage host. Never forward other
/// providers' OAuth sessions or API keys from this shared credential file.
pub fn opencode_candidates() -> Result<Vec<Credential>, CollectionError> {
    let mut candidates = Vec::new();
    if let Some(c) = env_token("OPENCODE_API_KEY", "OpenCode API key from environment") {
        candidates.push(c);
    }
    match data_home().and_then(|root| read_json(&root.join("opencode/auth.json"))) {
        Ok(json) => {
            candidates.extend(opencode_keys(&json));
            if candidates.is_empty()
                && (json.get("opencode-go").is_some()
                    || json.get("opencode").is_some()
                    || json.as_object().map_or(true, |entries| entries.is_empty()))
            {
                return Err(missing("No valid OpenCode API key was found. Use /connect in OpenCode to add a Go or Zen key, then refresh."));
            }
        }
        Err(error) if candidates.is_empty() => return Err(error),
        Err(_) => {}
    }
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(c.fingerprint()));
    if candidates.is_empty() {
        return Err(CollectionError::new(UsageStatus::Unsupported,
            "OpenCode is connected to another model provider. Connect OpenCode Go with its API key to read Go quotas; other providers have their own usage limits."));
    }
    Ok(candidates)
}

pub(super) fn opencode_keys(json: &Value) -> Vec<Credential> {
    ["opencode-go", "opencode"]
        .into_iter()
        .filter_map(|id| {
            let entry = json.get(id)?;
            if entry.get("type").and_then(Value::as_str) != Some("api") {
                return None;
            }
            let key = token(entry, "/key").ok()?;
            Some(Credential {
                token: key,
                account: None,
                source: if id == "opencode-go" {
                    "OpenCode Go local API key"
                } else {
                    "OpenCode Zen local API key"
                }
                .into(),
                headers: vec![],
            })
        })
        .collect()
}

fn claude() -> Result<Credential, CollectionError> {
    let root = provider_home("CLAUDE_CONFIG_DIR", ".claude")?;
    let path = root.join(".credentials.json");
    let (json, source) = if path.exists() {
        (read_json(&path)?, "Claude Code local OAuth session")
    } else {
        #[cfg(target_os = "macos")]
        {
            if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
                return Err(missing("No credentials in the selected Claude profile."));
            }
            (claude_keychain(false)?, "Claude Code Keychain session")
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(missing(
                "No Claude Code session found. Run claude and sign in, then refresh.",
            ));
        }
    };
    if let Some(expiry) = json
        .pointer("/claudeAiOauth/expiresAt")
        .and_then(Value::as_f64)
    {
        if expiry / 1000.0 <= now() as f64 + 60.0 {
            return Err(missing(
                "Claude Code's session has expired. Open claude to renew it, then refresh.",
            ));
        }
    }
    Ok(Credential {
        token: token(&json, "/claudeAiOauth/accessToken")?,
        account: None,
        source: source.into(),
        headers: vec![],
    })
}

#[cfg(target_os = "macos")]
fn claude_keychain(allow_prompt: bool) -> Result<Value, CollectionError> {
    use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
    let results = ItemSearchOptions::new().class(ItemClass::generic_password())
        .service("Claude Code-credentials").load_data(true).skip_authenticated_items(!allow_prompt)
        .search().map_err(|_| missing("Claude Code's Keychain session is unavailable to Jarvis. Use a readable Claude profile credential file or authorize Keychain access for Agent Terminal."))?;
    match results.into_iter().next() {
        Some(SearchResult::Data(bytes)) if bytes.len() <= 1024 * 1024 => {
            serde_json::from_slice(&bytes).map_err(|_| {
                missing("Claude Code's Keychain session is not a supported OAuth credential.")
            })
        }
        _ => Err(missing(
            "No readable Claude Code OAuth session in Keychain.",
        )),
    }
}

/// Only called by the explicit authorization action, never by collection.
pub fn authorize_claude_keychain() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
            return Err("The selected Claude profile uses its own credential file. Sign in with that profile and refresh.".into());
        }
        let json = claude_keychain(true).map_err(|error| error.message)?;
        token(&json, "/claudeAiOauth/accessToken").map_err(|error| error.message)?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Claude Keychain authorization is available on macOS.".into())
    }
}

fn kimi() -> Result<Credential, CollectionError> {
    if let Some(c) = env_token("KIMI_CODE_API_KEY", "Kimi Code API key from environment") {
        return Ok(c);
    }
    if [
        "KIMI_CODE_BASE_URL",
        "KIMI_CODE_OAUTH_HOST",
        "KIMI_OAUTH_HOST",
    ]
    .iter()
    .any(|k| std::env::var_os(k).is_some())
    {
        return Err(missing(
            "Kimi CLI endpoint overrides cannot be used with the default usage source.",
        ));
    }
    let root = provider_home("KIMI_CODE_HOME", ".kimi-code")?;
    let json = read_json(&root.join("credentials/kimi-code.json"))?;
    let expiry = json
        .get("expires_at")
        .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()));
    if !expiry.is_some_and(|e| e.is_finite() && e > now() as f64 + 60.0) {
        return Err(missing(
            "Kimi Code's session has expired. Open kimi to renew it, then refresh.",
        ));
    }
    let device = read_bounded(&root.join("device_id"), 4096)?;
    let device = String::from_utf8(device)
        .map_err(|_| missing("Kimi's device identity is invalid. Open kimi to initialize it."))?;
    let ascii = |s: String| {
        s.chars()
            .filter(|c| c.is_ascii() && !c.is_control())
            .take(128)
            .collect::<String>()
    };
    Ok(Credential {
        token: token(&json, "/access_token")?,
        account: None,
        source: "Kimi Code local OAuth session".into(),
        headers: vec![
            ("X-Msh-Device-Id".into(), ascii(device.trim().into())),
            (
                "X-Msh-Device-Name".into(),
                ascii(hostname::get().unwrap_or_default().to_string_lossy().into()),
            ),
            (
                "X-Msh-Device-Model".into(),
                format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            ),
            (
                "X-Msh-Os-Version".into(),
                ascii(sysinfo::System::os_version().unwrap_or_else(|| "unknown".into())),
            ),
            ("X-Msh-Platform".into(), "kimi_code_cli".into()),
            ("X-Msh-Version".into(), env!("CARGO_PKG_VERSION").into()),
        ],
    })
}
