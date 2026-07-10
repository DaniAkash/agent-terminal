// TLS material for the WSS server: self-signed cert + private key
// generated at first launch, persisted to disk, and reloaded on every
// subsequent launch. The SHA-256 fingerprint of the DER-encoded cert is
// what mobile clients pin (via the pairing QR in a later PR).
//
// Threat model coverage in Phase 2A:
//   * Passive LAN sniffing — TLS encrypts the wire, so a sniffer on the
//     same Wi-Fi cannot read the WebSocket traffic.
//   * Active MITM — a proxy could still present its own cert. Mobile in
//     Expo Go accepts any cert on the local subnet (NSAllowsLocalNetworking
//     on iOS, network security config on Android); user visually verifies
//     the fingerprint during pairing. The automated pin check ships when
//     the mobile dev client migration lands.

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use rcgen::{generate_simple_self_signed, CertifiedKey};
use rustls_pemfile::{certs, pkcs8_private_keys};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};

/// The cert + key material for the WSS server plus the fingerprint the
/// mobile client uses to pin against.
pub struct TlsMaterial {
    pub cert_pem: String,
    pub key_pem: String,
    /// Uppercase hex, colon-separated, of the SHA-256 hash of the cert's
    /// DER bytes. Matches the output of
    /// `openssl x509 -fingerprint -sha256 -in cert.pem` minus the
    /// `SHA256 Fingerprint=` prefix. This is the value embedded in the
    /// pairing QR so the mobile client can verify (visually in Phase 2A,
    /// programmatically in Phase 2B).
    pub sha256_fingerprint: String,
}

impl TlsMaterial {
    /// Load the cert + key from `dir/{cert.pem,key.pem}` if both exist;
    /// otherwise generate a fresh self-signed pair and write it. Called
    /// once at server startup.
    ///
    /// `subject_alt_names` should include every hostname / IP the WSS
    /// server will bind to. On a typical setup that's
    /// `["localhost", "127.0.0.1", "<lan_ip>"]`; the LAN IP is resolved
    /// by the caller since it depends on which interface the user's
    /// desktop happens to be on.
    pub fn load_or_generate(dir: &Path, subject_alt_names: Vec<String>) -> Result<Self> {
        fs::create_dir_all(dir).with_context(|| format!("mkdir {}", dir.display()))?;
        let cert_path = dir.join("cert.pem");
        let key_path = dir.join("key.pem");

        let (cert_pem, key_pem) = if cert_path.exists() && key_path.exists() {
            (
                fs::read_to_string(&cert_path)
                    .with_context(|| format!("read {}", cert_path.display()))?,
                fs::read_to_string(&key_path)
                    .with_context(|| format!("read {}", key_path.display()))?,
            )
        } else {
            let CertifiedKey { cert, signing_key } = generate_simple_self_signed(subject_alt_names)
                .context("rcgen generate_simple_self_signed")?;
            let cert_pem = cert.pem();
            let key_pem = signing_key.serialize_pem();
            fs::write(&cert_path, &cert_pem)
                .with_context(|| format!("write {}", cert_path.display()))?;
            fs::write(&key_path, &key_pem)
                .with_context(|| format!("write {}", key_path.display()))?;
            (cert_pem, key_pem)
        };

        let sha256_fingerprint = fingerprint_from_pem(&cert_pem)?;
        Ok(Self {
            cert_pem,
            key_pem,
            sha256_fingerprint,
        })
    }

    /// Convert to a rustls `ServerConfig` for use with `axum-server`'s
    /// `bind_rustls`. Installs the `ring` crypto provider on first call;
    /// idempotent for subsequent calls (rustls's install_default is a
    /// no-op if a provider is already set).
    pub fn to_server_config(&self) -> Result<ServerConfig> {
        // rustls 0.23+ requires an explicit CryptoProvider install.
        // Multiple TlsMaterial instances (tests + prod) share the
        // process-wide provider slot; the second-and-later installs are
        // silently ignored, which is what we want.
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();

        let mut cert_reader = self.cert_pem.as_bytes();
        let cert_chain: Vec<CertificateDer<'static>> = certs(&mut cert_reader)
            .collect::<Result<Vec<_>, _>>()
            .context("parse cert PEM")?;

        let mut key_reader = self.key_pem.as_bytes();
        let key: PrivateKeyDer<'static> = pkcs8_private_keys(&mut key_reader)
            .next()
            .ok_or_else(|| anyhow!("no private key in PEM"))?
            .context("parse key PEM")?
            .into();

        ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(cert_chain, key)
            .context("build rustls ServerConfig")
    }
}

/// SHA-256 of the DER-encoded cert bytes, formatted as uppercase hex
/// pairs separated by colons. Matches `openssl x509 -fingerprint -sha256`
/// output shape.
fn fingerprint_from_pem(cert_pem: &str) -> Result<String> {
    // PEM body is base64 of the DER. Strip header/footer lines and any
    // whitespace, then decode.
    let der_b64: String = cert_pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect();
    let der = B64.decode(der_b64.as_bytes()).context("base64 decode PEM body")?;
    let hash = Sha256::digest(&der);
    let hex = hash
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":");
    Ok(hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_persists_on_first_launch() {
        let tmp = tempfile::tempdir().unwrap();
        let mat = TlsMaterial::load_or_generate(
            tmp.path(),
            vec!["localhost".into(), "127.0.0.1".into()],
        )
        .unwrap();
        assert!(tmp.path().join("cert.pem").exists());
        assert!(tmp.path().join("key.pem").exists());
        assert!(mat.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(mat.key_pem.contains("BEGIN PRIVATE KEY"));
    }

    #[test]
    fn reloads_existing_material_on_second_launch() {
        let tmp = tempfile::tempdir().unwrap();
        let first = TlsMaterial::load_or_generate(
            tmp.path(),
            vec!["localhost".into()],
        )
        .unwrap();
        let second = TlsMaterial::load_or_generate(
            tmp.path(),
            // Different SANs on the reload path shouldn't matter; the
            // existing cert is reused, not regenerated.
            vec!["localhost".into(), "192.168.1.1".into()],
        )
        .unwrap();
        assert_eq!(first.cert_pem, second.cert_pem);
        assert_eq!(first.key_pem, second.key_pem);
        assert_eq!(first.sha256_fingerprint, second.sha256_fingerprint);
    }

    #[test]
    fn fingerprint_matches_openssl_format() {
        // 32-byte SHA-256 → 32 hex pairs → 32 * 2 chars + 31 colons = 95.
        let tmp = tempfile::tempdir().unwrap();
        let mat = TlsMaterial::load_or_generate(
            tmp.path(),
            vec!["localhost".into()],
        )
        .unwrap();
        assert_eq!(mat.sha256_fingerprint.len(), 95);
        assert_eq!(mat.sha256_fingerprint.matches(':').count(), 31);
        // Every non-colon char must be an uppercase hex digit.
        for c in mat.sha256_fingerprint.chars() {
            if c == ':' {
                continue;
            }
            assert!(
                c.is_ascii_hexdigit() && !c.is_ascii_lowercase(),
                "unexpected char {c:?} in fingerprint"
            );
        }
    }

    #[test]
    fn server_config_builds_from_generated_material() {
        let tmp = tempfile::tempdir().unwrap();
        let mat = TlsMaterial::load_or_generate(
            tmp.path(),
            vec!["localhost".into()],
        )
        .unwrap();
        // Just prove it parses back into a rustls ServerConfig without
        // erroring. Full handshake coverage is in the integration test.
        let _config = mat.to_server_config().unwrap();
    }
}
