// WSS server for the mobile companion. Bound to the dev-config's
// bind_addr (defaults to 0.0.0.0:47823 — LAN-accessible so a phone on
// the same Wi-Fi can reach it). One route in Phase 1: `/stream`.
//
// Connection lifecycle:
//   1. WebSocket upgrade on `/stream`.
//   2. Client sends `ClientFrame::Auth`. Server validates against the
//      AuthStub's bearer token via constant-time compare.
//   3. Server replies `ServerFrame::AuthOk` + immediately pushes a
//      `ServerFrame::Projects` frame with the current tab tree.
//   4. Server enters the frame-dispatch loop (lands in the next
//      commit — this initial commit closes the connection right after
//      the AuthOk + Projects push).
//
// Auth is intentionally minimal — a single bearer token from the dev
// config file. Phase 2 replaces the whole flow with the QR-code pairing
// handshake per-device tokens stored in the macOS Keychain.

use crate::auth_stub::AuthStub;
use crate::mod_engine::{CwdTable, ModEngineHandle};
use crate::pairing::{PairedTokens, PairingError, PairingWindow, PAIRING_PREFIX};
use crate::projects_cache::ProjectsCache;
use crate::protocol::{ClientFrame, PairingCompleteBody, ServerFrame};
use tauri::Emitter;
use crate::pty_manager::{spawn_pty_if_absent, PtyMap};
use crate::stream_hub::{StreamHub, SubscriberId};
use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use portable_pty::PtySize;
use std::collections::HashMap;
use std::io::{self, Write};
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

#[derive(Debug, Error)]
pub enum WssError {
    #[error("bind {addr}: {source}")]
    Bind {
        addr: SocketAddr,
        #[source]
        source: io::Error,
    },
    #[error("serve: {0}")]
    Serve(#[from] io::Error),
}

/// Handles passed to each connection task. Cloneable via `Arc`; per-
/// connection state lives inside the task itself.
pub struct ServerState {
    pub hub: Arc<StreamHub>,
    pub auth: Arc<AuthStub>,
    /// Cache of the desktop's full project + tab tree. Populated by React
    /// via `sync_projects_to_wss` (source of truth for mutations) and
    /// pre-loaded from `projects.json` on cold start so a mobile client
    /// that connects before React has finished mounting sees something
    /// useful.
    pub projects_cache: Arc<ProjectsCache>,
    /// Shared with the Tauri app so a Write / Resize frame from a
    /// remote client writes to the same PtyHandle the desktop
    /// frontend does. Concurrent access under the existing
    /// `Mutex<HashMap>` is fine at Phase 1 keystroke rates; if
    /// contention shows in profiling we split the lock.
    pub pty_map: PtyMap,
    pub mod_engine_handle: ModEngineHandle,
    /// Tab OSC 7 cwd table, shared with the mod engine + the desktop
    /// spawn path. Auto-spawn on Subscribe resolves the initial cwd of
    /// a sleeping tab against `last_cwd` from the ProjectsCache first;
    /// this table is threaded to spawn_pty for symmetry with the
    /// desktop's open_tab flow so a subsequent local visit lands in the
    /// same cwd via OSC 7.
    pub cwd_table: CwdTable,
    /// AppHandle for the Tauri commands + events spawn_pty emits
    /// (pty:exit, pty:respawned). Cloned into each auto-spawn call.
    /// `Option` so integration tests can build a ServerState without
    /// standing up a full Tauri mock runtime; the auto-spawn branch
    /// gates on `Some` and treats `None` as "no-op, don't spawn".
    pub app_handle: Option<tauri::AppHandle>,
    /// Per-op-id map from CRUD `(connection_id, op_id)` to the client
    /// outbox that fired it. Populated when Rust dispatches a
    /// `wss:mobile_op` Tauri event to React; consulted when React calls
    /// the `report_mobile_op_ok` or `report_mobile_op_error` Tauri
    /// command so we route the reply frame back to the exact client
    /// that started the op.
    ///
    /// Compound key: `op_id` alone would collide across clients because
    /// each mobile process starts its counter at 1. `connection_id` is
    /// assigned by this server on WebSocket upgrade (monotonic global
    /// counter) and threaded through every `wss:mobile_op` event, so
    /// (connection_id, op_id) is globally unique per pending op.
    pub mobile_op_inboxes: Arc<MobileOpInboxes>,
    /// Long-lived per-device token store. Auth path checks this before
    /// the legacy dev bearer token: pair-a-device-once-then-connect is
    /// the shipping model.
    pub paired_tokens: Arc<PairedTokens>,
    /// One-at-a-time pairing session. Opened by the desktop UI via the
    /// `open_pairing_window` command, consumed by a mobile client
    /// completing the QR handshake.
    pub pairing_window: Arc<PairingWindow>,
    /// Live connections tagged by paired-device id. Revoke walks this
    /// map to force-close every active session under a device_id.
    pub paired_conns: Arc<PairedConnMap>,
}

/// Reply-routing table for mobile CRUD ops. See ServerState docs.
pub struct MobileOpInboxes(
    pub std::sync::Mutex<HashMap<(u64, u64), mpsc::UnboundedSender<ServerFrame>>>,
);

impl MobileOpInboxes {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(HashMap::new()))
    }
}

