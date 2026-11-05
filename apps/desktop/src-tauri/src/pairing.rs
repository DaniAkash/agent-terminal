// QR-driven pairing flow + per-device long-lived tokens.
//
// Wire model:
//   * Desktop opens a `PairingWindow` (one at a time). Mints a one-shot
//     pairing token with a 5-minute TTL and hands it to the pairing UI
//     which encodes it in the QR alongside the WSS URL + fingerprint.
//   * Mobile scans the QR, connects to the WSS server, and auths with
//     `Auth { token: "PAIRING:<pairing_token>" }`. The `PAIRING:` prefix
//     is what disambiguates a one-shot pairing exchange from a normal
//     device-token auth.
//   * Server dispatches to `PairingWindow::consume`. On success it mints
//     a new device_token (UUID), stores its SHA-256 in `PairedTokens`
//     alongside the device metadata the mobile sent, and returns the
//     raw token to mobile in `PairingComplete`. Mobile stashes it in
//     expo-secure-store and reconnects with `Auth { token: <device_token> }`.
//   * Desktop closes the pairing window (one-shot).
//
// Storage model:
//   * Only SHA-256 of the token ever lands on desktop disk. The token
//     itself is never persisted server-side, so leaking the JSON blob
//     from Keychain does not grant access.
//   * Whole map serialised as one JSON blob under a single Keychain
//     entry. Enumeration + revocation stay in-process; Keychain is
//     just persistent storage.

use anyhow::{Context, Result};
use constant_time_eq::constant_time_eq;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Pairing tokens expire after five minutes. Long enough for the user
/// to open the desktop dialog, unlock their phone, and scan; short
/// enough that a leaked screenshot is not a permanent credential.
pub const PAIRING_TTL: Duration = Duration::from_secs(300);

/// Prefix that disambiguates a one-shot pairing auth from a normal
/// device-token auth. Both take the same `Auth { token }` frame shape
/// on the wire so we don't have to grow the protocol just for pairing.
pub const PAIRING_PREFIX: &str = "PAIRING:";

const KEYRING_SERVICE_PROD: &str = "agent-terminal";
const KEYRING_SERVICE_DEV: &str = "agent-terminal-dev";
const KEYRING_ACCOUNT_PAIRED_DEVICES: &str = "paired-devices-v1";

/// One paired device's metadata + hashed token. Never contains the raw
/// token; the hash is what we compare on auth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    /// UUID minted server-side at pairing. Stable identifier for
    /// Revoke + per-connection tracking; survives token rotation
    /// (future feature) because it's independent of the token itself.
    pub id: String,
    /// SHA-256 hex of the long-lived device token. The raw token
    /// exists only on the mobile side.
    pub token_hash: String,
    /// User-editable name. Defaults to the mobile-side `Constants.deviceName`
    /// captured at pairing (typically the OS device name).
    pub device_name: String,
    /// "ios" or "android".
    pub platform: String,
    /// Marketing model string, e.g. "iPhone 15 Pro". Android values
    /// vary more, so this stays optional.
    pub model: Option<String>,
    /// Unix epoch seconds.
    pub paired_at: i64,
    /// Unix epoch seconds. Touched on every successful auth so the
    /// Devices UI can render "Last seen 2 minutes ago".
    pub last_seen: i64,
    /// Source address of the most recent successful auth. Cosmetic;
    /// useful when the same device connects from multiple LANs.
    pub last_ip: Option<String>,

    // ── Push registration ────────────────────────────────────────────
    //
    // Written only by the device itself, over `ClientFrame::RegisterPush`
    // on an already-authenticated connection. The desktop has no UI for
    // any of this: the phone is the only owner, because it is the thing
    // that buzzes.
    //
    // Every field is `serde(default)` so a Keychain blob written before
    // push existed still deserialises.
    /// Expo push token. A send capability for this device, so it lives
    /// beside the token hash and is never logged beyond a prefix.
    /// `None` is also how "the user switched push off" is represented:
    /// token presence IS the enabled flag, which removes the state where
    /// a token exists but must not be used.
    #[serde(default)]
    pub push_token: Option<String>,
    /// "ios" or "android". Chooses channel vs interruption level.
    #[serde(default)]
    pub push_platform: Option<String>,
    #[serde(default)]
    pub push_registered_at: Option<i64>,
    /// Grace window this device wants, in seconds.
    #[serde(default = "default_push_delay")]
    pub push_delay_seconds: u32,
    #[serde(default)]
    pub push_redact_names: bool,
    /// Last transport failure. Echoed to the phone on `PushStatus`
    /// rather than shown on the desktop, which has no screen for it.
    #[serde(default)]
    pub push_last_error: Option<String>,
}

