// End-to-end integration tests for the WSS server.
//
// Each test binds an ephemeral port (0.0.0.0:0 lets the OS pick), spins
// the server up in a tokio task, and drives it with an in-process
// tokio-tungstenite client. Covers the auth handshake, the initial
// Projects push, per-frame dispatch (Ping/Pong, Subscribe → Snapshot,
// broadcast → Bytes, resume flows), and disconnect cleanup.
//
// PtyHandle construction requires a real openpty which is impractical in
// a hermetic test — the Write/Resize dispatch paths are covered by the
// existing sync unit tests + manual smoke (`wscat` against a running dev
// app).

use agent_terminal_lib::auth_stub::AuthStub;
use agent_terminal_lib::ModEngineHandle;
use agent_terminal_lib::projects_cache::ProjectsCache;
use agent_terminal_lib::protocol::{ClientFrame, ServerFrame};
use agent_terminal_lib::pty_manager::PtyMap;
use agent_terminal_lib::stream_hub::StreamHub;
use agent_terminal_lib::wss_server::{self, ServerState};

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

// ---- Test scaffolding ----

/// Build a fully-wired ServerState with a known token. Sidecar is None
/// (no headless xterm), so Snapshots come back with empty payload and
/// broadcasts show up as base64-encoded Bytes frames only.
///
/// Uses `wss_server::run_with_listener` — the test binds the listener
/// itself and hands it to the server task. No drop-then-rebind race, no
/// sleep-and-hope wait for the server to come up.
async fn spawn_server(token: &str) -> (SocketAddr, Arc<ServerState>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral");
    let addr = listener.local_addr().expect("local_addr");

    let auth = Arc::new(AuthStub::new_for_tests(
        token.to_string(),
        "test-device".to_string(),
        addr,
    ));

    let hub = StreamHub::new(None);
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));
    // Tests exercise the projects push shape with an empty cache. The
    // sync_projects_to_wss path (React → cache) is unit-tested in
    // projects_cache::tests; here we just verify the WSS server reads
    // from an empty cache correctly.
    let projects_cache = Arc::new(ProjectsCache::new());

    let state = Arc::new(ServerState {
        hub: Arc::clone(&hub),
        auth,
        projects_cache,
        pty_map,
        // Test-only noop handle — the tests below don't exercise Write
        // or Resize dispatch (they need a real PtyHandle), so the mod
        // engine channels this drops onto never matter.
        mod_engine_handle: ModEngineHandle::noop(),
        cwd_table: Arc::new(Mutex::new(HashMap::new())),
        // No AppHandle in tests — auto-spawn on Subscribe gates on Some
        // and treats None as "skip spawn", so Subscribe-to-sleeping-tab
        // still routes through subscribe_remote (yields no bytes because
        // no PtyHandle exists, matching pre-Phase-A-part-2 behaviour).
        app_handle: None,
        mobile_op_inboxes: Arc::new(wss_server::MobileOpInboxes::new()),
        paired_tokens: Arc::new(agent_terminal_lib::pairing::PairedTokens::new_ephemeral()),
        pairing_window: Arc::new(agent_terminal_lib::pairing::PairingWindow::new()),
        paired_conns: Arc::new(wss_server::PairedConnMap::new()),
    });

    let state_for_task = Arc::clone(&state);
    tokio::spawn(async move {
        let _ = wss_server::run_with_listener(listener, state_for_task).await;
    });

    // Poll for readiness instead of guessing with a fixed sleep. The
    // listener is already bound (we did it above); this loop just
    // waits until axum's serve loop has begun accepting connections.
    // Deterministic on slow CI, fast on a healthy dev box.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            break;
        }
        if std::time::Instant::now() >= deadline {
            panic!("wss server never came up at {addr}");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (addr, state)
}

