//! Integration tests for the hook pipeline.
//!
//! These tests invoke the real hook scripts installed at `~/.agent-terminal/hooks/`
//! and verify that they correctly transform and POST payloads to the hook server.
//! They also validate that the script returns immediately under failure modes
//! that would otherwise hang Claude Code (the 2026-04-26 incident).
//!
//! # Running
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml --test hook_integration -- --test-threads=1
//! ```
//!
//! `--test-threads=1` is REQUIRED — every test in this file binds (or asserts
//! the absence of a binding on) the hook port. Parallel execution would race.
//! The tests internally serialize with a Mutex as a defence-in-depth measure,
//! but the test runner can still interleave with other tests in other files.
//!
//! Tests that touch real config files are marked `#[ignore]`. Run with:
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml --test hook_integration -- --include-ignored --test-threads=1
//! ```

use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::{Duration, timeout};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Cross-test serialization for the hook port. Tests cannot run in parallel because
/// they all share this single fixed port. The integration tests assume
/// `--test-threads=1`, but the mutex is also held inside each test as a guard
/// against accidental parallelism.
fn port_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Acquires `port_lock()`, recovering from poisoning. Without this, a single
/// panicking test would cascade into PoisonError panics in every subsequent
/// test, masking the real failure.
fn acquire_port_lock() -> std::sync::MutexGuard<'static, ()> {
    port_lock().lock().unwrap_or_else(|e| e.into_inner())
}

fn hook_scripts_dir() -> PathBuf {
    dirs::home_dir()
        .expect("no home dir")
        .join(format!(".{}", agent_terminal_lib::identity::NAMESPACE))
        .join("hooks")
}

fn claude_hook() -> PathBuf {
    hook_scripts_dir().join("claude-hook")
}

fn codex_hook() -> PathBuf {
    hook_scripts_dir().join("codex-hook")
}

/// Try to bind the hook port (47384 prod / 47385 dev — see `identity.rs`).
/// Returns the listener or None if the port is busy.
async fn try_bind_hook_port() -> Option<TcpListener> {
    let addr = format!("127.0.0.1:{}", agent_terminal_lib::identity::HOOK_PORT);
    TcpListener::bind(&addr).await.ok()
}

type Received = Arc<Mutex<VecDeque<Value>>>;

#[derive(Deserialize)]
struct AnyPayload(Value);

async fn collect_hook(
    State(received): State<Received>,
    Json(AnyPayload(payload)): Json<AnyPayload>,
) -> StatusCode {
    received.lock().unwrap().push_back(payload);
    StatusCode::OK
}

/// Server handle that shuts down on drop, freeing the hook port for the next test.
struct CollectorServer {
    received: Received,
    shutdown: Option<oneshot::Sender<()>>,
}

impl Drop for CollectorServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

