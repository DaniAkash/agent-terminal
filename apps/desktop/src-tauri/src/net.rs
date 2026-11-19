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

/// What the local Tailscale client reports about this machine.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tailscale {
    /// MagicDNS name of this machine, lowercase with no trailing dot.
    /// None when MagicDNS is off for the tailnet, since the name would
    /// not resolve on the phone.
    pub magicdns: Option<String>,
    /// Tailnet IPv4 addresses of this machine.
    pub ipv4s: Vec<Ipv4Addr>,
}

/// Longest a `tailscale status` call may take. A healthy client answers
/// in tens of milliseconds; a wedged `tailscaled` must not hold up the
/// pairing dialog.
const TAILSCALE_CLI_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Where the Tailscale CLI lives, most likely first. A bare name is
/// looked up on `PATH`, which is not enough on its own: a macOS app
/// launched from Finder or the Dock gets a minimal `PATH`, and the Mac
/// Tailscale app keeps its CLI inside the app bundle.
const TAILSCALE_CLI_CANDIDATES: &[&str] = &[
    "tailscale",
    #[cfg(target_os = "macos")]
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    #[cfg(target_os = "macos")]
    "/opt/homebrew/bin/tailscale",
    #[cfg(unix)]
    "/usr/local/bin/tailscale",
    #[cfg(unix)]
    "/usr/bin/tailscale",
    #[cfg(windows)]
    r"C:\Program Files\Tailscale\tailscale.exe",
];

/// Ask the local Tailscale client about this machine. None when Tailscale
/// is not installed, not connected, or does not answer in time.
///
/// Spawns a child process and waits for it. The whole call takes at most
/// [`TAILSCALE_CLI_TIMEOUT`], however many candidates it tries. Call it
/// from a blocking context.
pub fn tailscale() -> Option<Tailscale> {
    let deadline = std::time::Instant::now() + TAILSCALE_CLI_TIMEOUT;
    // The first CLI that exists answers for all of them: a client that
    // is there but hangs or fails will not do better under another path.
    let cli = TAILSCALE_CLI_CANDIDATES
        .iter()
        .find_map(|cli| match tailscale_status_json(cli, true, deadline) {
            CliRun::NotFound => None,
            run => Some((cli, run)),
        });
    let stdout = match cli? {
        (_, CliRun::Output(stdout)) => stdout,
        // A client too old to know `--peers` rejects it. Ask again for
        // the full status.
        (cli, CliRun::Failed) => match tailscale_status_json(cli, false, deadline) {
            CliRun::Output(stdout) => stdout,
            _ => return None,
        },
        _ => return None,
    };
    parse_tailscale_status(&stdout)
}

/// How one run of the Tailscale CLI ended.
#[derive(Debug, PartialEq, Eq)]
enum CliRun {
    /// No program at that path.
    NotFound,
    /// It ran and exited non-zero.
    Failed,
    /// It did not finish, or did not hand over its output, by the deadline.
    TimedOut,
    /// It exited zero; this is its stdout.
    Output(Vec<u8>),
}

/// Run `<cli> status --json` until `deadline` at the latest; the child
/// is killed then.
fn tailscale_status_json(cli: &str, without_peers: bool, deadline: std::time::Instant) -> CliRun {
    use std::io::Read;
    use std::process::Stdio;

    let mut command = crate::host_env::command(cli);
    command.args(["status", "--json"]);
    if without_peers {
        // Without the peer list the output is small and fixed-size.
        command.arg("--peers=false");
    }
    let spawned = command
        // The macOS app binary is GUI and CLI in one, and guesses which
        // to be from shell variables (TERM, SHLVL) that an app launched
        // from the Dock does not have. This makes it the CLI regardless.
        .env("TAILSCALE_BE_CLI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = spawned else {
        return CliRun::NotFound;
    };
    let Some(mut pipe) = child.stdout.take() else {
        return CliRun::Failed;
    };
    // Drain stdout off-thread so a chatty child cannot block on a full
    // pipe while we wait for it to exit. Over a channel, not a join: if
    // something else keeps the pipe open, the read never ends, and we
    // must still return.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if pipe.read_to_end(&mut buf).is_ok() {
            let _ = tx.send(buf);
        }
    });

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                eprintln!("[net] `{cli} status` did not finish in time; ignoring Tailscale");
                return CliRun::TimedOut;
            }
        }
    };
    if !status.success() {
        return CliRun::Failed;
    }
    let left = deadline.saturating_duration_since(std::time::Instant::now());
    // The child has exited, so its output is already in the pipe; the
    // floor only covers the reader thread's scheduling.
    match rx.recv_timeout(left.max(std::time::Duration::from_millis(200))) {
        Ok(stdout) => CliRun::Output(stdout),
        Err(_) => CliRun::TimedOut,
    }
}