/// Connect a client to the server and drive it through the auth
/// handshake. Returns the still-live WebSocket for further test steps.
async fn auth_ok_client(
    addr: SocketAddr,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
{
    let url = format!("ws://{addr}/stream");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.expect("connect");
    send_frame(&mut ws, &ClientFrame::Auth { token: token.to_string() }).await;
    // Consume AuthOk + Projects. Tests care about frames AFTER these.
    match recv_frame(&mut ws).await {
        ServerFrame::AuthOk { .. } => {}
        other => panic!("expected AuthOk, got {other:?}"),
    }
    match recv_frame(&mut ws).await {
        ServerFrame::Projects { .. } => {}
        other => panic!("expected Projects, got {other:?}"),
    }
    ws
}

async fn send_frame<S>(ws: &mut tokio_tungstenite::WebSocketStream<S>, frame: &ClientFrame)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let json = serde_json::to_string(frame).expect("serialise");
    // `.into()` converts String → Utf8Bytes (tungstenite 0.26 Text variant).
    ws.send(Message::Text(json.into())).await.expect("send");
}

async fn recv_frame<S>(
    ws: &mut tokio_tungstenite::WebSocketStream<S>,
) -> ServerFrame
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("recv timeout")
        .expect("stream closed")
        .expect("ws error");
    let text = match msg {
        Message::Text(t) => t.to_string(),
        Message::Binary(b) => String::from_utf8(b.to_vec()).expect("utf8"),
        other => panic!("unexpected non-frame message: {other:?}"),
    };
    serde_json::from_str(&text).expect("parse ServerFrame")
}

// ---- Tests ----

#[tokio::test]
async fn auth_bad_token_yields_authfail_and_closes() {
    let (addr, _state) = spawn_server("known-token").await;
    let url = format!("ws://{addr}/stream");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.expect("connect");
    send_frame(&mut ws, &ClientFrame::Auth { token: "wrong".to_string() }).await;
    match recv_frame(&mut ws).await {
        ServerFrame::AuthFail { reason } => {
            assert!(!reason.is_empty(), "AuthFail must include a reason");
        }
        other => panic!("expected AuthFail, got {other:?}"),
    }
    // Next recv should observe the server-side close. axum doesn't
    // always emit a graceful Close frame before dropping the socket —
    // any of {None, Ok(Close), Err(ResetWithoutClosingHandshake)}
    // means "connection is over," which is the invariant this test
    // pins down.
    let closed = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("timeout waiting for close");
    let connection_ended = matches!(closed, None | Some(Ok(Message::Close(_))) | Some(Err(_)));
    assert!(
        connection_ended,
        "expected connection to end after AuthFail; got {closed:?}"
    );
}

#[tokio::test]
async fn auth_ok_yields_authok_and_initial_projects_push() {
    let (addr, _state) = spawn_server("secret").await;
    let mut ws = auth_ok_client(addr, "secret").await;
    // `auth_ok_client` already consumed AuthOk + Projects. As a
    // secondary sanity check, drive a Ping/Pong to prove the socket is
    // still healthy after the handshake.
    send_frame(&mut ws, &ClientFrame::Ping).await;
    match recv_frame(&mut ws).await {
        ServerFrame::Pong => {}
        other => panic!("expected Pong, got {other:?}"),
    }
}

#[tokio::test]
async fn subscribe_receives_snapshot_and_live_bytes() {
    let (addr, state) = spawn_server("secret").await;
    // Pre-populate the hub with some ring entries so the subscribe path
    // replays them as Bytes right after the Snapshot.
    state.hub.ensure_tab("workspace-a:tab-1", 80, 24);
    state
        .hub
        .broadcast("workspace-a:tab-1", b"hello ", "hello ");
    state
        .hub
        .broadcast("workspace-a:tab-1", b"world\n", "world\n");

    let mut ws = auth_ok_client(addr, "secret").await;
    send_frame(
        &mut ws,
        &ClientFrame::Subscribe {
            tab_id: "workspace-a:tab-1".to_string(),
            scrollback: 500,
        },
    )
    .await;

    // Snapshot + 2 replayed Bytes frames (no sidecar → replay all
    // ring entries).
    let snap = recv_frame(&mut ws).await;
    assert!(matches!(snap, ServerFrame::Snapshot { .. }));
    let b1 = recv_frame(&mut ws).await;
    let b2 = recv_frame(&mut ws).await;
    match (b1, b2) {
        (
            ServerFrame::Bytes { seq: 0, .. },
            ServerFrame::Bytes { seq: 1, .. },
        ) => {}
        other => panic!("expected Bytes(seq=0), Bytes(seq=1), got {other:?}"),
    }

    // Now emit a live broadcast — should arrive as Bytes(seq=2).
    state.hub.broadcast("workspace-a:tab-1", b"live", "live");
    let live = recv_frame(&mut ws).await;
    match live {
        ServerFrame::Bytes { seq: 2, .. } => {}
        other => panic!("expected Bytes(seq=2), got {other:?}"),
    }
}

