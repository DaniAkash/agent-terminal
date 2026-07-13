// Network helpers shared by the WSS server bootstrap: standardised
// port trio + first-that-binds fallback, `.local` hostname resolution,
// LAN IP enumeration.
//
// The port trio is the "no dev tool I checked uses these" set. First
// port that binds wins; the choice is written into the pairing QR so
// the mobile client's fast-path attempt is instant. Mobile iterates
// through the full list on failure so the reconnect ladder is robust
// to a desktop reboot that lands on a different port.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};

/// Standardised port trio for the WSS server. 5-digit, uncommon (no
/// widespread dev tool I know of squats these), all inside the
/// registered/user range (1024-49151) so the kernel's ephemeral pool
/// (49152-65535 on most platforms) does not randomly grab them out
/// from under us for outbound connections. Order matters: the first
/// bindable port wins, so keeping 47823 first preserves compatibility
/// with any client from PR A dev work.
pub const STANDARD_PORTS: [u16; 3] = [47823, 28617, 39482];

/// The machine's `.local` mDNS hostname. Resolves via `hostname::get`;
/// appends `.local` if the OS value does not already carry it. Returns
/// None if the OS refuses to hand back a hostname or if the name is
/// empty. That "no name" case degrades gracefully to IP-only pairing.
pub fn local_hostname() -> Option<String> {
    let raw = hostname::get().ok()?.into_string().ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    // Lowercase because mDNS is case-insensitive and mobile clients
    // compare strings raw; save them a surprise.
    let lower = raw.to_lowercase();
    if lower.ends_with(".local") {
        Some(lower)
    } else {
        Some(format!("{lower}.local"))
    }
}

/// Enumerate every RFC 1918 IPv4 the machine is bound to. Reuse of the
/// same predicate used by `build_tls_sans` so the pairing QR's IP list
/// matches the cert's SANs exactly. Excludes loopback since the QR is
/// for a phone on the LAN, not a colocated client.
pub fn lan_ipv4s() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    let Ok(ifaces) = local_ip_address::list_afinet_netifas() else {
        return out;
    };
    for (_, ip) in ifaces {
        if let IpAddr::V4(v4) = ip {
            if v4.is_private() && !out.contains(&v4) {
                out.push(v4);
            }
        }
    }
    out
}

/// Try to bind each port in `ports` in order against `bind_host`.
/// Returns the first `(listener, port)` pair that binds successfully.
/// The listener is returned still-bound and non-blocking-mode
/// unmodified so the caller (production `run_with_tls` or a test) can
/// convert it however it likes.
///
/// Bind-then-return-listener (rather than probe-then-close-then-rebind)
/// avoids the classic drop-then-rebind race where a fast neighbour
/// grabs the port between probe and rebind.
pub fn bind_first_available(
    bind_host: &str,
    ports: &[u16],
) -> Result<(StdTcpListener, u16), std::io::Error> {
    let mut last_err: Option<std::io::Error> = None;
    for &port in ports {
        let addr: SocketAddr = format!("{bind_host}:{port}")
            .parse()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("{e}")))?;
        match StdTcpListener::bind(addr) {
            Ok(l) => return Ok((l, port)),
            Err(e) => {
                eprintln!("[net] bind {addr} failed: {e}");
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no ports provided")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_hostname_returns_a_value_ending_in_local() {
        // Sandboxed CI can hand back an unset or non-UTF8 hostname;
        // prod code degrades to None in that case (see
        // `local_hostname` doc), so this test does the same rather
        // than flaking. Any real host returns something.
        let Some(host) = local_hostname() else {
            eprintln!("local_hostname unavailable in this env; skipping");
            return;
        };
        assert!(
            host.ends_with(".local"),
            "expected .local suffix, got {host}"
        );
        assert_eq!(host, host.to_lowercase(), "expected lowercase");
    }

    #[test]
    fn lan_ipv4s_returns_only_private_addresses() {
        for ip in lan_ipv4s() {
            assert!(
                ip.is_private(),
                "lan_ipv4s must only surface RFC 1918 ranges, got {ip}"
            );
        }
    }

    #[test]
    fn bind_first_available_prefers_earlier_ports() {
        // Ephemeral high ports the OS will hand out at random; we
        // pass them in a known order and check the first one wins.
        let a = 55501u16;
        let b = 55502u16;
        let (listener, port) = bind_first_available("127.0.0.1", &[a, b]).expect("bind");
        assert_eq!(port, a);
        drop(listener);
    }

    #[test]
    fn bind_first_available_falls_through_to_second_when_first_taken() {
        let a = 55511u16;
        let b = 55512u16;
        // Hog `a` in a held listener so the fallback path runs.
        let _hog = StdTcpListener::bind(("127.0.0.1", a)).expect("hog");
        let (listener, port) = bind_first_available("127.0.0.1", &[a, b]).expect("fallback");
        assert_eq!(port, b);
        drop(listener);
    }

    #[test]
    fn bind_first_available_errors_when_all_ports_are_busy() {
        let a = 55521u16;
        let b = 55522u16;
        let _hog_a = StdTcpListener::bind(("127.0.0.1", a)).expect("hog a");
        let _hog_b = StdTcpListener::bind(("127.0.0.1", b)).expect("hog b");
        assert!(bind_first_available("127.0.0.1", &[a, b]).is_err());
    }
}