/// Starts the hook HTTP server on the given listener. Returns a handle that
/// owns the shutdown signal and the received-payloads queue.
fn start_collector(listener: TcpListener) -> CollectorServer {
    let received: Received = Arc::new(Mutex::new(VecDeque::new()));
    let rx_state = received.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let app = Router::new()
        .route("/hook", post(collect_hook))
        .with_state(rx_state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    CollectorServer {
        received,
        shutdown: Some(shutdown_tx),
    }
}

/// Pipes `payload` to `script event` via stdin and waits for the child to exit.
/// Returns the elapsed wall-clock time.
fn run_hook(script: &PathBuf, event: &str, payload: &str) -> Duration {
    run_hook_with_env(script, event, payload, &[], &[])
}

/// Runs the hook script with explicit env-var additions and removals.
fn run_hook_with_env(
    script: &PathBuf,
    event: &str,
    payload: &str,
    env_overrides: &[(&str, &str)],
    env_removes: &[&str],
) -> Duration {
    let start = Instant::now();
    let mut cmd = Command::new(script);
    cmd.arg(event)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (k, v) in env_overrides {
        cmd.env(k, v);
    }
    for k in env_removes {
        cmd.env_remove(k);
    }
    let mut child = cmd
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn {}: {e}", script.display()));

    use std::io::Write;
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    child.wait().expect("hook script did not exit");
    start.elapsed()
}

/// Polls the received queue until a payload arrives or the timeout expires.
async fn wait_for_payload(received: &Received) -> Option<Value> {
    wait_for_payload_matching(received, |_| true).await
}

/// Polls the received queue and returns the first payload satisfying `pred`.
/// Skips and discards earlier payloads that don't match — needed because i7's
/// fire-and-forget curl can still be in-flight when the next test binds the
/// port, and its delayed POST then lands in the next test's queue.
async fn wait_for_payload_matching<F>(received: &Received, pred: F) -> Option<Value>
where
    F: Fn(&Value) -> bool,
{
    timeout(Duration::from_secs(3), async {
        loop {
            {
                let mut q = received.lock().unwrap();
                while let Some(p) = q.pop_front() {
                    if pred(&p) {
                        return p;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .ok()
}

// ─── I1: Claude hook script fires with correct agent/event fields ─────────────

#[tokio::test]
async fn i1_claude_hook_fires_session_start() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i1: claude-hook not installed at {}", script.display());
        return;
    }

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i1: port {} busy (agent-terminal running?)", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i1","cwd":"/tmp/i1-project","transcript_path":"/tmp/i1.jsonl"}"#;
    run_hook(&script, "SessionStart", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code", "agent field injected");
    assert_eq!(got["event"], "SessionStart", "event field injected");
    assert_eq!(got["session_id"], "test-session-i1", "session_id preserved");
    assert_eq!(got["cwd"], "/tmp/i1-project", "cwd preserved");
    assert_eq!(got["transcript_path"], "/tmp/i1.jsonl", "transcript_path preserved");
}

// ─── I2: Claude hook fires for PreToolUse (includes tool_name) ───────────────

#[tokio::test]
async fn i2_claude_hook_fires_pre_tool_use() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i2: claude-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i2: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i2","cwd":"/tmp/i2-project","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
    run_hook(&script, "PreToolUse", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code");
    assert_eq!(got["event"], "PreToolUse");
    assert_eq!(got["tool_name"], "Bash");
}

// ─── I3: Codex hook script fires with correct agent/event fields ──────────────

#[tokio::test]
async fn i3_codex_hook_fires_session_start() {
    let _g = acquire_port_lock();

    let script = codex_hook();
    if !script.exists() {
        eprintln!("SKIP i3: codex-hook not installed at {}", script.display());
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i3: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"codex-session-i3","cwd":"/tmp/i3-project"}"#;
    run_hook(&script, "SessionStart", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "codex", "agent field injected");
    assert_eq!(got["event"], "SessionStart", "event field injected");
    assert_eq!(got["session_id"], "codex-session-i3", "session_id preserved");
    assert_eq!(got["cwd"], "/tmp/i3-project", "cwd preserved");
}

// ─── I4: Codex Stop hook fires correctly ─────────────────────────────────────

#[tokio::test]
async fn i4_codex_hook_fires_stop() {
    let _g = acquire_port_lock();

    let script = codex_hook();
    if !script.exists() {
        eprintln!("SKIP i4: codex-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i4: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"codex-session-i4","cwd":"/tmp/i4-project","last_assistant_message":"Done."}"#;
    run_hook(&script, "Stop", payload);

    let got = wait_for_payload(&server.received)
        .await
        .expect("no payload received within 3s");

    assert_eq!(got["agent"], "codex");
    assert_eq!(got["event"], "Stop");
    assert_eq!(got["last_assistant_message"], "Done.");
}

// ─── I7: Hook script exits fast when nothing is listening on the hook port ────
//
// Regression test: confirms ECONNREFUSED is fast on macOS and the script
// doesn't hang when agent-terminal is closed. Pre-fix this passed (curl fails
// in ~25ms on its own), but the test exists to lock that behavior in.

#[tokio::test]
async fn i7_hook_script_does_not_hang_when_server_absent() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i7: claude-hook not installed");
        return;
    }

    // Confirm port really is free. If an external process holds it, skip
    // rather than report a misleading failure.
    if try_bind_hook_port().await.is_none() {
        eprintln!("SKIP i7: port {} busy — cannot test absent-server case", agent_terminal_lib::identity::HOOK_PORT);
        return;
    }
    // (Listener dropped immediately above so the script sees a free port.)

    let payload = r#"{"session_id":"i7","cwd":"/tmp/i7"}"#;
    let elapsed = run_hook(&script, "SessionStart", payload);

    assert!(
        elapsed < Duration::from_secs(1),
        "hook script took {elapsed:?} when nothing was listening — should be <1s"
    );
}

// ─── I8: Hook script exits fast when listener accepts but never responds ──────
//
// THIS is the 2026-04-26 regression test. Without fire-and-forget detach,
// this test hangs for ~60 seconds (curl waits for a response that never comes).
// With fire-and-forget, the script exits in milliseconds regardless.

#[tokio::test]
async fn i8_hook_script_does_not_hang_when_server_unresponsive() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i8: claude-hook not installed");
        return;
    }

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i8: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };

    // Spawn an "accept-but-never-respond" loop. We accept incoming connections
    // (so the kernel doesn't return ECONNREFUSED), then immediately drop the
    // socket without reading or writing. The connection stays open from curl's
    // POV; curl waits for a response that will never come.
    //
    // We hold the connections in a Vec so they don't get closed (which would
    // make curl notice EOF and exit). They're released when the test ends.
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    let acceptor = tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                Ok((conn, _)) = listener.accept() => {
                    held.push(conn);
                }
            }
        }
    });

    let payload = r#"{"session_id":"i8","cwd":"/tmp/i8"}"#;
    let elapsed = run_hook(&script, "SessionStart", payload);

    // Tell the acceptor to stop and drop its held connections.
    let _ = stop_tx.send(());
    let _ = acceptor.await;

    assert!(
        elapsed < Duration::from_secs(1),
        "REGRESSION: hook script took {elapsed:?} against unresponsive server. \
         Fire-and-forget detach is broken — script is waiting for curl response. \
         See plans/.../2026-04-26-0830-claude-code-agent-turn-detection.md \
         'Post-Implementation Bug — 2026-04-26' section."
    );
}

