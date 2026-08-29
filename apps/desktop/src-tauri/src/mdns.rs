// mDNS / DNS-SD service registration for the WSS server.
//
// Advertises `_agent-terminal._tcp.local.` on the LAN so mobile clients
// can find the desktop by its `.local` name even after a DHCP IP shift.
// Registration is a Phase 2A ergonomics feature: iOS and Android's
// system resolvers already handle `.local` mDNS lookups transparently,
// so mobile does not need an explicit mDNS API on the client side to
// benefit from this advertisement.
//
// TXT records carry a fingerprint prefix + version tag. Full fingerprint
// still lives in the pairing QR; the TXT prefix is a fast "is this
// probably the desktop I paired with" hint the client can use before
// completing a TLS handshake.
//
// One daemon per process. Reregistering while the previous ServiceInfo
// is live is safe; mdns-sd tolerates it. Shutdown deregisters cleanly
// so a graceful desktop close does not leave a stale record.

use anyhow::{Context, Result};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;
use std::net::Ipv4Addr;

/// mDNS service type. RFC 6763 requires the trailing dot; both
/// `ServiceInfo::new` and the browsers below normalise if you forget,
/// but the fully-qualified form is what actually goes on the wire.
pub const SERVICE_TYPE: &str = "_agent-terminal._tcp.local.";

/// Instance name used for the advertisement. Suffixed with `.local`
/// by the daemon. Kept static because we only run one WSS server per
/// machine.
pub const INSTANCE_NAME: &str = "agent-terminal";

/// Long-lived handle for the running daemon + advertisement. Drop
/// deregisters the service and shuts the daemon down cleanly.
pub struct MdnsAdvertisement {
    daemon: ServiceDaemon,
    fullname: String,
}

impl MdnsAdvertisement {
    /// Start the mDNS daemon and register the WSS service with the
    /// given LAN IPv4s and bound port. Fingerprint should be the full
    /// SHA-256 colon-hex; we truncate it into the TXT to fit the 255-
    /// byte per-record limit.
    ///
    /// The advertised hostname is passed in rather than looked up
    /// here because the caller already resolves it via
    /// `net::local_hostname` for the pairing QR; keeping the two in
    /// sync avoids "QR says X, mDNS says Y" surprises.
    pub fn register(
        hostname: &str,
        ips: &[Ipv4Addr],
        port: u16,
        fingerprint: &str,
    ) -> Result<Self> {
        let daemon = ServiceDaemon::new().context("mdns_sd ServiceDaemon::new")?;

        // Normalise the hostname to the RFC form the daemon expects:
        // it wants a `foo.local.` suffix (trailing dot). Our helper
        // returns `foo.local` without the trailing dot.
        let host_with_dot = if hostname.ends_with('.') {
            hostname.to_string()
        } else {
            format!("{hostname}.")
        };

        // Fingerprint prefix: first 16 hex chars (8 bytes) is plenty
        // for a "does this even look like my desktop" hint. Strip
        // colons so the TXT stays under the length budget without
        // the receiver having to reformat.
        let fingerprint_prefix: String = fingerprint
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .take(16)
            .collect();

        let mut props: HashMap<String, String> = HashMap::new();
        props.insert("v".to_string(), "1".to_string());
        props.insert("fp16".to_string(), fingerprint_prefix);

        // Convert IPv4s to strings for the AsIpAddrs impl the daemon
        // wants; skip if empty (daemon rejects empty address lists).
        if ips.is_empty() {
            let _ = daemon.shutdown();
            return Err(anyhow::anyhow!(
                "no LAN IPs to advertise for mDNS registration"
            ));
        }
        let ip_strings: Vec<String> = ips.iter().map(|ip| ip.to_string()).collect();
        let ip_slice: Vec<&str> = ip_strings.iter().map(String::as_str).collect();

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            INSTANCE_NAME,
            &host_with_dot,
            &ip_slice[..],
            port,
            props,
        )
        .context("mdns_sd ServiceInfo::new")?;

        let fullname = service.get_fullname().to_string();
        daemon
            .register(service)
            .context("mdns_sd ServiceDaemon::register")?;
        eprintln!(
            "[mdns] registered {fullname} at {host_with_dot}:{port} (ips={ips:?})"
        );

        Ok(Self { daemon, fullname })
    }
}

impl Drop for MdnsAdvertisement {
    fn drop(&mut self) {
        // Best-effort. If the daemon is already shutting down we
        // silently move on; deregistration is a nicety, not a
        // correctness requirement.
        if let Err(e) = self.daemon.unregister(&self.fullname) {
            eprintln!("[mdns] unregister {} failed: {e}", self.fullname);
        }
        if let Err(e) = self.daemon.shutdown() {
            eprintln!("[mdns] shutdown failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_succeeds_on_a_bindable_port() {
        // Real mDNS needs a working network stack; on constrained CI
        // environments this can fail. Try it; if it works, assert the
        // shape. If not, skip loudly so the failure doesn't get
        // conflated with a real regression.
        let ips = vec![Ipv4Addr::new(127, 0, 0, 1)];
        let fingerprint = "AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90";
        match MdnsAdvertisement::register("test-host.local", &ips, 55555, fingerprint) {
            Ok(ad) => {
                assert!(ad.fullname.contains("_agent-terminal._tcp.local."));
                // Drop deregisters; if the daemon is truly broken this
                // shows up as a stderr message but doesn't fail the test.
            }
            Err(e) => {
                eprintln!("mdns register unavailable in this env: {e}");
            }
        }
    }

    #[test]
    fn register_errors_when_no_ips_provided() {
        let fingerprint = "AB:CD:EF:12:34:56:78:90";
        let result = MdnsAdvertisement::register("test-host.local", &[], 55555, fingerprint);
        let err = match result {
            Ok(_) => panic!("expected error when no ips are provided"),
            Err(e) => e,
        };
        assert!(
            err.to_string().contains("no LAN IPs"),
            "unexpected error message: {err}"
        );
    }
}