impl MobileOpInboxes {
    /// Drop every pending entry for a connection. Called when the
    /// per-connection task exits (client close, socket error, task
    /// panic) so the map doesn't accumulate dead outbox senders that
    /// never get drained by an OpOk/OpError report.
    pub fn reap_connection(&self, connection_id: u64) {
        self.0
            .lock()
            .expect("mobile_op_inboxes lock poisoned")
            .retain(|(cid, _), _| *cid != connection_id);
    }
}

impl Default for MobileOpInboxes {
    fn default() -> Self {
        Self::new()
    }
}

/// Live-connection registry keyed by `(device_id, connection_id)`, with
/// one abort-signal `oneshot::Sender<()>` per entry. Revoke fires each
/// matching sender; the connection task's select! branch on the
/// corresponding receiver drops the socket. Deregister removes the
/// entry on graceful disconnect so the map does not accumulate dead
/// senders.
pub struct PairedConnMap {
    inner: std::sync::Mutex<HashMap<(String, u64), tokio::sync::oneshot::Sender<()>>>,
}

impl PairedConnMap {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Track a new authenticated connection. `abort_tx` is the sender
    /// half of a oneshot the connection task's select! branch awaits;
    /// the caller keeps the receiver alive for the connection's
    /// lifetime.
    pub fn register(
        &self,
        device_id: String,
        connection_id: u64,
        abort_tx: tokio::sync::oneshot::Sender<()>,
    ) {
        self.inner
            .lock()
            .expect("paired_conns lock poisoned")
            .insert((device_id, connection_id), abort_tx);
    }

    /// Called from the connection task's cleanup path so the map does
    /// not hold dead senders.
    pub fn deregister(&self, device_id: &str, connection_id: u64) {
        self.inner
            .lock()
            .expect("paired_conns lock poisoned")
            .remove(&(device_id.to_string(), connection_id));
    }

    /// Force-close every active session under `device_id`. Returns the
    /// number of connections that were signalled. A send-failure means
    /// the receiver already dropped (connection was closing anyway);
    /// still count it, since the caller only cares that no further
    /// traffic will flow.
    pub fn revoke_and_close(&self, device_id: &str) -> usize {
        let mut map = self.inner.lock().expect("paired_conns lock poisoned");
        let keys: Vec<(String, u64)> = map
            .keys()
            .filter(|(id, _)| id == device_id)
            .cloned()
            .collect();
        let mut count = 0usize;
        for key in keys {
            if let Some(tx) = map.remove(&key) {
                let _ = tx.send(());
                count += 1;
            }
        }
        count
    }
}

impl Default for PairedConnMap {
    fn default() -> Self {
        Self::new()
    }
}

/// Monotonic per-server-process connection id. Assigned in
/// `connection_task` on each WebSocket upgrade so mobile CRUD ops from
/// different clients can be routed back to the exact originating
/// outbox even when their client-local `op_id` counters collide.
static NEXT_CONNECTION_ID: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

/// Bind the WSS server to `addr` and serve until the listener closes.
/// `lib.rs` spawns this as a tokio task and doesn't await its
/// completion; a bind failure logs and returns without blocking desktop
/// startup.
pub async fn run(addr: SocketAddr, state: Arc<ServerState>) -> Result<(), WssError> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|source| WssError::Bind { addr, source })?;
    run_with_listener(listener, state).await
}