// ─── I5: Real Claude settings.json has no duplicate entries (ignored) ─────────

#[tokio::test]
#[ignore]
async fn i5_real_claude_settings_no_duplicates() {
    let home = dirs::home_dir().expect("no home dir");
    let settings = home.join(".claude").join("settings.json");

    if !settings.exists() {
        eprintln!("SKIP i5: ~/.claude/settings.json not found");
        return;
    }

    let raw = tokio::fs::read_to_string(&settings).await.unwrap();
    let v: Value = serde_json::from_str(&raw).expect("settings.json is not valid JSON");

    // Missing "hooks" object is not a failure — just means agent-terminal
    // hasn't installed any hooks yet (or Claude Code reset the file). The test
    // only fires if our entries exist, in which case they must be deduplicated.
    let Some(hooks) = v["hooks"].as_object() else {
        eprintln!("SKIP i5: ~/.claude/settings.json has no \"hooks\" object — nothing to check");
        return;
    };

    let our_prefix = home
        .join(format!(".{}", agent_terminal_lib::identity::NAMESPACE))
        .join("hooks")
        .join("claude-hook")
        .to_string_lossy()
        .to_string();

    for (event, entries) in hooks {
        let arr = entries.as_array().expect("event array is not an array");
        let mut commands: Vec<String> = vec![];
        for entry in arr {
            if let Some(inner) = entry.get("hooks").and_then(|h| h.as_array()) {
                for h in inner {
                    if let Some(cmd) = h.get("command").and_then(|c| c.as_str()) {
                        commands.push(cmd.to_string());
                    }
                }
            }
        }
        let our_cmds: Vec<_> = commands
            .iter()
            .filter(|c| c.starts_with(&our_prefix))
            .collect();
        assert!(
            our_cmds.len() <= 1,
            "duplicate agent-terminal entry in {event}: {our_cmds:?}"
        );
    }
}