fn default_push_delay() -> u32 {
    crate::push::DEFAULT_DELAY_SECONDS
}

/// Mobile-supplied metadata at pairing time. Everything user-facing
/// (name, platform, model) originates here; the desktop just persists.
#[derive(Debug, Clone, Deserialize)]
pub struct DeviceInfo {
    pub device_name: String,
    pub platform: String,
    pub model: Option<String>,
}

/// Persistent per-device token store. All mutations flush the whole
/// map to a single Keychain entry so reload is one `get_password` +
/// one `serde_json::from_str`.
///
/// The `entry` slot is `Option` so the ephemeral test-only constructor
/// can drive the in-memory logic without a working Keychain
/// (headless CI on Linux, sandboxed test runners on macOS). Persist
/// is a no-op when `entry` is `None`.
pub struct PairedTokens {
    inner: Mutex<HashMap<String, PairedDevice>>,
    entry: Option<Entry>,
}

impl PairedTokens {
    /// Load-or-init from Keychain. `dev` picks the dev-namespaced
    /// service so a dev build's paired devices do not collide with a
    /// prod build's on the same machine.
    ///
    /// On a JSON parse failure the malformed entry is deleted from
    /// the Keychain and the loader returns an empty-map store
    /// (still Keychain-backed for persistence). This self-heals the
    /// "prior process crashed mid-write and left a truncated blob"
    /// case, which otherwise degraded to an ephemeral in-memory
    /// store and silently lost pairings on the next restart.
    pub fn load(dev: bool) -> Result<Self> {
        let service = if dev {
            KEYRING_SERVICE_DEV
        } else {
            KEYRING_SERVICE_PROD
        };
        let entry = Entry::new(service, KEYRING_ACCOUNT_PAIRED_DEVICES)
            .with_context(|| format!("keyring Entry::new({service}, ...)"))?;
        let inner = match entry.get_password() {
            Ok(json) if json.is_empty() => HashMap::new(),
            Ok(json) => match serde_json::from_str(&json) {
                Ok(map) => map,
                Err(e) => {
                    eprintln!(
                        "[pairing] keychain blob failed to parse ({e}); \
                         deleting and starting fresh (previous pairings \
                         will need to reconnect)"
                    );
                    let _ = entry.delete_credential();
                    HashMap::new()
                }
            },
            Err(keyring::Error::NoEntry) => HashMap::new(),
            Err(e) => return Err(e).context("keyring get_password"),
        };
        Ok(Self {
            inner: Mutex::new(inner),
            entry: Some(entry),
        })
    }