/// Serve on an already-bound listener. Public so integration tests can
/// hold the port from allocation through serving — no drop-then-rebind
/// race, no sleep waiting for the server to come up. Production callers
/// go through `run(addr, state)` which binds first, then delegates here.
pub async fn run_with_listener(
    listener: TcpListener,
    state: Arc<ServerState>,
) -> Result<(), WssError> {
    let addr = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
    // Loud dev-only warning so anyone reading the terminal knows this
    // server is exposed to the LAN over plain WebSocket. TLS is served
    // separately via `run_with_tls`; this plain path stays available for
    // integration tests and for a dev-only escape hatch when TLS makes
    // debugging harder.
    eprintln!(
        "[wss] listening on ws://{addr} — LAN-exposed, dev only, no TLS. \
         Token in the companion-dev.json config file"
    );

    let app = Router::new()
        .route("/stream", get(handle_stream_upgrade))
        .with_state(state);
    // `into_make_service_with_connect_info::<SocketAddr>()` is what
    // lets the /stream handler pull the peer address via
    // `ConnectInfo<SocketAddr>` for accept-time logging.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

/// Serve the WSS router over TLS using axum-server + tokio-rustls.
/// Called from lib.rs::run when `auth.tls_enabled` is true. Mobile
/// clients connect via `wss://` and their TLS stack accepts the
/// self-signed cert either through user trust (dev client) or through
/// platform local-network exceptions
/// (`NSAllowsLocalNetworking` on iOS, network security config on
/// Android). Production callers bind their addr here; integration tests
/// bind an ephemeral port themselves and hand it to
/// `run_with_tls_from_listener` — same drop-then-rebind-race avoidance
/// as the plain-TCP `run_with_listener`.
pub async fn run_with_tls(
    addr: SocketAddr,
    state: Arc<ServerState>,
    tls_config: Arc<axum_server::tls_rustls::RustlsConfig>,
) -> Result<(), WssError> {
    let listener = std::net::TcpListener::bind(addr)
        .map_err(|source| WssError::Bind { addr, source })?;
    run_with_tls_from_listener(listener, state, tls_config).await
}

/// TLS variant of `run_with_listener`: serve on an already-bound
/// blocking `std::net::TcpListener`. axum-server's `from_tcp_rustls`
/// takes ownership and converts it to non-blocking internally. Public
/// so integration tests can drive the TLS path without racing on port
/// allocation.
pub async fn run_with_tls_from_listener(
    listener: std::net::TcpListener,
    state: Arc<ServerState>,
    tls_config: Arc<axum_server::tls_rustls::RustlsConfig>,
) -> Result<(), WssError> {
    let addr = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
    eprintln!(
        "[wss] listening on wss://{addr} — LAN-exposed with self-signed \
         TLS. Fingerprint reachable via get_tls_fingerprint Tauri command"
    );
    let app = Router::new()
        .route("/stream", get(handle_stream_upgrade))
        .with_state(state);
    axum_server::from_tcp_rustls(listener, (*tls_config).clone())
        .serve(app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .map_err(WssError::Serve)?;
    Ok(())
}

/// axum handler for `/stream`. Just performs the WebSocket upgrade and
/// hands off to `connection_task`; all the interesting logic lives there.
///
/// The eprintln! log at the entry is a diagnostic hook for the pairing
/// smoke: if this line does NOT appear when a phone tries to connect,
/// the TLS handshake or TCP path failed before axum saw the request
/// (usually iOS rejecting the self-signed cert). Confirmed reach means
/// the failure is inside the auth flow itself.
async fn handle_stream_upgrade(
    State(state): State<Arc<ServerState>>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    eprintln!("[wss] /stream upgrade requested from {peer}");
    ws.on_upgrade(move |socket| connection_task(socket, state))
}

/// Per-connection lifecycle. Reads frames, dispatches them, pushes
/// replies. Three auth branches:
///
/// - `PAIRING:<pairing_token>`: pair-mode. Server consumes the pairing
///   token, waits for one `PairingStart` frame carrying the mobile's
///   device metadata, mints a long-lived device token, sends
///   `PairingComplete`, and closes. Mobile then reconnects with the
///   new token for normal session mode.
/// - Any other token that matches `paired_tokens.check_and_touch`:
///   normal session mode. Auth-ok + Projects push + dispatch loop.
///   Connection tagged with the device_id so Revoke can force-close.
/// - Fallback: `auth_stub.check` (dev bearer token). Same session-mode
///   flow, but not tagged with a device_id. This branch retires when
///   the dev stub goes away.
async fn connection_task(mut socket: WebSocket, state: Arc<ServerState>) {
    let connection_id = NEXT_CONNECTION_ID
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    // Step 1: read the auth frame.
    let auth_frame = match read_frame(&mut socket).await {
        Ok(Some(f)) => f,
        Ok(None) => return,
        Err(e) => {
            eprintln!("[wss] read auth frame failed: {e}");
            return;
        }
    };

    let token = match auth_frame {
        ClientFrame::Auth { token } => token,
        other => {
            let _ = send_frame(
                &mut socket,
                &ServerFrame::AuthFail {
                    reason: format!(
                        "expected Auth as first frame, got {}",
                        first_op_name(&other)
                    ),
                },
            )
            .await;
            return;
        }
    };

    // Step 2: dispatch to the right auth branch.
    if let Some(pairing_token) = token.strip_prefix(PAIRING_PREFIX) {
        pairing_flow(socket, &state, pairing_token).await;
        return;
    }

    let (session_device_name, device_id) =
        match state.paired_tokens.check_and_touch(&token, None) {
            Some(dev) => (dev.device_name.clone(), Some(dev.id.clone())),
            None => {
                if state.auth.check(&token) {
                    (state.auth.device_name.clone(), None)
                } else {
                    let _ = send_frame(
                        &mut socket,
                        &ServerFrame::AuthFail {
                            reason: "bad token".to_string(),
                        },
                    )
                    .await;
                    return;
                }
            }
        };

    // Step 3: auth-ok + immediate Projects push.
    if send_frame(
        &mut socket,
        &ServerFrame::AuthOk {
            device_name: session_device_name,
        },
    )
    .await
    .is_err()
    {
        return;
    }
    let projects = state.projects_cache.projects_with_spawn_status(&state.pty_map);
    if send_frame(&mut socket, &ServerFrame::Projects { data: projects })
        .await
        .is_err()
    {
        return;
    }

    // Step 4: enter the frame dispatch loop.
    //
    // Per-connection state:
    // - `outbox_tx` / `outbox_rx` is the mpsc the StreamHub pushes
    //   Bytes/Snapshot frames onto (Remote subscribers each own an
    //   outbox clone). The main select! below drains outbox_rx onto
    //   the WebSocket alongside handling client frames.
    // - `subscriptions` tracks the SubscriberId per tab_id so
    //   Unsubscribe / disconnect can clean up hub state.
    // - `changes` fires whenever the tab inventory mutates
    //   (open_tab, close_tab, respawn_in_place). We push a fresh
    //   Projects frame to the outbox in response so the mobile UI's
    //   tab tree stays live-synced with the desktop's.
    let (outbox_tx, mut outbox_rx) = mpsc::unbounded_channel::<ServerFrame>();
    let mut subscriptions: HashMap<String, SubscriberId> = HashMap::new();
    let mut changes = state.projects_cache.subscribe_changes();
    changes.mark_unchanged();

    // Revoke abort signal. Wired for paired connections (sender lives
    // inside PairedConnMap; Revoke fires it). Dev-stub connections
    // get a sender they hold locally in `_dev_stub_sender_keepalive`
    // so the receiver never resolves during a legitimate session and
    // the select! branch stays Pending. Dropping `_keepalive` on
    // function exit is fine because we're already leaving the loop.
    let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
    let _dev_stub_sender_keepalive: Option<tokio::sync::oneshot::Sender<()>> =
        match device_id.as_ref() {
            Some(id) => {
                state.paired_conns.register(id.clone(), connection_id, abort_tx);
                None
            }
            None => Some(abort_tx),
        };

    loop {
        tokio::select! {
            biased;

            // Revoke fires (Ok(())). A dropped sender (Err) is a bug
            // path we do not model in-loop: for dev-stub connections
            // the sender is held locally so this never happens; for
            // paired connections a drop-without-signal would only
            // occur if the caller misused the API. Both errors and
            // successful revokes tear the connection down.
            _ = &mut abort_rx => {
                let _ = send_frame(
                    &mut socket,
                    &ServerFrame::AuthFail { reason: "revoked".into() },
                )
                .await;
                break;
            }

            // Client → server: read a frame, dispatch.
            incoming = read_frame(&mut socket) => {
                let frame = match incoming {
                    Ok(Some(f)) => f,
                    Ok(None) => break,
                    Err(e) => {
                        eprintln!("[wss] read error: {e}");
                        break;
                    }
                };
                dispatch_client_frame(
                    frame,
                    &state,
                    &outbox_tx,
                    &mut subscriptions,
                    connection_id,
                )
                .await;
            }

            // Server → client: outbox drained onto the WebSocket. The
            // outbox_tx clone in `subscriptions` keeps this alive; when
            // all clones drop (i.e. connection torn down), this branch
            // returns None and the select! moves on. We break in that
            // case so the connection cleanly closes.
            frame = outbox_rx.recv() => {
                let Some(frame) = frame else { break };
                if send_frame(&mut socket, &frame).await.is_err() {
                    break;
                }
            }

            // ProjectsCache changed (React synced a fresh $projects
            // via sync_projects_to_wss, or a cold-start load ran).
            // Re-read the tree and enqueue a fresh Projects frame.
            // Any send error on `changed().await` means the sender
            // has been dropped — impossible in practice (cache is
            // long-lived) but treat as a clean exit anyway.
            change = changes.changed() => {
                if change.is_err() { break; }
                let projects = state.projects_cache.projects_with_spawn_status(&state.pty_map);
                let _ = outbox_tx.send(ServerFrame::Projects { data: projects });
            }
        }
    }

    // Cleanup. Deregister the paired-conn entry so revoke doesn't
    // signal a dead sender on the next iteration. Reap CRUD inboxes,
    // drop subscriptions.
    if let Some(id) = device_id.as_ref() {
        state.paired_conns.deregister(id, connection_id);
    }
    state.mobile_op_inboxes.reap_connection(connection_id);
    for (tab_id, sub_id) in subscriptions {
        state.hub.unsubscribe(&tab_id, sub_id);
    }
}

/// Handle the `PAIRING:` sub-flow. The auth path already validated the
/// pairing token via `PairingWindow::consume`. Here we send AuthOk
/// with a "Pairing" placeholder, wait for exactly one PairingStart
/// frame (60s timeout so a phone that camera-scans and never taps the
/// confirm button doesn't leak a connection), mint the long-lived
/// device token, send PairingComplete, then close.
async fn pairing_flow(mut socket: WebSocket, state: &Arc<ServerState>, pairing_token: &str) {
    // Validate up-front but do NOT burn: `paired_tokens.insert` can
    // fail (e.g. transient keychain refusal on the dev macOS build)
    // and burning the token before the insert would strand the user
    // — they would have to reopen the desktop Companion dialog for a
    // fresh QR just to retry the same keychain write. The token is
    // consumed only after a successful insert below.
    if let Err(e) = state.pairing_window.validate(pairing_token) {
        let reason = match e {
            PairingError::NoOpenWindow => "no pairing window open on desktop",
            PairingError::Expired => "pairing window expired, reopen on desktop",
            PairingError::Mismatch => "pairing token mismatch",
        };
        let _ = send_frame(
            &mut socket,
            &ServerFrame::AuthFail {
                reason: reason.to_string(),
            },
        )
        .await;
        return;
    }

    // Signal to the mobile that pair mode is active. Device name is a
    // placeholder; the actual device metadata arrives in PairingStart.
    if send_frame(
        &mut socket,
        &ServerFrame::AuthOk {
            device_name: "Pairing".to_string(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    // Wait for the PairingStart frame with a bounded timeout. The
    // 60s window is generous compared to the "user taps Confirm"
    // path (typically ~1s after camera scan).
    let next = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        read_frame(&mut socket),
    )
    .await;
    let frame = match next {
        Ok(Ok(Some(f))) => f,
        Ok(Ok(None)) => return, // client closed
        Ok(Err(e)) => {
            eprintln!("[wss] pairing read error: {e}");
            return;
        }
        Err(_) => {
            // Reason string carries "timeout" verbatim so the mobile
            // client's `mapPairErrorFromException` substring match
            // routes to its dedicated timeout UI state instead of the
            // generic connection-failed fallback.
            let _ = send_frame(
                &mut socket,
                &ServerFrame::AuthFail {
                    reason: "pairing_start timeout: not received within 60s".to_string(),
                },
            )
            .await;
            return;
        }
    };

    let (op_id, body) = match frame {
        ClientFrame::PairingStart { op_id, body } => (op_id, body),
        other => {
            let _ = send_frame(
                &mut socket,
                &ServerFrame::AuthFail {
                    reason: format!(
                        "expected pairing_start, got {}",
                        first_op_name(&other)
                    ),
                },
            )
            .await;
            return;
        }
    };

    let info = crate::pairing::DeviceInfo {
        device_name: body.device_name,
        platform: body.platform,
        model: body.model,
    };
    let (device_id, device_token) = match state.paired_tokens.insert(info) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[wss] pairing insert failed: {e}");
            let _ = send_frame(
                &mut socket,
                &ServerFrame::AuthFail {
                    reason: format!("keychain write failed: {e}"),
                },
            )
            .await;
            // Leave the pair window intact; validate-not-consume above
            // means the token is still live and the user can retry
            // without reopening the desktop dialog.
            return;
        }
    };
    // Insert succeeded, burn the pair token now.
    if let Err(e) = state.pairing_window.consume(pairing_token) {
        // Race: another client burned it between our validate and
        // this consume. Log for diagnostics; the paired device is
        // still inserted, so this connection continues to
        // PairingComplete. Practical impact zero for a single-user
        // desktop.
        eprintln!("[wss] pair window burn lost a race: {e:?}");
    }

    // Notify the desktop UI so the paired-devices list refreshes.
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit(
            "pairing:complete",
            serde_json::json!({ "device_id": &device_id }),
        );
    }

    let _ = send_frame(
        &mut socket,
        &ServerFrame::PairingComplete {
            op_id,
            body: PairingCompleteBody {
                device_token,
                device_id,
            },
        },
    )
    .await;
    // Connection closes as this task returns. The mobile client
    // reconnects with the new device_token for normal session mode.
}

/// Route a single ClientFrame to its handler. Kept as a standalone
/// function so the main connection_task select! stays legible.
async fn dispatch_client_frame(
    frame: ClientFrame,
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    subscriptions: &mut HashMap<String, SubscriberId>,
    connection_id: u64,
) {
    match frame {
        // The main auth path already handled the first Auth frame. A
        // second one is a protocol error but not worth tearing down for
        // — silently ignore.
        ClientFrame::Auth { .. } => {}

        ClientFrame::Subscribe { tab_id, scrollback } => {
            // Auto-spawn: mobile clients see every tab the desktop knows
            // about, including sleeping ones. Tapping a sleeping tab
            // lands here with no PtyHandle in the map. Create one from
            // the cache's TabSummary metadata so mobile can drive the
            // shell without the desktop having to visit the tab first.
            //
            // cwd chain: TabSummary.last_cwd (OSC 7-derived, persisted)
            // → TabSummary.cwd → spawn_pty's HOME default. Shell comes
            // from `cmd` when set, matching desktop's semantics.
            //
            // We do NOT gate on `pty_map.contains_key` here — a
            // just-died reader thread leaves the entry present with
            // `reader_alive=false`, and spawn_pty_if_absent's internal
            // check handles both "healthy PTY, skip" and "zombie entry,
            // respawn" correctly. Duplicating the check outside the
            // helper would miss the zombie case.
            if let (Some(app), Some(tab)) = (
                state.app_handle.as_ref(),
                state.projects_cache.find_tab(&tab_id),
            ) {
                // Desktop's addTab initializes `cmd: ''` for every new
                // tab; that arrives here as Some("") which spawn_pty
                // would try to run as the shell path, spawning an empty
                // command that crashes on write and hits the reader
                // thread's respawn-rate limit within seconds. Normalise
                // empty strings to None so spawn_pty falls back to
                // $SHELL / /bin/zsh — matching the desktop open_tab
                // path, which never passes `shell` at all.
                let cwd = tab
                    .last_cwd
                    .clone()
                    .or_else(|| tab.cwd.clone())
                    .filter(|s| !s.is_empty());
                let shell = tab.cmd.clone().filter(|s| !s.is_empty());
                match spawn_pty_if_absent(
                    app.clone(),
                    &state.pty_map,
                    state.mod_engine_handle.clone(),
                    state.cwd_table.clone(),
                    Arc::clone(&state.hub),
                    Some(Arc::clone(&state.projects_cache)),
                    tab_id.clone(),
                    cwd,
                    shell,
                ) {
                    Ok(true) => {
                        // is_spawned overlay just flipped for this
                        // tab; broadcast so every mobile client sees
                        // the change in the next Projects push.
                        state.projects_cache.notify_spawn_change();
                    }
                    Ok(false) => {}
                    Err(e) => eprintln!("[wss] auto-spawn {tab_id} failed: {e}"),
                }
            }

            // Drop any prior subscription on the same tab first so we
            // don't leak SubscriberIds if a client re-subscribes.
            if let Some(prev) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, prev);
            }
            // subscribe_remote returns None if the outbox closed during
            // initial Snapshot / ring replay. Nothing to track; the
            // connection is about to unwind on its own.
            if let Some(id) = state
                .hub
                .subscribe_remote(&tab_id, outbox_tx.clone(), scrollback)
                .await
            {
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Resume {
            tab_id,
            scrollback,
            last_seq,
        } => {
            if let Some(prev) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, prev);
            }
            if let Some(id) = state
                .hub
                .resume_remote(&tab_id, outbox_tx.clone(), last_seq, scrollback)
                .await
            {
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Unsubscribe { tab_id } => {
            if let Some(id) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, id);
            }
        }

        ClientFrame::Write { tab_id, data } => {
            // Look up the PtyHandle and write bytes to its master.
            // Matches `commands::write_pty` behaviour byte-for-byte:
            // silently no-op if the tab is already closed, then feed
            // the mod engine.
            let bytes = data.into_bytes();
            {
                let mut map = state.pty_map.lock().expect("pty_map lock poisoned");
                if let Some(handle) = map.get_mut(&tab_id) {
                    if let Err(e) = handle.writer.write_all(&bytes) {
                        eprintln!("[wss] write to {tab_id} failed: {e}");
                    }
                }
            }
            state.mod_engine_handle.on_input(&tab_id, bytes);
        }

        ClientFrame::Resize {
            tab_id,
            cols,
            rows,
        } => {
            {
                let map = state.pty_map.lock().expect("pty_map lock poisoned");
                if let Some(handle) = map.get(&tab_id) {
                    if let Err(e) = handle.master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    }) {
                        eprintln!("[wss] resize {tab_id} failed: {e}");
                    }
                }
            }
            state.mod_engine_handle.on_resize(&tab_id, cols, rows);
            // Keep the sidecar's shadow xterm in step so a subsequent
            // Snapshot from a re-subscribing client sees the right
            // dimensions.
            state.hub.resize_tab(&tab_id, cols, rows);
        }

        ClientFrame::Ping => {
            let _ = outbox_tx.send(ServerFrame::Pong);
        }

        // -------- Phase B: mobile-driven CRUD --------
        //
        // Every arm follows the same shape:
        //   1. Reject if the projects cache has not been hydrated by
        //      React yet (cold-start window).
        //   2. Reject if we have no AppHandle (integration test env).
        //   3. Register this connection's outbox for the op_id BEFORE
        //      firing the Tauri event so a fast React error report can
        //      find us.
        //   4. Emit `wss:mobile_op` for React to consume.
        //
        // Success path: React applies the mutation via a $projects
        // store action, then reports it back through the
        // `report_mobile_op_ok` Tauri command. That routes an
        // `OpOk { op_id }` frame through this connection's outbox so
        // the mobile sender's pending promise resolves. persist() also
        // syncs the fresh tree to the cache which broadcasts a Projects
        // frame to every connected client, so the mobile view updates
        // in state around the same instant.
        ClientFrame::CreateProject { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "create_project", &body);
        }
        ClientFrame::CreateTab { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "create_tab", &body);
        }
        ClientFrame::RenameProject { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "rename_project", &body);
        }
        ClientFrame::RenameTab { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "rename_tab", &body);
        }
        ClientFrame::RemoveProject { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "remove_project", &body);
        }
        ClientFrame::RemoveTab { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "remove_tab", &body);
        }
        ClientFrame::ReorderTabs { op_id, body } => {
            dispatch_mobile_op(&state, &outbox_tx, connection_id, op_id, "reorder_tabs", &body);
        }

        // Pairing frames only arrive inside the `pairing_flow` sub-
        // task; a PairingStart received here is a protocol confusion
        // (session-mode connection sending a pair frame). Bounce back
        // an OpError so the mobile side can see the mistake.
        ClientFrame::PairingStart { op_id, .. } => {
            let _ = outbox_tx.send(ServerFrame::OpError {
                op_id,
                reason: "pairing_start only valid on PAIRING: connections".to_string(),
            });
        }
    }
}