// ─── I6: Real Codex hooks.json has no duplicate entries (ignored) ─────────────

#[tokio::test]
#[ignore]
async fn i6_real_codex_hooks_no_duplicates() {
    let home = dirs::home_dir().expect("no home dir");
    let hooks_file = home.join(".codex").join("hooks.json");

    if !hooks_file.exists() {
        eprintln!("SKIP i6: ~/.codex/hooks.json not found");
        return;
    }

    let raw = tokio::fs::read_to_string(&hooks_file).await.unwrap();
    let v: Value = serde_json::from_str(&raw).expect("hooks.json is not valid JSON");

    let Some(hooks) = v["hooks"].as_object() else {
        eprintln!("SKIP i6: ~/.codex/hooks.json has no \"hooks\" object");
        return;
    };
    let our_prefix = home
        .join(format!(".{}", agent_terminal_lib::identity::NAMESPACE))
        .join("hooks")
        .join("codex-hook")
        .to_string_lossy()
        .to_string();

    for (event, entries) in hooks {
        let arr = entries.as_array().expect("event array is not an array");
        let our_cmds: Vec<_> = arr
            .iter()
            .filter_map(|e| e.get("command").and_then(|c| c.as_str()))
            .filter(|c| c.starts_with(&our_prefix))
            .collect();
        assert!(
            our_cmds.len() <= 1,
            "duplicate agent-terminal entry in {event}: {our_cmds:?}"
        );
    }
}

// ─── I9: tab_id forwarded when AGENT_TERMINAL_TAB_ID is set ──────────────────

/// Confirms the script forwards `$AGENT_TERMINAL_TAB_ID` as a `tab_id` field.
#[tokio::test]
async fn i9_claude_hook_forwards_tab_id_when_env_set() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i9: claude-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i9: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i9","cwd":"/tmp/i9-project"}"#;
    run_hook_with_env(
        &script,
        "SessionStart",
        payload,
        &[("AGENT_TERMINAL_TAB_ID", "proj-A:tab-42")],
        &[],
    );

    let got = wait_for_payload_matching(&server.received, |p| {
        p["session_id"] == "test-session-i9"
    })
    .await
    .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code");
    assert_eq!(got["event"], "SessionStart");
    assert_eq!(
        got["tab_id"], "proj-A:tab-42",
        "tab_id must be forwarded from $AGENT_TERMINAL_TAB_ID"
    );
    assert_eq!(got["cwd"], "/tmp/i9-project");
}

// ─── I10: tab_id field omitted when env var is unset ─────────────────────────

/// Confirms the script omits `tab_id` when `$AGENT_TERMINAL_TAB_ID` is unset.
#[tokio::test]
async fn i10_claude_hook_omits_tab_id_when_env_unset() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i10: claude-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i10: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i10","cwd":"/tmp/i10-project"}"#;
    // env_remove, not env("", "") — the calling cargo-test process may run
    // inside agent-terminal and an empty-string override would still let the
    // parent's value leak through; also future-proofs against any guard
    // change that distinguishes set-empty from unset.
    run_hook_with_env(
        &script,
        "SessionStart",
        payload,
        &[],
        &["AGENT_TERMINAL_TAB_ID"],
    );

    let got = wait_for_payload_matching(&server.received, |p| {
        p["session_id"] == "test-session-i10"
    })
    .await
    .expect("no payload received within 3s");

    assert_eq!(got["agent"], "claude-code");
    assert_eq!(got["event"], "SessionStart");
    assert!(
        got.get("tab_id").is_none(),
        "tab_id must be omitted when AGENT_TERMINAL_TAB_ID is unset, got: {got:?}"
    );
}

// ─── I11: tab_id field omitted when env value contains unsafe chars ──────────

