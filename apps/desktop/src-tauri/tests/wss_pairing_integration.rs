// End-to-end coverage of the QR pairing sub-flow.
//
// Exercises what the plain wss / wss_tls integration tests cannot:
//
//   * The `PAIRING:` prefix auth branch consumes a live pairing window
//     and returns `AuthOk { device_name: "Pairing" }`.
//   * A subsequent `PairingStart` frame provisions a real device and
//     yields `PairingComplete` with a fresh device_token.
//   * Reconnecting with the minted device_token authenticates the mobile
//     as the paired device (device_name comes from the pairing metadata,
//     not the AuthStub).
//   * Revoke tears down an active session mid-loop and refuses future
//     auths with the revoked token.

use agent_terminal_lib::auth_stub::AuthStub;
use agent_terminal_lib::pairing::{PairedTokens, PairingWindow};
use agent_terminal_lib::projects_cache::ProjectsCache;
use agent_terminal_lib::protocol::{ClientFrame, PairingStartBody, RegisterPushBody, ServerFrame};
use agent_terminal_lib::pty_manager::PtyMap;
use agent_terminal_lib::stream_hub::StreamHub;
use agent_terminal_lib::wss_server::{self, PairedConnMap, ServerState};
use agent_terminal_lib::ModEngineHandle;

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

/// Spawn a WSS server against an ephemeral port with real pairing +
/// paired_tokens + paired_conns wired in. Returns the addr for the test
/// client and the shared Arcs so tests can drive the pairing window +
/// inspect the paired-devices map directly.
async fn spawn_server() -> (
    SocketAddr,
    Arc<PairingWindow>,
    Arc<PairedTokens>,
    Arc<PairedConnMap>,
) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral");
    let addr = listener.local_addr().expect("local_addr");

    // Legacy AuthStub still lives on ServerState. Set its token to
    // something unlikely to overlap with the minted device tokens so
    // tests exercise the paired path cleanly.
    let auth = Arc::new(AuthStub::new_for_tests(
        "dev-fallback-token".into(),
        "dev-fallback".into(),
        addr,
    ));

    let paired_tokens = Arc::new(PairedTokens::new_ephemeral());
    let pairing_window = Arc::new(PairingWindow::new());
    let paired_conns = Arc::new(PairedConnMap::new());

    let state = Arc::new(ServerState {
        hub: StreamHub::new(None),
        auth,
        projects_cache: Arc::new(ProjectsCache::new()),
        pty_map: Arc::new(Mutex::new(HashMap::new())) as PtyMap,
        mod_engine_handle: ModEngineHandle::noop(),
        cwd_table: Arc::new(Mutex::new(HashMap::new())),
        app_handle: None,
        mobile_op_inboxes: Arc::new(wss_server::MobileOpInboxes::new()),
        paired_tokens: Arc::clone(&paired_tokens),
        pairing_window: Arc::clone(&pairing_window),
        paired_conns: Arc::clone(&paired_conns),
        push: None,
    });

    tokio::spawn(async move {
        let _ = wss_server::run_with_listener(listener, state).await;
    });

    // Wait until the listener is actually accepting.
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
    (addr, pairing_window, paired_tokens, paired_conns)
}