    /// Test-only constructor that skips Keychain entirely. Every
    /// persist call is a no-op; the in-memory `HashMap` still holds
    /// every insert / revoke so the logic under test is exercised.
    /// Real Keychain persistence is covered by the manual smoke path
    /// (pair a phone, restart the desktop, confirm the phone still
    /// authenticates).
    #[doc(hidden)]
    pub fn new_ephemeral() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            entry: None,
        }
    }

    /// Constant-time check: does `token` match any stored device? Returns
    /// the matching `PairedDevice` (cloned) on success. `None` on
    /// mismatch. Also touches `last_seen` and `last_ip` on match.
    ///
    /// The loop runs to completion regardless of match position so
    /// total runtime is independent of which device_id happens to
    /// match. Each comparison is byte-level constant-time via
    /// `constant_time_eq`; the outer iteration would otherwise leak
    /// insertion order via timing.
    pub fn check_and_touch(&self, token: &str, source_ip: Option<String>) -> Option<PairedDevice> {
        let candidate_hash = sha256_hex(token);
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        let mut hit: Option<String> = None;
        for (id, device) in map.iter() {
            let is_match =
                constant_time_eq(device.token_hash.as_bytes(), candidate_hash.as_bytes());
            // Assign only on first match; a token hash appears at
            // most once in the map so subsequent iterations are pure
            // timing-padding. Keep the shape symmetric across match
            // and non-match branches so the compiler is less likely
            // to introduce a branch we did not write.
            if is_match && hit.is_none() {
                hit = Some(id.clone());
            }
        }
        let id = hit?;
        // Touch the record. Persistence failure is logged, not fatal:
        // the auth is legitimate even if we can't write the timestamp.
        if let Some(dev) = map.get_mut(&id) {
            dev.last_seen = now_unix();
            dev.last_ip = source_ip;
        }
        let device = map.get(&id).cloned();
        let map_snapshot = map.clone();
        drop(map);
        if let Err(e) = self.persist(&map_snapshot) {
            eprintln!("[pairing] last_seen persist failed: {e}");
        }
        device
    }

    /// Insert a freshly-paired device. Returns the minted `(id, raw_token)`
    /// so the caller can send the raw token back to the mobile client.
    pub fn insert(&self, info: DeviceInfo) -> Result<(String, String)> {
        let id = Uuid::new_v4().to_string();
        let raw_token = Uuid::new_v4().to_string();
        let token_hash = sha256_hex(&raw_token);
        let paired_at = now_unix();
        let device = PairedDevice {
            id: id.clone(),
            token_hash,
            device_name: info.device_name,
            platform: info.platform,
            model: info.model,
            paired_at,
            last_seen: paired_at,
            last_ip: None,
            push_token: None,
            push_platform: None,
            push_registered_at: None,
            push_delay_seconds: default_push_delay(),
            push_redact_names: false,
            push_last_error: None,
        };
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        map.insert(id.clone(), device);
        self.persist(&map)?;
        Ok((id, raw_token))
    }

    /// Drop a device by id. Returns `Ok(true)` if a device was
    /// actually removed, `Ok(false)` if the id was unknown.
    pub fn revoke(&self, id: &str) -> Result<bool> {
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        let removed = map.remove(id).is_some();
        if removed {
            self.persist(&map)?;
        }
        Ok(removed)
    }

    /// Snapshot every paired device, cheapest way to feed the UI.
    pub fn list(&self) -> Vec<PairedDevice> {
        let map = self.inner.lock().expect("paired_tokens lock poisoned");
        map.values().cloned().collect()
    }

    /// One device by id.
    pub fn get(&self, id: &str) -> Option<PairedDevice> {
        let map = self.inner.lock().expect("paired_tokens lock poisoned");
        map.get(id).cloned()
    }

    /// Only the devices that currently hold a push token, which is the
    /// same thing as the devices that want push.
    pub fn with_push_tokens(&self) -> Vec<PairedDevice> {
        let map = self.inner.lock().expect("paired_tokens lock poisoned");
        map.values()
            .filter(|d| d.push_token.is_some())
            .cloned()
            .collect()
    }

    /// One idempotent upsert for the token and the preferences together,
    /// because `RegisterPush` carries both: the phone re-sends it on
    /// every connect and on every preference change.
    pub fn set_push_registration(
        &self,
        id: &str,
        token: &str,
        platform: &str,
        delay_seconds: u32,
        redact_names: bool,
    ) -> Result<bool> {
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        let Some(device) = map.get_mut(id) else {
            return Ok(false);
        };
        device.push_token = Some(token.to_string());
        device.push_platform = Some(platform.to_string());
        device.push_registered_at = Some(now_unix());
        device.push_delay_seconds = crate::push::clamp_delay(delay_seconds);
        device.push_redact_names = redact_names;
        device.push_last_error = None;
        let snapshot = map.clone();
        drop(map);
        self.persist(&snapshot)?;
        Ok(true)
    }

    /// The off switch. Called when the user disables push on the phone,
    /// and when Expo reports `DeviceNotRegistered`.
    pub fn clear_push_token(&self, id: &str) -> Result<bool> {
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        let Some(device) = map.get_mut(id) else {
            return Ok(false);
        };
        if device.push_token.is_none() {
            return Ok(false);
        }
        device.push_token = None;
        device.push_registered_at = None;
        let snapshot = map.clone();
        drop(map);
        self.persist(&snapshot)?;
        Ok(true)
    }

    pub fn set_push_error(&self, id: &str, err: Option<String>) -> Result<()> {
        let mut map = self.inner.lock().expect("paired_tokens lock poisoned");
        let Some(device) = map.get_mut(id) else {
            return Ok(());
        };
        if device.push_last_error == err {
            return Ok(());
        }
        device.push_last_error = err;
        let snapshot = map.clone();
        drop(map);
        self.persist(&snapshot)
    }

    fn persist(&self, map: &HashMap<String, PairedDevice>) -> Result<()> {
        let Some(entry) = self.entry.as_ref() else {
            return Ok(());
        };
        let json = serde_json::to_string(map).context("serialise paired_tokens")?;
        // Bubble up the actual keyring error text (PlatformFailure,
        // Ambiguous, Invalid, TooLong, ...) rather than the flat
        // "keyring set_password" label `context` would attach — the
        // WSS pairing error surface displays this verbatim to the
        // user, so specificity matters.
        entry
            .set_password(&json)
            .map_err(|e| anyhow::anyhow!("keyring set_password failed: {e:?}"))?;
        Ok(())
    }
}