/// Shared plumbing for the seven CRUD arms. Serialises the body,
/// runs the hydration + app-handle checks, registers the outbox for
/// the op_id, and emits the Tauri event React listens for.
fn dispatch_mobile_op<T: serde::Serialize>(
    state: &ServerState,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    connection_id: u64,
    op_id: u64,
    op: &'static str,
    body: &T,
) {
    if !state.projects_cache.is_hydrated() {
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "desktop $projects still hydrating, retry in a moment"
                .to_string(),
        });
        return;
    }
    let Some(app) = state.app_handle.as_ref() else {
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "app handle unavailable (integration test env)".to_string(),
        });
        return;
    };
    // Register the outbox BEFORE emitting the event so a fast React
    // error report can find us. Key by (connection_id, op_id) so two
    // mobile clients each starting their op_id counter at 1 do not
    // overwrite each other's outbox pointer.
    state
        .mobile_op_inboxes
        .0
        .lock()
        .expect("mobile_op_inboxes lock poisoned")
        .insert((connection_id, op_id), outbox_tx.clone());
    let payload = serde_json::json!({
        "op": op,
        "connection_id": connection_id,
        "op_id": op_id,
        "body": body,
    });
    if let Err(e) = app.emit("wss:mobile_op", payload) {
        // Emission failed: reap the inbox and bounce back an error.
        state
            .mobile_op_inboxes
            .0
            .lock()
            .expect("mobile_op_inboxes lock poisoned")
            .remove(&(connection_id, op_id));
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: e.to_string(),
        });
    }
}

