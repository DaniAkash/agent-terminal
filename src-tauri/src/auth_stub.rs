// Dev-only bearer-token auth for the WSS server.
//
// Reads a JSON config from `~/.config/agent-terminal/companion-dev.json` (or
// the dev-namespaced variant when built with feature = "dev-instance"). On
// first launch the file is written with a fresh random token so the user
// never has to hand-generate credentials. The token path is logged loudly
// at startup so the user can grep it and paste the token into the mobile
// client's connect screen.
//
// Phase 1 only. Phase 2 introduces the QR-code pairing flow and stores
// per-device tokens in the macOS Keychain; this module goes away.
//
// Not TLS. Not integrity-protected on disk. Every note in the log line
// says "dev only" for a reason.

use constant_time_eq::constant_time_eq;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Filename inside the config directory. Kept as a constant so the loud
/// startup log line and the test path can share it.
const CONFIG_FILENAME: &str = "companion-dev.json";

/// Default bind address for the WSS server: LAN-accessible so a phone on
/// the same Wi-Fi can reach it. Users can override via the config file if
/// this port collides with something else on their machine.
const DEFAULT_BIND_ADDR: &str = "0.0.0.0:47823";

/// Human-facing name reported to the client on successful auth. Users
/// override via the config file if they want their phone to identify the
/// desktop as something friendlier.
const DEFAULT_DEVICE_NAME: &str = "agent-terminal (dev)";

#[derive(Debug, Serialize, Deserialize)]
struct ConfigFile {
    token: String,
    device_name: String,
    bind_addr: String,
}

/// Loaded, ready-to-use auth state. Held as `Arc<AuthStub>` by the WSS
/// server; cheap to clone into per-connection tasks.
#[derive(Debug)]
pub struct AuthStub {
    token: String,
    pub device_name: String,
    pub bind_addr: SocketAddr,
}

impl AuthStub {
    /// Test-only direct constructor. Skips the config file so integration
    /// tests can pick a known token + ephemeral bind port. `#[doc(hidden)]`
    /// keeps it out of the rustdoc surface.
    #[doc(hidden)]
    pub fn new_for_tests(token: String, device_name: String, bind_addr: SocketAddr) -> Self {
        Self {
            token,
            device_name,
            bind_addr,
        }
    }

    /// Load the config from `<config_dir>/companion-dev.json`, generating
    /// the file with a fresh random token if it does not exist. Returns
    /// the parsed state plus a path suitable for logging.
    pub fn load_or_init(config_dir: &Path) -> io::Result<(Self, PathBuf)> {
        fs::create_dir_all(config_dir)?;
        let path = config_dir.join(CONFIG_FILENAME);

        if !path.exists() {
            let fresh = ConfigFile {
                token: Uuid::new_v4().to_string(),
                device_name: DEFAULT_DEVICE_NAME.to_string(),
                bind_addr: DEFAULT_BIND_ADDR.to_string(),
            };
            let body = serde_json::to_string_pretty(&fresh)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            fs::write(&path, body)?;
        }

        let raw = fs::read_to_string(&path)?;
        let parsed: ConfigFile = serde_json::from_str(&raw)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let bind_addr: SocketAddr = parsed.bind_addr.parse().map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("bind_addr '{}' is not a valid SocketAddr: {e}", parsed.bind_addr),
            )
        })?;

        Ok((
            Self {
                token: parsed.token,
                device_name: parsed.device_name,
                bind_addr,
            },
            path,
        ))
    }

    /// Constant-time comparison of `supplied` against the configured
    /// token. Timing attacks on a dev token are unrealistic, but the
    /// primitive is cheap and the WSS server calls it once per
    /// connection — no reason not to use it.
    pub fn check(&self, supplied: &str) -> bool {
        constant_time_eq(self.token.as_bytes(), supplied.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> tempfile::TempDir {
        tempfile::TempDir::new().expect("mkdtemp")
    }

    #[test]
    fn load_or_init_creates_config_when_missing() {
        let dir = tmp_dir();
        let (auth, path) = AuthStub::load_or_init(dir.path()).expect("init");
        assert!(path.exists(), "config file must be created");
        assert!(!auth.token.is_empty(), "token must be non-empty");
        assert_eq!(auth.device_name, DEFAULT_DEVICE_NAME);
        assert_eq!(
            auth.bind_addr.to_string(),
            DEFAULT_BIND_ADDR,
            "default bind is LAN-accessible dev port 47823"
        );
    }

    #[test]
    fn load_or_init_preserves_existing_config() {
        let dir = tmp_dir();
        // Write a config with a known token so we can verify round-trip.
        let path = dir.path().join(CONFIG_FILENAME);
        fs::write(
            &path,
            r#"{
                "token": "known-token-value",
                "device_name": "Alice's laptop",
                "bind_addr": "127.0.0.1:12345"
            }"#,
        )
        .unwrap();

        let (auth, _) = AuthStub::load_or_init(dir.path()).expect("load");
        assert_eq!(auth.device_name, "Alice's laptop");
        assert_eq!(auth.bind_addr.to_string(), "127.0.0.1:12345");
        assert!(auth.check("known-token-value"));
    }

    #[test]
    fn check_rejects_wrong_token() {
        let dir = tmp_dir();
        let (auth, _) = AuthStub::load_or_init(dir.path()).expect("init");
        assert!(!auth.check(""));
        assert!(!auth.check("obviously-wrong"));
        // Rejects a token of the same length as the real one (guards
        // against a length-only compare regression).
        let same_length_wrong = "0".repeat(auth.token.len());
        assert!(!auth.check(&same_length_wrong));
        // Positive path — pass the real token, expect true.
        let real = auth.token.clone();
        assert!(auth.check(&real));
    }

    #[test]
    fn generated_tokens_are_unique_across_inits() {
        let dir1 = tmp_dir();
        let dir2 = tmp_dir();
        let (a, _) = AuthStub::load_or_init(dir1.path()).expect("a");
        let (b, _) = AuthStub::load_or_init(dir2.path()).expect("b");
        assert_ne!(a.token, b.token, "each fresh init must roll a new token");
    }

    #[test]
    fn malformed_config_returns_error() {
        let dir = tmp_dir();
        let path = dir.path().join(CONFIG_FILENAME);
        fs::write(&path, "{ not json").unwrap();
        let err = AuthStub::load_or_init(dir.path()).expect_err("must fail");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn malformed_bind_addr_returns_error() {
        let dir = tmp_dir();
        let path = dir.path().join(CONFIG_FILENAME);
        fs::write(
            &path,
            r#"{"token":"x","device_name":"y","bind_addr":"nope"}"#,
        )
        .unwrap();
        let err = AuthStub::load_or_init(dir.path()).expect_err("must fail");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }
}