/// One-at-a-time pairing session. `open` mints a pairing token; the
/// UI displays it in the QR. `consume` validates a presented token
/// and clears the session (one-shot). `close` clears without validating
/// (dialog closed, TTL expired, revoke).
pub struct PairingWindow {
    inner: Mutex<Option<PairingSession>>,
}

struct PairingSession {
    pairing_token: String,
    expires_at: Instant,
}

impl PairingWindow {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Open a fresh pairing window, evicting any prior one. Returns
    /// the pairing token the caller embeds in the QR.
    pub fn open(&self) -> String {
        let pairing_token = Uuid::new_v4().to_string();
        let session = PairingSession {
            pairing_token: pairing_token.clone(),
            expires_at: Instant::now() + PAIRING_TTL,
        };
        *self.inner.lock().expect("pairing_window lock poisoned") = Some(session);
        pairing_token
    }

    /// Close without validating. Idempotent.
    pub fn close(&self) {
        *self.inner.lock().expect("pairing_window lock poisoned") = None;
    }

    /// Snapshot the currently-open token, if any (and if not expired).
    /// Used by the UI to display the same token that's live server-side.
    pub fn current_token(&self) -> Option<String> {
        let slot = self.inner.lock().expect("pairing_window lock poisoned");
        let session = slot.as_ref()?;
        if session.expires_at < Instant::now() {
            return None;
        }
        Some(session.pairing_token.clone())
    }

    /// Consume the token, one-shot. Returns Ok on match; err on
    /// wrong token, expired token, or no open window.
    pub fn consume(&self, presented: &str) -> Result<(), PairingError> {
        let mut slot = self.inner.lock().expect("pairing_window lock poisoned");
        let session = slot.as_ref().ok_or(PairingError::NoOpenWindow)?;
        if session.expires_at < Instant::now() {
            *slot = None;
            return Err(PairingError::Expired);
        }
        if !constant_time_eq(session.pairing_token.as_bytes(), presented.as_bytes()) {
            return Err(PairingError::Mismatch);
        }
        *slot = None;
        Ok(())
    }

    /// Validate the token without burning it. Same semantics as
    /// `consume` except the window stays open on success. Used by
    /// `pairing_flow` to check the token up-front then defer the
    /// burn until AFTER `paired_tokens.insert` succeeds, so a
    /// transient keychain failure does not consume the pair token
    /// and force the user to reopen the desktop dialog for a fresh
    /// QR.
    pub fn validate(&self, presented: &str) -> Result<(), PairingError> {
        let mut slot = self.inner.lock().expect("pairing_window lock poisoned");
        let session = slot.as_ref().ok_or(PairingError::NoOpenWindow)?;
        if session.expires_at < Instant::now() {
            *slot = None;
            return Err(PairingError::Expired);
        }
        if !constant_time_eq(session.pairing_token.as_bytes(), presented.as_bytes()) {
            return Err(PairingError::Mismatch);
        }
        Ok(())
    }
}