/// Read the next text/binary frame as a ClientFrame. Returns `Ok(None)`
/// on a clean close. Ignores WebSocket Ping/Pong control frames (axum
/// handles those transparently but the loop still sees them).
async fn read_frame(socket: &mut WebSocket) -> Result<Option<ClientFrame>, ReadFrameError> {
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                let frame: ClientFrame = serde_json::from_str(text.as_str())
                    .map_err(ReadFrameError::BadJson)?;
                return Ok(Some(frame));
            }
            Some(Ok(Message::Binary(bytes))) => {
                let frame: ClientFrame = serde_json::from_slice(&bytes)
                    .map_err(ReadFrameError::BadJson)?;
                return Ok(Some(frame));
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(_))) | None => return Ok(None),
            Some(Err(e)) => return Err(ReadFrameError::Socket(e.to_string())),
        }
    }
}

#[derive(Debug, Error)]
enum ReadFrameError {
    #[error("bad json: {0}")]
    BadJson(#[from] serde_json::Error),
    #[error("socket: {0}")]
    Socket(String),
}

/// Serialise and send a ServerFrame as a text WebSocket message.
async fn send_frame(socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), axum::Error> {
    let json = serde_json::to_string(frame).expect("ServerFrame must always serialise");
    socket.send(Message::Text(json.into())).await
}

/// Human-readable variant name for the "expected Auth" error message.
fn first_op_name(frame: &ClientFrame) -> &'static str {
    match frame {
        ClientFrame::Auth { .. } => "auth",
        ClientFrame::Subscribe { .. } => "subscribe",
        ClientFrame::Resume { .. } => "resume",
        ClientFrame::Unsubscribe { .. } => "unsubscribe",
        ClientFrame::Write { .. } => "write",
        ClientFrame::Resize { .. } => "resize",
        ClientFrame::Ping => "ping",
        ClientFrame::CreateProject { .. } => "create_project",
        ClientFrame::CreateTab { .. } => "create_tab",
        ClientFrame::RenameProject { .. } => "rename_project",
        ClientFrame::RenameTab { .. } => "rename_tab",
        ClientFrame::RemoveProject { .. } => "remove_project",
        ClientFrame::RemoveTab { .. } => "remove_tab",
        ClientFrame::ReorderTabs { .. } => "reorder_tabs",
        ClientFrame::PairingStart { .. } => "pairing_start",
    }
}