/// Unsafe characters in `$AGENT_TERMINAL_TAB_ID` must omit the field, not corrupt the JSON.
#[tokio::test]
async fn i11_claude_hook_omits_tab_id_when_value_unsafe() {
    let _g = acquire_port_lock();

    let script = claude_hook();
    if !script.exists() {
        eprintln!("SKIP i11: claude-hook not installed");
        return;
    }
    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP i11: port {} busy", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let payload = r#"{"session_id":"test-session-i11","cwd":"/tmp/i11-project"}"#;
    // Embedded `"` would close the JSON string early and inject extra
    // fields if the script didn't validate the env value.
    run_hook_with_env(
        &script,
        "SessionStart",
        payload,
        &[("AGENT_TERMINAL_TAB_ID", "evil\",\"injected\":\"true")],
        &[],
    );

    let got = wait_for_payload_matching(&server.received, |p| {
        p["session_id"] == "test-session-i11"
    })
    .await
    .expect("no payload received within 3s");

    assert!(
        got.get("tab_id").is_none(),
        "tab_id must be omitted when the env value contains unsafe chars, got: {got:?}"
    );
    assert!(
        got.get("injected").is_none(),
        "no injected field should appear in the payload"
    );
}

// ─── E2E (guided / interactive) helpers ──────────────────────────────────────
//
// IMPORTANT: E1/E2 below are NOT fully automated. They are guided tests that
// require a human user (with a coding agent helping them) to manually run
// claude/codex commands in a separate terminal.
//
// Why guided instead of automated subprocess spawning:
//   1. AI CLIs prompt interactively for trust dialogs, auth, etc. — automating
//      around all of that is brittle and per-version.
//   2. While the test collector is bound to the hook port, EVERY claude/codex process
//      on the machine fires hooks at it (incl. the user's other terminals).
//      Filtering by cwd helps but the cleanest signal is a human pointing the
//      CLI at a known-empty directory created by the test.
//   3. Real E2E means a real human sat down and verified the full path. An
//      automated subprocess proves only that we can spawn a process; a guided
//      test proves the actual user-facing behavior.
//
// HOW TO RUN: with `cargo test ... --include-ignored --test-threads=1
// --nocapture`. The test prints exact instructions (cwd + command) on stderr.
// A coding agent watching the test output should:
//   - Read the printed cwd and command verbatim
//   - Tell the user which terminal to open and what to type
//   - Wait for the user to confirm the command was run
//   - Let the test continue (it polls for the hook events automatically)
//
// SKIPPED when:
//   - CI=true (CI/CD environments — these tests need a human)
//   - hook port busy (agent-terminal running, or stale binding)

fn ci_environment() -> bool {
    std::env::var("CI").map(|v| v == "true").unwrap_or(false)
}

/// How long the guided E2E tests wait for hook events to arrive after printing
/// instructions. Generous because the user needs time to switch terminals,
/// paste the command, deal with any auth prompts, and let the LLM respond.
const E2E_GUIDED_TIMEOUT: Duration = Duration::from_secs(300);

