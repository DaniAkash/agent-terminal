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
use crate::protocol::{
    ClientFrame,
    PairingCompleteBody,
    RegisterPushBody,
    ServerFrame,
};
use tauri::Emitter;
use crate::pty_manager::{spawn_pty_if_absent, PtyMap};
use crate::stream_hub::{StreamHub, SubscriberId, Viewport};
use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
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
    /// Pending pairing approval requests waiting for user approval.
    pub pairing_approvals: Arc<crate::pairing::PairingApprovals>,
    /// Active mobile tab subscriptions for sidebar indicator awareness.
    pub mobile_tab_subs: Arc<MobileTabSubscriptions>,
    /// Phone escalation. `Option` so integration tests can build a
    /// ServerState without a Tauri runtime, matching `app_handle`.
    pub push: Option<Arc<crate::push::PushService>>,
}

/// Push token registration. One idempotent upsert covering the token
/// and the per-device preferences, because `RegisterPush` carries both
/// and the phone re-sends it on every connect as well as every
/// preference change.
fn handle_register_push(
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    op_id: u64,
    device_id: Option<&str>,
    body: RegisterPushBody,
) {
    // The legacy dev bearer token has no paired-device record, so there
    // is nowhere to hang a push token. Reject rather than silently
    // succeeding, or the phone shows a toggle that does nothing.
    let Some(device_id) = device_id else {
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "this session is not a paired device".to_string(),
        });
        return;
    };

    // Reject anything that is not an Expo token outright. A malformed
    // token is a silent dead end otherwise: every send fails and the
    // user sees a switch that is on and does nothing.
    if !body.token.starts_with("ExponentPushToken[") && !body.token.starts_with("ExpoPushToken[") {
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "malformed push token".to_string(),
        });
        return;
    }

    // Clamp rather than reject. A delay outside the range from a future
    // companion build should degrade to something sane, not disable the
    // feature with an error the user cannot act on.
    match state.paired_tokens.set_push_registration(
        device_id,
        &body.token,
        &body.platform,
        body.delay_seconds,
        body.redact_names,
    ) {
        Ok(true) => {}
        Ok(false) => {
            let _ = outbox_tx.send(ServerFrame::OpError {
                op_id,
                reason: "unknown device".to_string(),
            });
            return;
        }
        Err(e) => {
            eprintln!("[wss] push registration persist failed: {e}");
            let _ = outbox_tx.send(ServerFrame::OpError {
                op_id,
                reason: "could not store push registration".to_string(),
            });
            return;
        }
    }

    // Never log the token itself: it is a send capability. The prefix
    // is enough to tell an Expo token from a malformed one in a log.
    eprintln!(
        "[wss] push registered device={device_id} platform={} delay={}s redact={}",
        body.platform, body.delay_seconds, body.redact_names
    );

    if let Some(push) = state.push.as_ref() {
        push.devices_changed(device_id);
    }
    let _ = outbox_tx.send(ServerFrame::OpOk { op_id });
    send_push_status(state, outbox_tx, device_id);
}

fn handle_unregister_push(
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    op_id: u64,
    device_id: Option<&str>,
) {
    let Some(device_id) = device_id else {
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "this session is not a paired device".to_string(),
        });
        return;
    };
    // A persistence failure cannot be reported as success. The phone
    // would show push as off while the token is still live on this Mac,
    // which is the one disagreement the user cannot see and cannot fix:
    // notifications keep arriving from a switch that reads as off.
    if let Err(e) = state.paired_tokens.clear_push_token(device_id) {
        eprintln!("[wss] clearing push token failed: {e}");
        let _ = outbox_tx.send(ServerFrame::OpError {
            op_id,
            reason: "could not clear push registration".to_string(),
        });
        return;
    }
    if let Some(push) = state.push.as_ref() {
        push.devices_changed(device_id);
    }
    let _ = outbox_tx.send(ServerFrame::OpOk { op_id });
    send_push_status(state, outbox_tx, device_id);
}