#[tokio::test]
async fn resume_within_ring_replays_only_missing_bytes() {
    let (addr, state) = spawn_server("secret").await;
    state.hub.ensure_tab("t:1", 80, 24);
    for i in 0..5u8 {
        state.hub.broadcast("t:1", &[i], "x");
    }

    let mut ws = auth_ok_client(addr, "secret").await;
    send_frame(
        &mut ws,
        &ClientFrame::Resume {
            tab_id: "t:1".to_string(),
            scrollback: 500,
            last_seq: 2,
        },
    )
    .await;
    let f1 = recv_frame(&mut ws).await;
    let f2 = recv_frame(&mut ws).await;
    match (f1, f2) {
        (
            ServerFrame::Bytes { seq: 3, .. },
            ServerFrame::Bytes { seq: 4, .. },
        ) => {}
        other => panic!("expected Bytes(3), Bytes(4); got {other:?}"),
    }
}

#[tokio::test]
async fn unsubscribe_removes_hub_state_and_stops_bytes() {
    let (addr, state) = spawn_server("secret").await;
    state.hub.ensure_tab("t:1", 80, 24);
    let mut ws = auth_ok_client(addr, "secret").await;
    send_frame(
        &mut ws,
        &ClientFrame::Subscribe {
            tab_id: "t:1".to_string(),
            scrollback: 500,
        },
    )
    .await;
    // Consume the Snapshot.
    let _ = recv_frame(&mut ws).await;

    send_frame(
        &mut ws,
        &ClientFrame::Unsubscribe {
            tab_id: "t:1".to_string(),
        },
    )
    .await;

    // Give the server a moment to process. subscriber_count should now
    // be zero.
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(state.hub.subscriber_count("t:1"), Some(0));

    // Post-unsubscribe broadcasts must NOT arrive on the WebSocket.
    state.hub.broadcast("t:1", b"unheard", "x");
    let sees_a_byte = tokio::time::timeout(Duration::from_millis(200), ws.next())
        .await
        .is_ok();
    assert!(!sees_a_byte, "unsubscribed client must not receive Bytes");
}

#[tokio::test]
async fn client_disconnect_reaps_all_subscriptions() {
    let (addr, state) = spawn_server("secret").await;
    state.hub.ensure_tab("t:1", 80, 24);
    state.hub.ensure_tab("t:2", 80, 24);
    let mut ws = auth_ok_client(addr, "secret").await;
    send_frame(
        &mut ws,
        &ClientFrame::Subscribe {
            tab_id: "t:1".to_string(),
            scrollback: 500,
        },
    )
    .await;
    let _ = recv_frame(&mut ws).await;
    send_frame(
        &mut ws,
        &ClientFrame::Subscribe {
            tab_id: "t:2".to_string(),
            scrollback: 500,
        },
    )
    .await;
    let _ = recv_frame(&mut ws).await;
    assert_eq!(state.hub.subscriber_count("t:1"), Some(1));
    assert_eq!(state.hub.subscriber_count("t:2"), Some(1));

    // Drop the client without unsubscribing. Cleanup happens when the
    // connection_task's read loop returns.
    drop(ws);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(state.hub.subscriber_count("t:1"), Some(0));
    assert_eq!(state.hub.subscriber_count("t:2"), Some(0));
}