/// Polls the received queue and returns ALL payloads from `cwd` once at least
/// one `SessionStart` from `expected_agent` has arrived. Adds a 2-second tail
/// after that to capture the rest of the hook sequence (UserPromptSubmit, Stop,
/// SessionEnd, etc).
///
/// Returns an empty Vec on timeout — caller asserts non-empty.
async fn wait_for_session_in_cwd(
    received: &Received,
    cwd: &str,
    expected_agent: &str,
    timeout_dur: Duration,
) -> Vec<Value> {
    let cwd_prefix = format!("{cwd}/");
    let start = Instant::now();
    let mut ours: Vec<Value> = Vec::new();
    let mut session_start_seen_at: Option<Instant> = None;

    while start.elapsed() < timeout_dur {
        // Drain whatever is in the shared queue; keep only payloads that match
        // our cwd and expected agent. Other sessions' hooks (your real Claude
        // in another terminal) are ambient noise and dropped here.
        {
            let mut queue = received.lock().unwrap();
            while let Some(p) = queue.pop_front() {
                let matches_cwd = p["cwd"]
                    .as_str()
                    .map(|c| c == cwd || c.starts_with(&cwd_prefix))
                    .unwrap_or(false);
                let matches_agent = p["agent"] == expected_agent;
                if matches_cwd && matches_agent {
                    if p["event"] == "SessionStart" && session_start_seen_at.is_none() {
                        session_start_seen_at = Some(Instant::now());
                    }
                    ours.push(p);
                }
            }
        }

        // Once we see SessionStart, wait an extra 2s for the rest of the
        // session's events (UserPromptSubmit, Stop) to arrive, then return.
        if let Some(t) = session_start_seen_at {
            if t.elapsed() >= Duration::from_secs(2) {
                return ours;
            }
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    ours
}

/// Loud, multi-line instruction banner printed to stderr so a coding agent
/// watching `cargo test --nocapture` output can immediately recognize the
/// guidance and relay it to the user.
///
/// Tests use real INTERACTIVE sessions, not non-interactive `-p` / `exec` modes,
/// because that's what end users actually use. Hook firing should be verified
/// against the realistic path. The user opens a session, types a prompt, hits
/// enter, and the test sees the events.
fn print_e2e_instructions(
    test_name: &str,
    cwd: &str,
    launch_command: &str,
    prompt_to_send: &str,
) {
    eprintln!();
    eprintln!("==============================================================");
    eprintln!("  GUIDED E2E TEST — HUMAN ACTION REQUIRED");
    eprintln!("  Test: {test_name}");
    eprintln!("==============================================================");
    eprintln!("  Step 1 — Open a NEW terminal window and run:");
    eprintln!();
    eprintln!("      cd {cwd}");
    eprintln!("      {launch_command}");
    eprintln!();
    eprintln!("  Step 2 — Once the interactive session is ready, type this");
    eprintln!("           prompt and press Enter to submit:");
    eprintln!();
    eprintln!("      {prompt_to_send}");
    eprintln!();
    eprintln!("  Step 3 — Wait for the agent to respond. The test will detect");
    eprintln!("           hook events as they fire and move on automatically.");
    eprintln!("           You can close the session anytime after that.");
    eprintln!();
    eprintln!("  Test will wait up to {} seconds for hook events.", E2E_GUIDED_TIMEOUT.as_secs());
    eprintln!("==============================================================");
    eprintln!();
}

// ─── E1: Real Claude Code fires hooks end-to-end (GUIDED) ────────────────────
//
// ⚠️ HUMAN-IN-THE-LOOP TEST. Read the long comment block above the helpers
// before changing this. The test prepares an isolated cwd, prints exact
// instructions on stderr, and then waits for hook events to arrive. A coding
// agent watching `cargo test --nocapture` output should relay the printed
// instructions to the user and wait for them to run the command.
//
// Pre-installs hooks via `ensure_hooks_installed()` so the user can run the
// command immediately without first launching agent-terminal — even if
// `~/.claude/settings.json` was previously reset.

#[tokio::test]
#[ignore]
async fn e1_guided_claude_fires_hooks_end_to_end() {
    if ci_environment() {
        eprintln!("SKIP e1: CI=true — guided e2e tests need a human");
        return;
    }

    let _g = acquire_port_lock();

    // Idempotent: adds nothing if hooks are already present.
    agent_terminal_lib::hook_config::ensure_hooks_installed().await;

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP e1: port {} busy (agent-terminal running?)", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    // Per-PID cwd so the user can re-run the test fresh and the test only sees
    // hooks fired from THIS run, not stale events from a previous attempt.
    // Canonicalize: macOS resolves /var/folders → /private/var/folders, and
    // claude reports the canonical path in hook payloads. Without canonicalize,
    // our cwd filter rejects every event from the user's manual session.
    let test_cwd_raw = std::env::temp_dir().join(format!("agent-terminal-e1-{}", std::process::id()));
    std::fs::create_dir_all(&test_cwd_raw).expect("could not create test cwd");
    let test_cwd = std::fs::canonicalize(&test_cwd_raw).expect("could not canonicalize test cwd");
    let test_cwd_str = test_cwd.to_string_lossy().to_string();

    print_e2e_instructions(
        "e1_guided_claude_fires_hooks_end_to_end",
        &test_cwd_str,
        "claude",
        "Reply with the single word: pong",
    );

    let ours = wait_for_session_in_cwd(&server.received, &test_cwd_str, "claude-code", E2E_GUIDED_TIMEOUT)
        .await;

    eprintln!(
        "e1: received {} matching hook payloads: {:?}",
        ours.len(),
        ours.iter()
            .map(|p| format!("{}/{}", p["agent"].as_str().unwrap_or("?"), p["event"].as_str().unwrap_or("?")))
            .collect::<Vec<_>>()
    );

    assert!(
        !ours.is_empty(),
        "no hook events arrived for cwd={test_cwd_str} within {}s. \
         Did the user run `claude -p '...'` in that directory? \
         If `which claude` is a cmux wrapper, ~/.claude/settings.json is bypassed.",
        E2E_GUIDED_TIMEOUT.as_secs()
    );

    let saw_session_start = ours.iter().any(|p| p["event"] == "SessionStart");
    assert!(
        saw_session_start,
        "claude-code events received from our cwd but no SessionStart: {ours:?}"
    );

    let saw_user_prompt = ours.iter().any(|p| p["event"] == "UserPromptSubmit");
    assert!(
        saw_user_prompt,
        "SessionStart fired but no UserPromptSubmit — \
         did the user actually submit a prompt? Events: {ours:?}"
    );
}

// ─── E2: Real Codex fires hooks end-to-end (GUIDED) ──────────────────────────
//
// ⚠️ HUMAN-IN-THE-LOOP TEST. Same protocol as E1 but for codex.

#[tokio::test]
#[ignore]
async fn e2_guided_codex_fires_hooks_end_to_end() {
    if ci_environment() {
        eprintln!("SKIP e2: CI=true — guided e2e tests need a human");
        return;
    }

    let _g = acquire_port_lock();

    agent_terminal_lib::hook_config::ensure_hooks_installed().await;

    let Some(listener) = try_bind_hook_port().await else {
        eprintln!("SKIP e2: port {} busy (agent-terminal running?)", agent_terminal_lib::identity::HOOK_PORT);
        return;
    };
    let server = start_collector(listener);

    let test_cwd_raw = std::env::temp_dir().join(format!("agent-terminal-e2-{}", std::process::id()));
    std::fs::create_dir_all(&test_cwd_raw).expect("could not create test cwd");
    let test_cwd = std::fs::canonicalize(&test_cwd_raw).expect("could not canonicalize test cwd");
    let test_cwd_str = test_cwd.to_string_lossy().to_string();

    // codex refuses to start outside a git repo, so init one in the temp dir.
    // The user shouldn't need to think about this.
    let _ = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&test_cwd)
        .status();

    print_e2e_instructions(
        "e2_guided_codex_fires_hooks_end_to_end",
        &test_cwd_str,
        "codex",
        "Reply with the single word: pong",
    );

    let ours = wait_for_session_in_cwd(&server.received, &test_cwd_str, "codex", E2E_GUIDED_TIMEOUT)
        .await;

    eprintln!(
        "e2: received {} matching hook payloads: {:?}",
        ours.len(),
        ours.iter()
            .map(|p| format!("{}/{}", p["agent"].as_str().unwrap_or("?"), p["event"].as_str().unwrap_or("?")))
            .collect::<Vec<_>>()
    );

    assert!(
        !ours.is_empty(),
        "no hook events arrived for cwd={test_cwd_str} within {}s. \
         Did the user run `codex exec ...` in that directory?",
        E2E_GUIDED_TIMEOUT.as_secs()
    );

    let saw_session_start = ours.iter().any(|p| p["event"] == "SessionStart");
    assert!(
        saw_session_start,
        "codex events received from our cwd but no SessionStart: {ours:?}"
    );
}

