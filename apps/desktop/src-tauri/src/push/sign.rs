//! Payload signing for push notifications.
//!
//! ## Why this exists
//!
//! Expo's push service requires no access token to send by default:
//! anyone holding a user's Expo push token can send that user a
//! notification under our app's name. Expo's own mitigation (enhanced
//! push security) requires the sender to present an account access
//! token, which would have to ship inside a public desktop binary. That
//! is the same objection that ruled out shipping an FCM service account
//! key, so it is unavailable to us.
//!
//! ## What this does and does not promise
//!
//! It authenticates ROUTING, and only routing. The signature covers the
//! fields in `canonical` below, which the phone checks before it acts
//! on a tap, so a forged notification cannot send the user to a tab, a
//! project or a desktop of the sender's choosing.
//!
//! It does NOT authenticate the words on screen. Title and body travel
//! as Expo's alert fields, and both iOS and Android draw them from the
//! system's own notification path before any JavaScript in the app
//! runs: there is no point at which this signature could be consulted
//! first. Anyone holding a device's Expo push token can therefore
//! display arbitrary text under this app's name, and can change that
//! text without invalidating `sig`. The phone suppresses an unparseable
//! payload while it is in the foreground, which is the one case it
//! controls, and that is the whole extent of the mitigation.
//!
//! Authenticating the text needs the text out of the alert fields and
//! into an encrypted payload the app decrypts and then presents, which
//! on iOS means a notification service extension. That is a separate
//! piece of work, not something this construction can be stretched to
//! cover. Do not describe this signature as preventing forged
//! notifications: it prevents forged navigation.
//!
//! The pairing already gives both ends a shared secret, so the fix needs
//! no secret in the binary at all:
//!
//! - the desktop stores `PairedDevice.token_hash`, which *is*
//!   SHA-256(device_token), already, for auth comparison
//! - the phone holds the raw device token in SecureStore and hashes it
//!   to the same value
//!
//! ## Construction
//!
//! Nested rather than a single keyed digest, because SHA-256 is
//! length-extendable and a bare `SHA256(key || msg)` would let an
//! attacker append fields. Not real HMAC because `expo-crypto` exposes
//! digests and no keyed-hash function, so the phone has to reproduce
//! this with digest calls alone.
//!
//! Every step is over a UTF-8 *string* and yields a hex *string*, for
//! the same reason: `Crypto.digestStringAsync` takes a string and
//! returns hex, so the phone can reproduce this without ever handling
//! raw bytes.
//!
//! ```text
//! inner = SHA256_hex(key_hex + "|" + msg)
//! sig   = SHA256_hex(key_hex + "|" + inner)[..32]
//! ```

use sha2::{Digest, Sha256};

use super::escalation::Pending;

/// Payload format version. Bump when the canonical message changes
/// shape, never silently: every existing signature becomes invalid.
pub const PAYLOAD_VERSION: u32 = 1;

/// 32 hex chars, which is 128 bits. Far beyond forgeable, and the Expo
/// payload budget is 4 KiB so there is no reason to shave it further.
const SIG_HEX_LEN: usize = 32;

fn sha256_hex(input: &str) -> String {
    Sha256::digest(input.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The exact bytes the signature covers.
///
/// Field order is part of the format. Changing it, or adding a field,
/// invalidates every signature in flight and needs a `PAYLOAD_VERSION`
/// bump.
///
/// Routing fields only. The display text is deliberately outside this,
/// and that is a real limit rather than a deferred detail: the text is
/// readable AND forgeable by anyone with the push token, because the OS
/// renders it before the app can check anything. See the module docs.
pub fn canonical(
    version: u32,
    device_id: &str,
    project_id: &str,
    tab_id: &str,
    state: &str,
    fired_at: i64,
) -> String {
    format!("v{version}|{device_id}|{project_id}|{tab_id}|{state}|{fired_at}")
}

pub fn canonical_for(pending: &Pending, device_id: &str, state: &str) -> String {
    canonical(
        PAYLOAD_VERSION,
        device_id,
        &pending.project_id,
        &pending.tab_id_in_project,
        state,
        pending.fired_at_wall,
    )
}

/// `key_hex` is the device's `token_hash`, lowercase hex of
/// SHA-256(device_token).
pub fn sign(key_hex: &str, msg: &str) -> String {
    let inner = sha256_hex(&format!("{key_hex}|{msg}"));
    let outer = sha256_hex(&format!("{key_hex}|{inner}"));
    outer[..SIG_HEX_LEN].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn msg() -> String {
        canonical(
            1,
            "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204",
            "proj_01HQ",
            "tab_04",
            "awaiting",
            1_762_338_240_000,
        )
    }

    /// Pins the wire format. The companion has the mirror of this test
    /// over the same literals, and the two must agree byte for byte.
    #[test]
    fn canonical_string_is_stable() {
        assert_eq!(
            msg(),
            "v1|e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204|proj_01HQ|tab_04|awaiting|1762338240000"
        );
    }

    /// Cross-language fixture. If this value changes, the companion's
    /// matching test fails too, which is the point: `data` is free-form
    /// JSON that the typeshare drift check cannot see.
    #[test]
    fn signature_matches_the_shared_fixture() {
        assert_eq!(sign(KEY, &msg()), "e26e2e3eabfcdba29c4ccd0a344c037c");
    }

    #[test]
    fn signature_is_128_bits_of_hex() {
        let s = sign(KEY, &msg());
        assert_eq!(s.len(), 32);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn every_covered_field_changes_the_signature() {
        let base = sign(KEY, &msg());
        let variants = [
            canonical(2, "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204", "proj_01HQ", "tab_04", "awaiting", 1_762_338_240_000),
            canonical(1, "other-device", "proj_01HQ", "tab_04", "awaiting", 1_762_338_240_000),
            canonical(1, "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204", "proj_other", "tab_04", "awaiting", 1_762_338_240_000),
            canonical(1, "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204", "proj_01HQ", "tab_99", "awaiting", 1_762_338_240_000),
            canonical(1, "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204", "proj_01HQ", "tab_04", "completed", 1_762_338_240_000),
            canonical(1, "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204", "proj_01HQ", "tab_04", "awaiting", 1_762_338_240_001),
        ];
        for v in variants {
            assert_ne!(sign(KEY, &v), base, "unchanged signature for {v}");
        }
    }

    #[test]
    fn a_different_device_key_yields_a_different_signature() {
        let other = "0".repeat(64);
        assert_ne!(sign(KEY, &msg()), sign(&other, &msg()));
    }

    /// The property the nesting buys: an attacker who knows
    /// SHA256(key || m) cannot derive the signature for m || suffix.
    #[test]
    fn nesting_is_not_a_bare_keyed_digest() {
        let naive = sha256_hex(&format!("{KEY}|{}", msg()));
        assert_ne!(sign(KEY, &msg()), naive[..32]);
    }
}