impl Default for PairingWindow {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PairingError {
    #[error("no pairing window open")]
    NoOpenWindow,
    #[error("pairing token expired")]
    Expired,
    #[error("pairing token mismatch")]
    Mismatch,
}

/// SHA-256 hex of the input. Lowercase; the Keychain blob is
/// programmatic and never displayed to users.
fn sha256_hex(input: &str) -> String {
    let hash = Sha256::digest(input.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(name: &str, platform: &str) -> DeviceInfo {
        DeviceInfo {
            device_name: name.to_string(),
            platform: platform.to_string(),
            model: Some("iPhone 15 Pro".to_string()),
        }
    }

    #[test]
    fn insert_returns_id_and_raw_token_never_stored_directly() {
        let store = PairedTokens::new_ephemeral();
        let (id, raw_token) = store.insert(info("Dani's iPhone", "ios")).unwrap();
        assert!(!id.is_empty());
        assert!(!raw_token.is_empty());
        assert_ne!(id, raw_token, "id and token must be distinct UUIDs");
        assert_eq!(store.list().len(), 1);
        let device = store
            .check_and_touch(&raw_token, Some("192.168.1.5".into()))
            .expect("raw token must match");
        assert_eq!(device.device_name, "Dani's iPhone");
        assert_eq!(device.platform, "ios");
        assert_eq!(device.token_hash, sha256_hex(&raw_token));
        assert_eq!(device.last_ip.as_deref(), Some("192.168.1.5"));
    }

    #[test]
    fn check_rejects_unknown_token() {
        let store = PairedTokens::new_ephemeral();
        assert!(store.check_and_touch("not-a-real-token", None).is_none());
    }

    #[test]
    fn revoke_removes_the_specific_device() {
        let store = PairedTokens::new_ephemeral();
        let (id_a, token_a) = store.insert(info("A", "ios")).unwrap();
        let (_id_b, token_b) = store.insert(info("B", "android")).unwrap();
        assert_eq!(store.list().len(), 2);
        assert!(store.revoke(&id_a).unwrap());
        assert_eq!(store.list().len(), 1);
        assert!(store.check_and_touch(&token_a, None).is_none());
        assert!(store.check_and_touch(&token_b, None).is_some());
        // Revoking again is a no-op.
        assert!(!store.revoke(&id_a).unwrap());
    }

    #[test]
    fn pairing_window_open_close_cycle() {
        let win = PairingWindow::new();
        assert!(win.current_token().is_none());
        let token = win.open();
        assert_eq!(win.current_token().as_deref(), Some(token.as_str()));
        // Wrong token rejected without closing the window.
        assert_eq!(
            win.consume("wrong").unwrap_err(),
            PairingError::Mismatch
        );
        assert_eq!(win.current_token().as_deref(), Some(token.as_str()));
        // Right token accepted, window closes.
        assert!(win.consume(&token).is_ok());
        assert!(win.current_token().is_none());
        // Second consume of the same token now fails: no open window.
        assert_eq!(
            win.consume(&token).unwrap_err(),
            PairingError::NoOpenWindow
        );
    }

    #[test]
    fn pairing_window_expires_after_ttl_on_next_consume() {
        let win = PairingWindow::new();
        let token = win.open();
        // Force-expire by rewriting the internal timestamp. In prod
        // we'd wait 5 minutes; here we cheat via direct mutation
        // through the same lock.
        {
            let mut slot = win.inner.lock().unwrap();
            if let Some(sess) = slot.as_mut() {
                sess.expires_at = Instant::now() - Duration::from_secs(1);
            }
        }
        assert!(win.current_token().is_none(), "expired token must not surface");
        assert_eq!(win.consume(&token).unwrap_err(), PairingError::Expired);
        assert!(win.current_token().is_none());
    }
}