/// Read what [`tailscale`] needs out of `tailscale status --json`.
///
/// None unless the backend is `Running`: a stopped or logged-out client
/// still reports its last name and addresses, and advertising those
/// sends the phone to an endpoint that cannot answer.
fn parse_tailscale_status(json: &[u8]) -> Option<Tailscale> {
    let status: serde_json::Value = serde_json::from_slice(json).ok()?;
    if status.get("BackendState")?.as_str()? != "Running" {
        return None;
    }
    let this = status.get("Self")?;

    // Older clients do not report the flag; assume MagicDNS is on then.
    let magicdns_enabled = status
        .pointer("/CurrentTailnet/MagicDNSEnabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let magicdns = this
        .get("DNSName")
        .and_then(serde_json::Value::as_str)
        .map(|name| name.trim().trim_end_matches('.').to_lowercase())
        .filter(|name| magicdns_enabled && !name.is_empty());

    let ipv4s = this
        .get("TailscaleIPs")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|ip| ip.as_str()?.parse::<Ipv4Addr>().ok())
        .collect();

    Some(Tailscale { magicdns, ipv4s })
}

/// Enumerate every RFC 1918 IPv4 the machine is bound to. Excludes
/// loopback since the QR is for a phone on the LAN, not a colocated
/// client, and the addresses of virtual interfaces (see
/// [`is_virtual_interface`]): no phone can reach a Docker bridge, and
/// each one added a dead address the phone had to try and made the QR
/// denser. A machine with a dozen compose projects carried thirteen.
///
/// Tailnet addresses are not found here. They sit in 100.64.0.0/10,
/// which is ordinary carrier-grade NAT space (ISP CGNAT, Starlink, phone
/// hotspots), so an interface address in that range does not mean
/// Tailscale. Only [`tailscale`] knows which addresses are tailnet ones.
pub fn lan_ipv4s() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    let Ok(ifaces) = local_ip_address::list_afinet_netifas() else {
        return out;
    };
    for (name, ip) in ifaces {
        if is_virtual_interface(&name) {
            continue;
        }
        if let IpAddr::V4(v4) = ip {
            if v4.is_private() && !out.contains(&v4) {
                out.push(v4);
            }
        }
    }
    out
}

/// Name prefixes of interfaces that only lead to containers and VMs on
/// this machine: Docker and its compose networks, Podman, libvirt, LXC
/// and LXD, CNI and Kubernetes overlays, VirtualBox, VMware, Parallels,
/// and the macOS bridge that Internet Sharing and VM apps create.
const VIRTUAL_INTERFACE_PREFIXES: &[&str] = &[
    "docker", "br-", "veth", "virbr", "vnet", "podman", "cni", "flannel", "cali",
    "weave", "kube", "lxcbr", "lxdbr", "vboxnet", "vmnet", "vmenet", "prl", "bridge",
];

/// Whether `name` is an interface no phone can reach the desktop through.
pub fn is_virtual_interface(name: &str) -> bool {
    let name = name.to_lowercase();
    VIRTUAL_INTERFACE_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// Every way a phone can reach this desktop right now. The pairing QR
/// and the TLS certificate's SANs are both built from this, so they
/// cannot disagree.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Advertised {
    /// `.local` mDNS name.
    pub local_host: Option<String>,
    /// Tailscale MagicDNS name.
    pub tailscale_host: Option<String>,
    /// LAN addresses first, then tailnet addresses.
    pub ips: Vec<Ipv4Addr>,
}

/// Look up the current [`Advertised`] endpoints. Blocking: it calls
/// [`tailscale`].
pub fn advertised() -> Advertised {
    let tailscale = tailscale().unwrap_or_default();
    let mut ips = lan_ipv4s();
    for ip in tailscale.ipv4s {
        if !ips.contains(&ip) {
            ips.push(ip);
        }
    }
    Advertised {
        local_host: local_hostname(),
        tailscale_host: tailscale.magicdns,
        ips,
    }
}