async fn connect(
    addr: SocketAddr,
) -> tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
> {
    let url = format!("ws://{addr}/stream");
    let (ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    ws
}

async fn send_frame<S>(
    ws: &mut tokio_tungstenite::WebSocketStream<S>,
    frame: &ClientFrame,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let json = serde_json::to_string(frame).expect("serialise");
    ws.send(Message::Text(json.into()))
        .await
        .expect("send");
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

#[tokio::test]
async fn pairing_round_trip_mints_device_token_and_reauths() {
    let (addr, window, paired, _conns) = spawn_server().await;

    // Step 1: desktop opens a pairing window (as the UI would).
    let pairing_token = window.open();

    // Step 2: mobile connects and auths with the PAIRING: prefix.
    let mut ws = connect(addr).await;
    send_frame(
        &mut ws,
        &ClientFrame::Auth {
            token: format!("PAIRING:{pairing_token}"),
        },
    )
    .await;
    match recv_frame(&mut ws).await {
        ServerFrame::AuthOk { device_name } => assert_eq!(device_name, "Pairing"),
        other => panic!("expected AuthOk during pairing, got {other:?}"),
    }

    // Step 3: mobile sends its metadata.
    send_frame(
        &mut ws,
        &ClientFrame::PairingStart {
            op_id: 1,
            body: PairingStartBody {
                device_name: "Dani's iPhone".into(),
                platform: "ios".into(),
                model: Some("iPhone 15 Pro".into()),
            },
        },
    )
    .await;
    let device_token = match recv_frame(&mut ws).await {
        ServerFrame::PairingComplete { op_id, body } => {
            assert_eq!(op_id, 1);
            assert!(!body.device_token.is_empty());
            assert!(!body.device_id.is_empty());
            body.device_token
        }
        other => panic!("expected PairingComplete, got {other:?}"),
    };
    drop(ws);

    // Store now holds one device.
    assert_eq!(paired.list().len(), 1);
    let device = paired
        .check_and_touch(&device_token, None)
        .expect("device token should authenticate");
    assert_eq!(device.device_name, "Dani's iPhone");
    assert_eq!(device.platform, "ios");
    assert_eq!(device.model.as_deref(), Some("iPhone 15 Pro"));

    // Step 4: reconnect with the device token; expect AuthOk with the
    // real device name.
    let mut ws2 = connect(addr).await;
    send_frame(
        &mut ws2,
        &ClientFrame::Auth {
            token: device_token,
        },
    )
    .await;
    match recv_frame(&mut ws2).await {
        ServerFrame::AuthOk { device_name } => {
            assert_eq!(device_name, "Dani's iPhone");
        }
        other => panic!("expected paired AuthOk, got {other:?}"),
    }
    // Push capability advertisement, then the Projects push. The
    // capability frame comes first so the phone knows whether it may
    // send RegisterPush before it sends anything at all.
    match recv_frame(&mut ws2).await {
        ServerFrame::PushStatus { .. } => {}
        other => panic!("expected PushStatus, got {other:?}"),
    }
    match recv_frame(&mut ws2).await {
        ServerFrame::Projects { .. } => {}
        other => panic!("expected Projects, got {other:?}"),
    }
}

#[tokio::test]
async fn pairing_bad_token_returns_authfail() {
    let (addr, window, paired, _) = spawn_server().await;
    let _real_token = window.open();

    let mut ws = connect(addr).await;
    send_frame(
        &mut ws,
        &ClientFrame::Auth {
            token: "PAIRING:not-the-right-token".into(),
        },
    )
    .await;
    match recv_frame(&mut ws).await {
        ServerFrame::AuthFail { reason } => {
            assert!(
                reason.contains("mismatch"),
                "expected mismatch, got {reason}"
            );
        }
        other => panic!("expected AuthFail, got {other:?}"),
    }
    assert_eq!(paired.list().len(), 0);
}

#[tokio::test]
async fn pairing_with_no_window_open_returns_authfail() {
    let (addr, _window, _paired, _) = spawn_server().await;
    // Deliberately DO NOT open a window.

    let mut ws = connect(addr).await;
    send_frame(
        &mut ws,
        &ClientFrame::Auth {
            token: "PAIRING:whatever".into(),
        },
    )
    .await;
    match recv_frame(&mut ws).await {
        ServerFrame::AuthFail { reason } => {
            assert!(
                reason.contains("no pairing window"),
                "expected no-open-window reason, got {reason}"
            );
        }
        other => panic!("expected AuthFail, got {other:?}"),
    }
}

#[tokio::test]
async fn revoke_force_closes_active_session_and_blocks_reauth() {
    let (addr, window, paired, conns) = spawn_server().await;

    // Pair a device end-to-end.
    let pairing_token = window.open();
    let mut ws = connect(addr).await;
    send_frame(
        &mut ws,
        &ClientFrame::Auth {
            token: format!("PAIRING:{pairing_token}"),
        },
    )
    .await;
    let _ = recv_frame(&mut ws).await; // AuthOk (pairing placeholder)
    send_frame(
        &mut ws,
        &ClientFrame::PairingStart {
            op_id: 1,
            body: PairingStartBody {
                device_name: "Revoke Me".into(),
                platform: "android".into(),
                model: None,
            },
        },
    )
    .await;
    let (device_token, device_id) = match recv_frame(&mut ws).await {
        ServerFrame::PairingComplete { body, .. } => {
            (body.device_token, body.device_id)
        }
        other => panic!("expected PairingComplete, got {other:?}"),
    };
    drop(ws);

    // Reconnect with the device token, enter session mode.
    let mut ws2 = connect(addr).await;
    send_frame(
        &mut ws2,
        &ClientFrame::Auth {
            token: device_token.clone(),
        },
    )
    .await;
    let _ = recv_frame(&mut ws2).await; // AuthOk
    let _ = recv_frame(&mut ws2).await; // PushStatus (capability advertisement)
    let _ = recv_frame(&mut ws2).await; // Projects

    // Small pause so the connection task has enrolled the abort_tx.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Revoke.
    let removed = paired.revoke(&device_id).expect("revoke");
    assert!(removed);
    let closed = conns.revoke_and_close(&device_id);
    assert_eq!(closed, 1, "expected exactly one active session force-closed");

    // Active socket should receive AuthFail: revoked, then close.
    let msg = tokio::time::timeout(Duration::from_secs(2), ws2.next())
        .await
        .expect("recv timeout")
        .expect("stream closed unexpectedly")
        .expect("ws error");
    let text = match msg {
        Message::Text(t) => t.to_string(),
        other => panic!("unexpected message: {other:?}"),
    };
    let frame: ServerFrame = serde_json::from_str(&text).expect("parse");
    match frame {
        ServerFrame::AuthFail { reason } => assert_eq!(reason, "revoked"),
        other => panic!("expected AuthFail(revoked), got {other:?}"),
    }

    // Fresh connection with the same token now bounces at auth.
    let mut ws3 = connect(addr).await;
    send_frame(
        &mut ws3,
        &ClientFrame::Auth {
            token: device_token,
        },
    )
    .await;
    match recv_frame(&mut ws3).await {
        ServerFrame::AuthFail { reason } => {
            assert_eq!(reason, "bad token");
        }
        other => panic!("expected AuthFail(bad token), got {other:?}"),
    }
}

/// Pair a device and leave it authenticated, returning the socket plus
/// the ids. Shared by the push registration tests below.
async fn pair_and_auth(
    addr: SocketAddr,
    window: &Arc<PairingWindow>,
) -> (
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    String,
) {
    let pairing_token = window.open();
    let mut ws = connect(addr).await;
    send_frame(
        &mut ws,
        &ClientFrame::Auth {
            token: format!("PAIRING:{pairing_token}"),
        },
    )
    .await;
    let _ = recv_frame(&mut ws).await; // AuthOk (pairing placeholder)
    send_frame(
        &mut ws,
        &ClientFrame::PairingStart {
            op_id: 1,
            body: PairingStartBody {
                device_name: "Push Phone".into(),
                platform: "ios".into(),
                model: None,
            },
        },
    )
    .await;
    let (device_token, device_id) = match recv_frame(&mut ws).await {
        ServerFrame::PairingComplete { body, .. } => (body.device_token, body.device_id),
        other => panic!("expected PairingComplete, got {other:?}"),
    };
    drop(ws);

    let mut ws = connect(addr).await;
    send_frame(&mut ws, &ClientFrame::Auth { token: device_token }).await;
    let _ = recv_frame(&mut ws).await; // AuthOk
    (ws, device_id)
}

fn register_frame(op_id: u64, token: &str) -> ClientFrame {
    ClientFrame::RegisterPush {
        op_id,
        body: RegisterPushBody {
            token: token.to_string(),
            platform: "ios".into(),
            app_version: "1.2.0".into(),
            delay_seconds: 90,
            redact_names: false,
        },
    }
}

/// The capability handshake. A paired device must be told push exists
/// before it dares send RegisterPush: an older desktop closes the whole
/// session on a variant it cannot deserialise, so the phone gates
/// registration on seeing this frame.
#[tokio::test]
async fn a_paired_device_is_told_about_push_before_anything_else() {
    let (addr, window, _paired, _conns) = spawn_server().await;
    let (mut ws, _id) = pair_and_auth(addr, &window).await;

    match recv_frame(&mut ws).await {
        ServerFrame::PushStatus { body } => {
            assert!(body.supported);
            assert!(!body.registered, "a fresh device has no token yet");
            assert_eq!(body.delay_seconds, agent_terminal_lib::push::DEFAULT_DELAY_SECONDS);
            assert!(!body.redact_names);
            assert!(body.last_error.is_none());
        }
        other => panic!("expected PushStatus right after AuthOk, got {other:?}"),
    }
}

#[tokio::test]
async fn registering_stores_the_token_and_the_preferences_together() {
    let (addr, window, paired, _conns) = spawn_server().await;
    let (mut ws, device_id) = pair_and_auth(addr, &window).await;
    let _ = recv_frame(&mut ws).await; // PushStatus
    let _ = recv_frame(&mut ws).await; // Projects

    send_frame(&mut ws, &register_frame(2, "ExponentPushToken[abc123]")).await;

    match recv_frame(&mut ws).await {
        ServerFrame::OpOk { op_id } => assert_eq!(op_id, 2),
        other => panic!("expected OpOk, got {other:?}"),
    }
    match recv_frame(&mut ws).await {
        ServerFrame::PushStatus { body } => {
            assert!(body.registered);
            assert_eq!(body.delay_seconds, 90);
        }
        other => panic!("expected PushStatus echo, got {other:?}"),
    }

    let stored = paired.get(&device_id).expect("device");
    assert_eq!(stored.push_token.as_deref(), Some("ExponentPushToken[abc123]"));
    assert_eq!(stored.push_platform.as_deref(), Some("ios"));
    assert_eq!(stored.push_delay_seconds, 90);
    assert!(stored.push_registered_at.is_some());
}

/// Token presence is the enabled flag, so unregistering is the off
/// switch and has to take effect immediately rather than waiting for a
/// DeviceNotRegistered receipt from Expo.
#[tokio::test]
async fn unregistering_clears_the_token_at_once() {
    let (addr, window, paired, _conns) = spawn_server().await;
    let (mut ws, device_id) = pair_and_auth(addr, &window).await;
    let _ = recv_frame(&mut ws).await; // PushStatus
    let _ = recv_frame(&mut ws).await; // Projects

    send_frame(&mut ws, &register_frame(2, "ExponentPushToken[abc123]")).await;
    let _ = recv_frame(&mut ws).await; // OpOk
    let _ = recv_frame(&mut ws).await; // PushStatus
    assert!(paired.get(&device_id).unwrap().push_token.is_some());

    send_frame(&mut ws, &ClientFrame::UnregisterPush { op_id: 3 }).await;
    match recv_frame(&mut ws).await {
        ServerFrame::OpOk { op_id } => assert_eq!(op_id, 3),
        other => panic!("expected OpOk, got {other:?}"),
    }
    match recv_frame(&mut ws).await {
        ServerFrame::PushStatus { body } => assert!(!body.registered),
        other => panic!("expected PushStatus echo, got {other:?}"),
    }
    assert!(paired.get(&device_id).unwrap().push_token.is_none());
}

/// A malformed token is a silent dead end otherwise: every send fails
/// and the user sees a switch that is on and does nothing.
#[tokio::test]
async fn a_token_that_is_not_an_expo_token_is_refused() {
    let (addr, window, paired, _conns) = spawn_server().await;
    let (mut ws, device_id) = pair_and_auth(addr, &window).await;
    let _ = recv_frame(&mut ws).await; // PushStatus
    let _ = recv_frame(&mut ws).await; // Projects

    send_frame(&mut ws, &register_frame(2, "not-a-push-token")).await;
    match recv_frame(&mut ws).await {
        ServerFrame::OpError { op_id, reason } => {
            assert_eq!(op_id, 2);
            assert!(reason.contains("malformed"), "got {reason}");
        }
        other => panic!("expected OpError, got {other:?}"),
    }
    assert!(paired.get(&device_id).unwrap().push_token.is_none());
}

/// Out of range rather than rejected: a future companion build should
/// degrade to something sane, not disable the feature with an error the
/// user cannot act on.
#[tokio::test]
async fn an_out_of_range_delay_is_clamped_not_rejected() {
    let (addr, window, paired, _conns) = spawn_server().await;
    let (mut ws, device_id) = pair_and_auth(addr, &window).await;
    let _ = recv_frame(&mut ws).await; // PushStatus
    let _ = recv_frame(&mut ws).await; // Projects

    send_frame(
        &mut ws,
        &ClientFrame::RegisterPush {
            op_id: 2,
            body: RegisterPushBody {
                token: "ExponentPushToken[abc123]".into(),
                platform: "android".into(),
                app_version: "9.9.9".into(),
                delay_seconds: 99_999,
                redact_names: true,
            },
        },
    )
    .await;
    match recv_frame(&mut ws).await {
        ServerFrame::OpOk { .. } => {}
        other => panic!("expected OpOk, got {other:?}"),
    }
    let stored = paired.get(&device_id).expect("device");
    assert_eq!(stored.push_delay_seconds, agent_terminal_lib::push::DELAY_MAX_SECONDS);
    assert!(stored.push_redact_names);
}