/// Capability advertisement plus the stored preferences.
///
/// Sent unprompted right after AuthOk, and that is not a convenience.
/// The desktop closes the whole WebSocket when it cannot deserialise a
/// ClientFrame (`read_frame` maps the serde failure to BadJson and the
/// read loop breaks), so a newer companion that sent RegisterPush blind
/// would disconnect the terminal stream against any older Mac app, on
/// every connect. The phone waits for this frame before registering.
pub fn send_push_status(
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    device_id: &str,
) {
    let d = state.paired_tokens.get(device_id);
    let _ = outbox_tx.send(ServerFrame::PushStatus {
        supported: true,
        registered: d.as_ref().and_then(|d| d.push_token.as_ref()).is_some(),
        delay_seconds: d
            .as_ref()
            .map(|d| d.push_delay_seconds)
            .unwrap_or(crate::push::DEFAULT_DELAY_SECONDS),
        redact_names: d.as_ref().map(|d| d.push_redact_names).unwrap_or(false),
        last_error: d.and_then(|d| d.push_last_error),
    });
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

    tokio::spawn(sweep_mobile_presence(Arc::clone(&state)));
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
/// Mobile clients connect via `wss://` and their native PinnedWebSocket
/// module verifies the leaf cert's SHA-256 against the fingerprint the
/// QR carried. Production callers bind their addr here; integration
/// tests bind an ephemeral port themselves and hand it to
/// `run_with_tls_from_listener`, avoiding the same drop-then-rebind
/// race as the plain-TCP `run_with_listener`.
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
    tokio::spawn(sweep_mobile_presence(Arc::clone(&state)));
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
/// Debug builds emit an accept-time log line per upgrade attempt as a
/// diagnostic hook: if it does not appear when a phone tries to
/// connect, the TLS handshake failed before axum saw the request. In
/// release builds the log is compiled out so a busy production terminal
/// does not spew a line per connection.
async fn handle_stream_upgrade(
    State(state): State<Arc<ServerState>>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    #[cfg(debug_assertions)]
    eprintln!("[wss] /stream upgrade requested from {peer}");
    ws.on_upgrade(move |socket| connection_task(socket, state, peer))
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
async fn connection_task(
    mut socket: WebSocket,
    state: Arc<ServerState>,
    peer: SocketAddr,
) {
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
        pairing_flow(socket, &state, pairing_token, peer).await;
        return;
    }

    // Feed the peer IP into `check_and_touch` so `PairedDevice.last_ip`
    // reflects the source the token was most recently used from. The
    // Companion dialog surfaces this for troubleshooting; without
    // this thread-through it stays `None` forever.
    let peer_ip = peer.ip().to_string();
    // `greeting_name` goes back to the phone in AuthOk. `device_name` is
    // what the desktop calls the phone. They are the same for a paired
    // device. A dev-token session has no record of the phone, and its
    // AuthOk carries the desktop's own name, which must not label the
    // phone in the desktop UI.
    let (greeting_name, device_name, device_id, platform, model) =
        match state.paired_tokens.check_and_touch(&token, Some(peer_ip.clone())) {
            Some(dev) => (
                dev.device_name.clone(),
                dev.device_name,
                Some(dev.id),
                dev.platform,
                dev.model,
            ),
            None if state.auth.check(&token) => (
                state.auth.device_name.clone(),
                "Mobile device".to_string(),
                None,
                "mobile".to_string(),
                None,
            ),
            None => {
                let _ = send_frame(
                    &mut socket,
                    &ServerFrame::AuthFail {
                        reason: "bad token".to_string(),
                    },
                )
                .await;
                return;
            }
        };
    let subscriber_info = MobileSubscriberInfo {
        connection_id,
        device_id: device_id.clone(),
        device_name,
        platform,
        model,
        peer_ip: Some(peer_ip),
        status: MobilePresenceStatus::Online,
        last_active_at: crate::usage::now(),
    };

    // Step 3: auth-ok + immediate Projects push.
    if send_frame(
        &mut socket,
        &ServerFrame::AuthOk {
            device_name: greeting_name,
        },
    )
    .await
    .is_err()
    {
        return;
    }
    // Push capability advertisement, before anything else the client
    // might act on. The phone gates RegisterPush on seeing this: an
    // older desktop cannot deserialise that variant and closes the
    // whole session on the attempt, so registering blind would break
    // terminal streaming rather than merely failing to register.
    //
    // Only for paired devices. A legacy dev-token session has no
    // device record to hang a token on, and telling it push is
    // available would be a lie it could act on.
    if let Some(id) = device_id.as_deref() {
        let d = state.paired_tokens.get(id);
        let status = ServerFrame::PushStatus {
            supported: true,
            registered: d.as_ref().and_then(|d| d.push_token.as_ref()).is_some(),
            delay_seconds: d
                .as_ref()
                .map(|d| d.push_delay_seconds)
                .unwrap_or(crate::push::DEFAULT_DELAY_SECONDS),
            redact_names: d.as_ref().map(|d| d.push_redact_names).unwrap_or(false),
            last_error: d.and_then(|d| d.push_last_error),
        };
        if send_frame(&mut socket, &status).await.is_err() {
            return;
        }
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

    // Liveness. A phone that drops off the network sends no close, so the
    // socket would look open until the OS gives up on it, and the desktop
    // would show a dead phone as present. Ping it and expect traffic back.
    let liveness = Liveness::new();
    let mut liveness_tick = tokio::time::interval_at(
        tokio::time::Instant::now() + LIVENESS_PING_EVERY,
        LIVENESS_PING_EVERY,
    );
    liveness_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

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
            incoming = read_frame_live(&mut socket, &liveness) => {
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
                    device_id.as_deref(),
                    &subscriber_info,
                )
                .await;
            }

            // Ahead of the outbox so a busy terminal cannot starve it.
            _ = liveness_tick.tick() => {
                if liveness.is_dead(std::time::Instant::now()) {
                    eprintln!("[wss] connection {connection_id} went silent; closing");
                    break;
                }
                let ping = socket.send(Message::Ping(Default::default()));
                if !matches!(within_send_timeout(ping).await, Some(Ok(()))) {
                    break;
                }
            }

            // Server → client: outbox drained onto the WebSocket. The
            // outbox_tx clone in `subscriptions` keeps this alive; when
            // all clones drop (i.e. connection torn down), this branch
            // returns None and the select! moves on. We break in that
            // case so the connection cleanly closes.
            frame = outbox_rx.recv() => {
                let Some(frame) = frame else { break };
                let sent = within_send_timeout(send_frame(&mut socket, &frame)).await;
                if !matches!(sent, Some(Ok(()))) {
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
    emit_mobile_subscriptions(&state, state.mobile_tab_subs.remove_connection(connection_id));
    for (tab_id, sub_id) in subscriptions {
        state.hub.unsubscribe(&tab_id, sub_id);
    }
}

/// Handle the `PAIRING:` sub-flow. The auth path stripped the prefix
/// and handed us the raw token; here we validate it against the
/// currently-open `PairingWindow` (peek without burn — see
/// `PairingWindow::validate`), send AuthOk with a "Pairing"
/// placeholder, wait for exactly one PairingStart frame (60s timeout
/// so a phone that camera-scans and never taps the confirm button
/// doesn't leak a connection), mint the long-lived device token via
/// `paired_tokens.insert`, and only then `consume` (burn) the pair
/// token. This validate-then-consume ordering keeps the pair window
/// alive across a transient insert failure (e.g. macOS Keychain
/// permission prompt on first-run refuses the write) so the mobile
/// can retry the same token without the user reopening the desktop
/// dialog. Ends with a PairingComplete + close.
async fn pairing_flow(
    mut socket: WebSocket,
    state: &Arc<ServerState>,
    pairing_token: &str,
    peer: SocketAddr,
) {
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

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.pairing_approvals.register(request_id.clone(), tx);

    // Ask the desktop UI to approve (dialog + toast notification).
    emit_event(
        state,
        "pairing:request_approval",
        serde_json::json!({
            "request_id": &request_id,
            "device_name": &body.device_name,
            "platform": &body.platform,
            "model": &body.model,
            // Where the request came from, so the person approving can
            // tell their phone (and its route) from someone else's.
            "peer_ip": peer.ip().to_string(),
        }),
    );

    // Wait for the desktop's answer, and watch the socket meanwhile: a
    // phone that gave up must not leave a request the user can still
    // approve, because that would store a device whose token was never
    // delivered.
    let deadline = tokio::time::sleep(PAIRING_APPROVAL_TIMEOUT);
    tokio::pin!(deadline);
    let mut rx = rx;
    let outcome = loop {
        tokio::select! {
            answer = &mut rx => break match answer {
                Ok(true) => ApprovalOutcome::Approved,
                Ok(false) => ApprovalOutcome::Declined,
                // Sender dropped: superseded by a newer request, or the
                // pairing window was closed or replaced.
                Err(_) => ApprovalOutcome::Canceled,
            },
            _ = &mut deadline => break ApprovalOutcome::TimedOut,
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                    break ApprovalOutcome::ClientGone
                }
                Some(Ok(_)) => {}
            },
        }
    };
    state.pairing_approvals.remove(&request_id);
    if let Some(reason) = outcome.closed_reason() {
        emit_event(
            state,
            "pairing:approval_closed",
            serde_json::json!({ "request_id": &request_id, "reason": reason }),
        );
    }

    // The window may have been closed or replaced while the request was
    // pending; an approval must not outlive the window it was made under.
    let refusal = match outcome {
        ApprovalOutcome::Approved => (!state.pairing_window.is_token_of_open_window(pairing_token))
            .then_some("pairing_canceled: the pairing window was closed on the desktop"),
        ApprovalOutcome::Declined => Some("pairing_declined: the request was declined on the desktop"),
        ApprovalOutcome::TimedOut => {
            Some("pairing_timeout: the request was not approved on the desktop in time")
        }
        ApprovalOutcome::Canceled => Some("pairing_canceled: the request was canceled on the desktop"),
        ApprovalOutcome::ClientGone => return,
    };
    if let Some(reason) = refusal {
        eprintln!("[wss] pairing request {request_id} refused: {reason}");
        let _ = send_frame(
            &mut socket,
            &ServerFrame::AuthFail {
                reason: reason.to_string(),
            },
        )
        .await;
        return;
    }

    let device_name = body.device_name.clone();
    let info = crate::pairing::DeviceInfo {
        device_name: body.device_name,
        platform: body.platform,
        model: body.model,
        peer_ip: Some(peer.ip().to_string()),
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
    // Insert succeeded, burn the pair token now. An error here means the
    // window's TTL ran out while the user was deciding; the window is
    // cleared either way, and the paired device stands.
    if let Err(e) = state.pairing_window.consume(pairing_token) {
        eprintln!("[wss] pair window not burned: {e:?}");
    }

    // Notify the desktop UI so the paired-devices list refreshes.
    emit_event(
        state,
        "pairing:complete",
        serde_json::json!({
            "device_id": &device_id,
            "device_name": &device_name,
            "peer_ip": peer.ip().to_string(),
        }),
    );

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

/// Make sure a tab a mobile client asked for has a live PTY behind it.
///
/// Mobile clients see every tab the desktop knows about, including
/// sleeping ones, so an ask can land here with no PtyHandle in the map.
/// One is created from the cache's TabSummary metadata so mobile can
/// drive the shell without the desktop having to visit the tab first.
///
/// cwd chain: TabSummary.last_cwd (OSC 7-derived, persisted) →
/// TabSummary.cwd → spawn_pty's HOME default. Shell comes from `cmd`
/// when set, matching desktop's semantics.
///
/// We do NOT gate on `pty_map.contains_key` here. A just-died reader
/// thread leaves the entry present with `reader_alive=false`, and
/// spawn_pty_if_absent's internal check handles both "healthy PTY, skip"
/// and "zombie entry, respawn" correctly. Duplicating the check outside
/// the helper would miss the zombie case.
fn ensure_tab_spawned(state: &Arc<ServerState>, tab_id: &str) {
    let (Some(app), Some(tab)) = (
        state.app_handle.as_ref(),
        state.projects_cache.find_tab(tab_id),
    ) else {
        return;
    };
    // Desktop's addTab initializes `cmd: ''` for every new tab; that
    // arrives here as Some("") which spawn_pty would try to run as the
    // shell path, spawning an empty command that crashes on write and hits
    // the reader thread's respawn-rate limit within seconds. Normalise
    // empty strings to None so spawn_pty falls back to $SHELL / /bin/zsh,
    // matching the desktop open_tab path, which never passes `shell` at
    // all.
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
        tab_id.to_string(),
        cwd,
        shell,
    ) {
        Ok(true) => {
            // is_spawned overlay just flipped for this tab; broadcast so
            // every mobile client sees the change in the next Projects
            // push.
            state.projects_cache.notify_spawn_change();
        }
        Ok(false) => {}
        Err(e) => eprintln!("[wss] auto-spawn {tab_id} failed: {e}"),
    }
}

/// Route a single ClientFrame to its handler. Kept as a standalone
/// function so the main connection_task select! stays legible.
async fn dispatch_client_frame(
    frame: ClientFrame,
    state: &Arc<ServerState>,
    outbox_tx: &mpsc::UnboundedSender<ServerFrame>,
    subscriptions: &mut HashMap<String, SubscriberId>,
    connection_id: u64,
    device_id: Option<&str>,
    subscriber_info: &MobileSubscriberInfo,
) {
    match frame {
        // The main auth path already handled the first Auth frame. A
        // second one is a protocol error but not worth tearing down for
        // — silently ignore.
        ClientFrame::Auth { .. } => {}

        ClientFrame::Subscribe { tab_id, scrollback } => {
            ensure_tab_spawned(state, &tab_id);

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
                emit_mobile_subscriptions(state, state.mobile_tab_subs.add(&tab_id, subscriber_info.clone()));
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Resume {
            tab_id,
            scrollback,
            last_seq,
        } => {
            // A resume is a subscribe that remembers where it was, so it
            // needs the same live tab underneath. A desktop that restarted
            // has every PTY gone while the client still holds a sequence
            // number from the old process: without this it attaches to a
            // tab nothing is writing to, which looks connected, shows an
            // empty snapshot, and silently swallows everything typed.
            ensure_tab_spawned(state, &tab_id);

            if let Some(prev) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, prev);
            }
            if let Some(id) = state
                .hub
                .resume_remote(&tab_id, outbox_tx.clone(), last_seq, scrollback)
                .await
            {
                emit_mobile_subscriptions(state, state.mobile_tab_subs.add(&tab_id, subscriber_info.clone()));
                subscriptions.insert(tab_id, id);
            }
        }

        ClientFrame::Unsubscribe { tab_id } => {
            if let Some(id) = subscriptions.remove(&tab_id) {
                state.hub.unsubscribe(&tab_id, id);
            }
            state.mobile_tab_subs.leave(&tab_id, connection_id);
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

        // A remote client declares the grid it is painting into; it does
        // not command the PTY. The hub weighs the declaration against
        // every other attached client and applies whatever it decides,
        // which is why a phone can no longer squeeze the desktop. A frame
        // for a tab this connection never subscribed to has no subscriber
        // to attribute the viewport to, so it is dropped.
        ClientFrame::Resize {
            tab_id,
            cols,
            rows,
        } => {
            if let Some(sub_id) = subscriptions.get(&tab_id) {
                state
                    .hub
                    .declare_viewport(&tab_id, *sub_id, Viewport { cols, rows });
            }
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

        ClientFrame::RegisterPush { op_id, body } => {
            handle_register_push(state, outbox_tx, op_id, device_id, body);
        }

        ClientFrame::UnregisterPush { op_id } => {
            handle_unregister_push(state, outbox_tx, op_id, device_id);
        }

        ClientFrame::SetTabPinned { op_id, body } => {
            dispatch_mobile_op(state, outbox_tx, connection_id, op_id, "set_tab_pinned", &body);
        }

        ClientFrame::SetProjectPinned { op_id, body } => {
            dispatch_mobile_op(
                state,
                outbox_tx,
                connection_id,
                op_id,
                "set_project_pinned",
                &body,
            );
        }

        ClientFrame::BumpRecency { op_id, body } => {
            dispatch_mobile_op(state, outbox_tx, connection_id, op_id, "bump_recency", &body);
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
    read_frame_live(socket, &Liveness::new()).await
}

/// [`read_frame`] that also records every message from the peer in
/// `liveness`, control frames included.
async fn read_frame_live(
    socket: &mut WebSocket,
    liveness: &Liveness,
) -> Result<Option<ClientFrame>, ReadFrameError> {
    loop {
        let message = socket.recv().await;
        if let Some(Ok(message)) = &message {
            liveness.heard(matches!(message, Message::Pong(_)), std::time::Instant::now());
        }
        match message {
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

/// How often the server pings a connected phone.
const LIVENESS_PING_EVERY: std::time::Duration = std::time::Duration::from_secs(10);

/// Silence after which a phone that answers pings counts as gone. Three
/// missed pings: enough slack for a slow mobile link.
const LIVENESS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Bound one send to the peer by [`LIVENESS_TIMEOUT`]. None when it ran
/// out.
///
/// A phone that drops off the network stops reading. Once the TCP send
/// buffer fills, a send never returns, and the loop that would notice the
/// silence never runs again. A send that cannot finish in this long means
/// the same thing as silence: the peer is gone.
async fn within_send_timeout<F: std::future::Future>(send: F) -> Option<F::Output> {
    tokio::time::timeout(LIVENESS_TIMEOUT, send).await.ok()
}

/// Whether the peer of one connection is still there.
///
/// Atomics, not plain fields, because the reader and the ping timer are
/// two branches of one `select!` and both hold a reference.
struct Liveness {
    started: std::time::Instant,
    /// Milliseconds after `started` at which the peer was last heard.
    last_heard_ms: std::sync::atomic::AtomicU64,
    /// The peer has answered a ping at least once. A client that never
    /// does is not held to the timeout: the server cannot tell its
    /// silence from an idle terminal.
    answers_pings: std::sync::atomic::AtomicBool,
}

impl Liveness {
    fn new() -> Self {
        Self {
            started: std::time::Instant::now(),
            last_heard_ms: std::sync::atomic::AtomicU64::new(0),
            answers_pings: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn heard(&self, is_pong: bool, now: std::time::Instant) {
        use std::sync::atomic::Ordering::Relaxed;
        let ms = now.saturating_duration_since(self.started).as_millis() as u64;
        self.last_heard_ms.store(ms, Relaxed);
        if is_pong {
            self.answers_pings.store(true, Relaxed);
        }
    }

    fn is_dead(&self, now: std::time::Instant) -> bool {
        use std::sync::atomic::Ordering::Relaxed;
        let last_heard =
            self.started + std::time::Duration::from_millis(self.last_heard_ms.load(Relaxed));
        self.answers_pings.load(Relaxed)
            && now.saturating_duration_since(last_heard) >= LIVENESS_TIMEOUT
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
        ClientFrame::SetTabPinned { .. } => "set_tab_pinned",
        ClientFrame::SetProjectPinned { .. } => "set_project_pinned",
        ClientFrame::BumpRecency { .. } => "bump_recency",
        ClientFrame::RegisterPush { .. } => "register_push",
        ClientFrame::UnregisterPush { .. } => "unregister_push",
        ClientFrame::PairingStart { .. } => "pairing_start",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MobilePresenceStatus {
    Online,
    Idle,
}

/// Metadata for a connected mobile companion subscribed to a tab.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MobileSubscriberInfo {
    pub connection_id: u64,
    pub device_id: Option<String>,
    pub device_name: String,
    pub platform: String,
    pub model: Option<String>,
    pub peer_ip: Option<String>,
    pub status: MobilePresenceStatus,
    pub last_active_at: i64,
}

/// Mobile subscribers per tab key, as sent to the desktop UI.
pub type MobileTabsSnapshot = HashMap<String, Vec<MobileSubscriberInfo>>;

/// How long a phone may sit off every terminal (connected, but with no
/// tab open) before it shows as Idle. Long enough that moving from one
/// tab to another never shows as a status change.
const MOBILE_IDLE_AFTER: std::time::Duration = std::time::Duration::from_secs(60);

/// How often [`sweep_mobile_presence`] looks for phones that turned Idle.
const MOBILE_IDLE_SWEEP_EVERY: std::time::Duration = std::time::Duration::from_secs(5);

/// One connection's presence on one tab.
struct MobileSubscription {
    info: MobileSubscriberInfo,
    /// When the phone left this tab without closing its connection.
    /// None while it has the tab open.
    left_at: Option<std::time::Instant>,
}

/// Which terminal tabs have a mobile companion on them, and whether each
/// one is Online or Idle. The single owner of that status: the desktop UI
/// shows what this reports and applies no rules of its own.
///
/// - Online: the phone has the tab open.
/// - Idle: the phone left the tab at least [`MOBILE_IDLE_AFTER`] ago and
///   has opened no other tab since; it is still connected.
/// - Absent: the connection closed, the phone opened another tab, or the
///   tab was closed on the desktop.
#[derive(Default)]
pub struct MobileTabSubscriptions {
    tabs: std::sync::Mutex<HashMap<String, HashMap<u64, MobileSubscription>>>,
}

type MobileTabsGuard<'a> =
    std::sync::MutexGuard<'a, HashMap<String, HashMap<u64, MobileSubscription>>>;

impl MobileTabSubscriptions {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MobileTabsGuard<'_> {
        self.tabs.lock().expect("mobile_tab_subs lock poisoned")
    }

    /// The phone opened `tab_id`. It is Online there, and it is dropped
    /// from every tab it has left, so presence follows it from tab to tab.
    pub fn add(&self, tab_id: &str, mut info: MobileSubscriberInfo) -> Option<MobileTabsSnapshot> {
        let mut map = self.lock();
        let conn_id = info.connection_id;
        let mut changed = false;
        map.retain(|existing_tab, conns| {
            if existing_tab != tab_id && conns.get(&conn_id).is_some_and(|sub| sub.left_at.is_some())
            {
                conns.remove(&conn_id);
                changed = true;
            }
            !conns.is_empty()
        });

        info.status = MobilePresenceStatus::Online;
        info.last_active_at = crate::usage::now();
        let previous = map
            .entry(tab_id.to_string())
            .or_default()
            .insert(conn_id, MobileSubscription { info, left_at: None });
        changed |= previous.is_none_or(|sub| sub.info.status == MobilePresenceStatus::Idle);
        changed.then(|| Self::to_snapshot(&map))
    }

    /// The phone left `tab_id` but stays connected. Nothing visible
    /// changes yet: it turns Idle in [`Self::sweep_idle`] if it opens no
    /// other tab within [`MOBILE_IDLE_AFTER`].
    pub fn leave(&self, tab_id: &str, conn_id: u64) {
        self.leave_at(tab_id, conn_id, std::time::Instant::now());
    }

    fn leave_at(&self, tab_id: &str, conn_id: u64, now: std::time::Instant) {
        if let Some(sub) = self.lock().get_mut(tab_id).and_then(|c| c.get_mut(&conn_id)) {
            sub.left_at.get_or_insert(now);
        }
    }

    /// Mark as Idle every phone that left its tab [`MOBILE_IDLE_AFTER`]
    /// or longer before `now`. Returns the snapshot when any did.
    pub fn sweep_idle(&self, now: std::time::Instant) -> Option<MobileTabsSnapshot> {
        let mut map = self.lock();
        let mut changed = false;
        for sub in map.values_mut().flat_map(HashMap::values_mut) {
            let overdue = sub
                .left_at
                .is_some_and(|left| now.saturating_duration_since(left) >= MOBILE_IDLE_AFTER);
            if overdue && sub.info.status == MobilePresenceStatus::Online {
                sub.info.status = MobilePresenceStatus::Idle;
                sub.info.last_active_at = crate::usage::now();
                changed = true;
            }
        }
        changed.then(|| Self::to_snapshot(&map))
    }

    /// Remove `conn_id` from all tabs on WebSocket disconnect. Returns
    /// `Some(snapshot)` if any tab changed.
    pub fn remove_connection(&self, conn_id: u64) -> Option<MobileTabsSnapshot> {
        let mut map = self.lock();
        let mut changed = false;
        map.retain(|_, conns| {
            if conns.remove(&conn_id).is_some() {
                changed = true;
            }
            !conns.is_empty()
        });
        changed.then(|| Self::to_snapshot(&map))
    }

    /// Forget `tab_id`, which was closed on the desktop. Returns
    /// `Some(snapshot)` if a phone was on it.
    pub fn remove_tab(&self, tab_id: &str) -> Option<MobileTabsSnapshot> {
        let mut map = self.lock();
        map.remove(tab_id).map(|_| Self::to_snapshot(&map))
    }

    pub fn snapshot(&self) -> MobileTabsSnapshot {
        Self::to_snapshot(&self.lock())
    }

    fn to_snapshot(map: &HashMap<String, HashMap<u64, MobileSubscription>>) -> MobileTabsSnapshot {
        map.iter()
            .map(|(tab_id, conns)| {
                let mut devices: Vec<MobileSubscriberInfo> =
                    conns.values().map(|sub| sub.info.clone()).collect();
                devices.sort_by_key(|d| d.connection_id);
                (tab_id.clone(), devices)
            })
            .collect()
    }
}

/// Event the desktop UI listens to for mobile presence changes.
pub const MOBILE_SUBSCRIPTIONS_EVENT: &str = "wss:mobile_subscriptions";

/// Same payload, for a change the desktop user made themselves (closing
/// a tab a phone was on). The UI updates but announces nothing: the
/// phone did not go anywhere.
pub const MOBILE_SUBSCRIPTIONS_PRUNED_EVENT: &str = "wss:mobile_subscriptions_pruned";

/// Turn phones Idle once they have been off every terminal for
/// [`MOBILE_IDLE_AFTER`]. Runs for as long as the server does.
async fn sweep_mobile_presence(state: Arc<ServerState>) {
    let mut tick = tokio::time::interval(MOBILE_IDLE_SWEEP_EVERY);
    loop {
        tick.tick().await;
        let idle = state.mobile_tab_subs.sweep_idle(std::time::Instant::now());
        emit_mobile_subscriptions(&state, idle);
    }
}

/// Tell the desktop UI about a presence change. `None` means the registry
/// call was a no-op, so there is nothing to send.
fn emit_mobile_subscriptions(state: &ServerState, tabs: Option<MobileTabsSnapshot>) {
    if let Some(tabs) = tabs {
        emit_event(state, MOBILE_SUBSCRIPTIONS_EVENT, tabs);
    }
}

/// Emit a Tauri event to the desktop UI. No-op in tests and headless
/// runs, where there is no app handle.
fn emit_event<S: serde::Serialize + Clone>(state: &ServerState, event: &str, payload: S) {
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit(event, payload);
    }
}

/// How long `pairing_flow` waits for the desktop user to approve a new
/// device. The desktop's `$pairingApproval` store mirrors this value.
/// How a pending pairing approval ended.
enum ApprovalOutcome {
    Approved,
    Declined,
    TimedOut,
    Canceled,
    ClientGone,
}

impl ApprovalOutcome {
    /// Reason for the `pairing:approval_closed` event, for the endings
    /// the desktop UI did not cause itself and so must be told about.
    fn closed_reason(&self) -> Option<&'static str> {
        match self {
            Self::Approved | Self::Declined => None,
            Self::TimedOut => Some("timeout"),
            Self::Canceled | Self::ClientGone => Some("canceled"),
        }
    }
}

const PAIRING_APPROVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

#[cfg(test)]
mod mobile_subs_tests {
    use super::*;

    fn dev(conn_id: u64, name: &str) -> MobileSubscriberInfo {
        MobileSubscriberInfo {
            connection_id: conn_id,
            device_id: Some(format!("dev-{conn_id}")),
            device_name: name.to_string(),
            platform: "ios".to_string(),
            model: Some("iPhone 16".to_string()),
            peer_ip: Some("100.101.102.103".to_string()),
            status: MobilePresenceStatus::Online,
            last_active_at: crate::usage::now(),
        }
    }

    fn status_on(snapshot: &MobileTabsSnapshot, tab: &str) -> Vec<MobilePresenceStatus> {
        snapshot
            .get(tab)
            .map(|devices| devices.iter().map(|d| d.status).collect())
            .unwrap_or_default()
    }

    #[test]
    fn a_phone_is_online_on_the_tab_it_has_open() {
        let subs = MobileTabSubscriptions::new();
        assert!(subs.snapshot().is_empty());

        let snap = subs.add("p1:t1", dev(1, "Phone")).expect("first subscriber");
        assert_eq!(status_on(&snap, "p1:t1"), [MobilePresenceStatus::Online]);
        // Opening the same tab again changes nothing the UI shows.
        assert_eq!(subs.add("p1:t1", dev(1, "Phone")), None);

        let snap = subs.add("p1:t1", dev(2, "Tablet")).expect("second subscriber");
        assert_eq!(snap["p1:t1"].len(), 2);
    }

    #[test]
    fn moving_between_tabs_moves_presence_without_an_idle_step() {
        let subs = MobileTabSubscriptions::new();
        let now = std::time::Instant::now();
        subs.add("p1:t1", dev(1, "Phone"));

        // Leaving a tab is not visible on its own...
        subs.leave_at("p1:t1", 1, now);
        assert_eq!(subs.sweep_idle(now), None);
        assert_eq!(status_on(&subs.snapshot(), "p1:t1"), [MobilePresenceStatus::Online]);

        // ...and opening the next one reports the move in one snapshot.
        let moved = subs.add("p1:t2", dev(1, "Phone")).expect("moved");
        assert!(!moved.contains_key("p1:t1"));
        assert_eq!(status_on(&moved, "p1:t2"), [MobilePresenceStatus::Online]);
    }

    #[test]
    fn reopening_a_tab_that_is_already_online_still_drops_the_tab_left_behind() {
        let subs = MobileTabSubscriptions::new();
        let now = std::time::Instant::now();
        subs.add("p1:t1", dev(1, "Phone"));
        subs.add("p1:t2", dev(1, "Phone"));
        subs.leave_at("p1:t2", 1, now);

        // t1 is unchanged, but t2 went away, and the UI must hear of it.
        let snap = subs.add("p1:t1", dev(1, "Phone")).expect("t2 dropped");
        assert!(!snap.contains_key("p1:t2"));
    }

    #[test]
    fn a_phone_off_every_terminal_turns_idle_and_comes_back_online() {
        let subs = MobileTabSubscriptions::new();
        let left = std::time::Instant::now();
        subs.add("p1:t1", dev(1, "Phone"));
        subs.leave_at("p1:t1", 1, left);

        let just_before = left + MOBILE_IDLE_AFTER - std::time::Duration::from_secs(1);
        assert_eq!(subs.sweep_idle(just_before), None);

        let idle = subs.sweep_idle(left + MOBILE_IDLE_AFTER).expect("turned idle");
        assert_eq!(status_on(&idle, "p1:t1"), [MobilePresenceStatus::Idle]);
        // Reported once, not on every sweep.
        assert_eq!(subs.sweep_idle(left + MOBILE_IDLE_AFTER * 2), None);

        let back = subs.add("p1:t1", dev(1, "Phone")).expect("back online");
        assert_eq!(status_on(&back, "p1:t1"), [MobilePresenceStatus::Online]);
    }

    #[test]
    fn a_phone_with_a_tab_open_never_turns_idle() {
        let subs = MobileTabSubscriptions::new();
        subs.add("p1:t1", dev(1, "Phone"));
        let much_later = std::time::Instant::now() + MOBILE_IDLE_AFTER * 100;
        assert_eq!(subs.sweep_idle(much_later), None);
    }

    #[test]
    fn closing_a_tab_on_the_desktop_forgets_the_phones_on_it() {
        let subs = MobileTabSubscriptions::new();
        subs.add("p1:t1", dev(1, "Phone"));
        subs.add("p1:t2", dev(2, "Tablet"));

        let snap = subs.remove_tab("p1:t1").expect("a phone was on it");
        assert!(!snap.contains_key("p1:t1"));
        assert!(snap.contains_key("p1:t2"));
        assert_eq!(subs.remove_tab("p1:t1"), None);
    }

    #[test]
    fn a_silent_peer_is_dead_only_if_it_used_to_answer_pings() {
        let start = std::time::Instant::now();
        let long_after = start + LIVENESS_TIMEOUT * 3;

        let never_answered = Liveness::new();
        never_answered.heard(false, start);
        assert!(!never_answered.is_dead(long_after));

        let answered = Liveness::new();
        answered.heard(true, start);
        assert!(!answered.is_dead(start + LIVENESS_TIMEOUT / 2));
        assert!(answered.is_dead(long_after));

        // Any traffic counts, not only pongs.
        answered.heard(false, long_after);
        assert!(!answered.is_dead(long_after + LIVENESS_TIMEOUT / 2));
    }

    #[test]
    fn remove_connection_clears_all_tabs_for_disconnected_client() {
        let subs = MobileTabSubscriptions::new();
        subs.add("p1:t1", dev(10, "Phone A"));
        subs.add("p2:t2", dev(10, "Phone A"));
        subs.add("p2:t2", dev(11, "Phone B"));

        let after = subs.remove_connection(10).expect("p1:t1 cleared");
        assert!(!after.contains_key("p1:t1"));
        assert_eq!(after.get("p2:t2").map(|v| v.len()), Some(1));
        assert!(subs.remove_connection(11).expect("all cleared").is_empty());
    }
}