/// Try to bind each port in `ports` in order against `bind_host`.
/// Returns the first `(listener, port)` pair that binds successfully.
///
/// The returned listener is switched to non-blocking mode before the
/// caller sees it, per tokio's documented `TcpListener::from_std`
/// contract:
///
/// > The caller is responsible for ensuring that the listener is in
/// > non-blocking mode. Otherwise all I/O operations on the listener
/// > will block the thread, which will cause unexpected behavior.
///
/// axum-server's `from_tcp_rustls` also calls `set_nonblocking(true)`
/// internally on the listener it receives (`server.rs:250` in 0.7.3);
/// the syscall is idempotent, so setting it here does not conflict.
/// Doing it once at bind time means every consumer (plain
/// `tokio::net::TcpListener::from_std`, axum-server TLS, integration
/// tests) inherits the safe default instead of needing to remember.
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
            Ok(l) => {
                l.set_nonblocking(true)?;
                return Ok((l, port));
            }
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
    fn lan_ipv4s_returns_only_rfc1918_addresses() {
        for ip in lan_ipv4s() {
            assert!(ip.is_private(), "lan_ipv4s must only surface RFC 1918, got {ip}");
        }
    }

    #[test]
    fn virtual_interfaces_are_recognised() {
        for name in [
            "docker0", "br-7dbd7fe75f23", "veth1a2b3c", "virbr0", "podman0", "cni0",
            "lxdbr0", "vboxnet0", "vmnet8", "bridge100",
        ] {
            assert!(is_virtual_interface(name), "{name} should be virtual");
        }
    }

    #[test]
    fn physical_and_vpn_interfaces_are_kept() {
        for name in ["enp0s6", "eth0", "wlan0", "wlp2s0", "en0", "en1", "tailscale0", "utun3"] {
            assert!(!is_virtual_interface(name), "{name} should be kept");
        }
    }

    #[test]
    fn lan_ipv4s_skips_virtual_interfaces() {
        let virtual_ips: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .filter(|(name, _)| is_virtual_interface(name))
            .map(|(_, ip)| ip)
            .collect();
        for ip in lan_ipv4s() {
            assert!(!virtual_ips.contains(&IpAddr::V4(ip)), "{ip} is on a virtual interface");
        }
    }

    const RUNNING_STATUS: &str = r#"{
        "BackendState": "Running",
        "Self": {
            "DNSName": "Desk.Tail1234.ts.net.",
            "TailscaleIPs": ["100.101.102.103", "fd7a:115c:a1e0::1"]
        },
        "CurrentTailnet": { "MagicDNSEnabled": true }
    }"#;

    #[test]
    fn tailscale_status_gives_the_name_and_ipv4_addresses() {
        let ts = parse_tailscale_status(RUNNING_STATUS.as_bytes()).expect("running");
        assert_eq!(ts.magicdns.as_deref(), Some("desk.tail1234.ts.net"));
        assert_eq!(ts.ipv4s, vec!["100.101.102.103".parse::<Ipv4Addr>().unwrap()]);
    }

    #[test]
    fn a_stopped_tailscale_advertises_nothing() {
        // A stopped or logged-out client still reports its last name
        // and addresses.
        for state in ["Stopped", "NeedsLogin", "NoState"] {
            let json = RUNNING_STATUS.replace("Running", state);
            assert_eq!(parse_tailscale_status(json.as_bytes()), None, "{state}");
        }
    }

    #[test]
    fn no_magicdns_name_when_magicdns_is_off() {
        let json = RUNNING_STATUS.replace("true", "false");
        let ts = parse_tailscale_status(json.as_bytes()).expect("running");
        assert_eq!(ts.magicdns, None);
        assert_eq!(ts.ipv4s.len(), 1, "the address still works without MagicDNS");
    }

    #[test]
    fn tailscale_status_that_is_not_json_is_ignored() {
        assert_eq!(parse_tailscale_status(b"not json"), None);
        assert_eq!(parse_tailscale_status(b"{}"), None);
    }

    /// Not an assertion about the machine: prints what the real client
    /// reports, for checking detection by hand with `--nocapture`.
    #[test]
    #[ignore = "depends on the local Tailscale install"]
    fn probe_local_tailscale() {
        eprintln!("tailscale() = {:?}", tailscale());
        eprintln!("advertised() = {:?}", advertised());
    }

    #[test]
    fn a_missing_tailscale_cli_is_not_an_error() {
        let deadline = std::time::Instant::now() + TAILSCALE_CLI_TIMEOUT;
        assert_eq!(
            tailscale_status_json("/nonexistent/tailscale", true, deadline),
            CliRun::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_hung_cli_is_killed_at_the_deadline() {
        // `sleep` ignores the arguments' meaning and just fails to parse
        // them on some systems, so use a shell that waits.
        let dir = std::env::temp_dir().join(format!("at-hung-cli-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("tailscale");
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let started = std::time::Instant::now();
        let deadline = started + std::time::Duration::from_millis(300);
        let run = tailscale_status_json(script.to_str().unwrap(), true, deadline);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(run, CliRun::TimedOut);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
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

    #[test]
    fn bind_first_available_returns_a_non_blocking_listener() {
        // Contract: consumers can pass the returned listener straight
        // to `tokio::net::TcpListener::from_std` without an extra
        // `set_nonblocking(true)` call. Test via a poll on `accept()`
        // that must return `WouldBlock` immediately in non-blocking
        // mode.
        let port = 55531u16;
        let (listener, _) =
            bind_first_available("127.0.0.1", &[port]).expect("bind");
        let err = listener.accept().expect_err(
            "non-blocking accept on an idle listener must return WouldBlock",
        );
        assert_eq!(err.kind(), std::io::ErrorKind::WouldBlock);
    }
}
