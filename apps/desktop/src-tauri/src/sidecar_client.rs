// Sidecar client — Rust ↔ Node JSON-RPC over stdio.
//
// One long-lived child process holds N headless xterm instances. This module
// owns the child handle, the per-line framing, the request-id allocator, and
// the pending-reply table. Every public method is cancel-safe across
// `tokio::select!`: dropping the future before its reply arrives drops the
// matching oneshot Receiver only; the pending slot releases when the reply
// lands and is silently discarded.
//
// stdout is the JSON-RPC channel (newline-delimited JSON, one message per
// line). stderr is forwarded to the host's stderr with a `[sidecar]` prefix
// for debugging without polluting the protocol.
//
// `write_bytes` is fire-and-forget: it pushes one line onto the writer mpsc
// and returns. `open` / `resize` / `serialize` / `close` await a reply
// keyed by the request id.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, mpsc, oneshot};

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sidecar replied with error: {0}")]
    Remote(String),
    #[error("sidecar process died")]
    Dead,
    #[error("invalid reply: {0}")]
    InvalidReply(String),
}

pub type Result<T> = std::result::Result<T, SidecarError>;

type PendingMap = Mutex<HashMap<u64, oneshot::Sender<Value>>>;

/// Shared death-handling routine. Three independent failure paths converge
/// here: stdin write error (writer task), stdout EOF / read error (reader
/// task), and child process exit (reaper task). Setting `dead` short-
/// circuits future `call()`s, and clearing the pending map drops every
/// outstanding `oneshot::Sender` so awaiting callers resolve to
/// `SidecarError::Dead` immediately instead of hanging until a slower path
/// fires.
async fn fail_all_pending(pending: &PendingMap, dead: &AtomicBool) {
    dead.store(true, Ordering::Release);
    pending.lock().await.clear();
}

/// Client handle. Cloneable: every clone shares the same child process and
/// pending-reply table. The child is reaped when the last clone is dropped
/// and the writer mpsc closes (stdin EOF → sidecar's `rl.on('close')` runs
/// `process.exit(0)`).
#[derive(Clone)]
pub struct SidecarClient {
    inner: Arc<Inner>,
}

struct Inner {
    next_id: AtomicU64,
    pending: Arc<PendingMap>,
    writer_tx: mpsc::UnboundedSender<String>,
    dead: Arc<AtomicBool>,
}

impl SidecarClient {
    /// Spawn the sidecar from a prepared `tokio::process::Command`. The
    /// caller owns runtime + script discovery so dev and bundled-prod can
    /// build their own Commands without changing this module. Stdin /
    /// stdout / stderr are forced to piped regardless of what the caller
    /// configured.
    pub async fn spawn(mut cmd: Command) -> Result<Self> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("piped above");
        let stdout = child.stdout.take().expect("piped above");
        let stderr = child.stderr.take().expect("piped above");

        let pending: Arc<PendingMap> = Arc::new(Mutex::new(HashMap::new()));
        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<String>();
        let dead = Arc::new(AtomicBool::new(false));

        // Writer task — owns stdin. Serialises writes so concurrent callers
        // can't interleave bytes mid-line. On stdin failure, fail every
        // pending call (the child may still be alive but stdin is gone —
        // the reaper alone wouldn't unblock callers in that case).
        {
            let pending = Arc::clone(&pending);
            let dead = Arc::clone(&dead);
            tokio::spawn(async move {
                let mut stdin = stdin;
                while let Some(msg) = writer_rx.recv().await {
                    if stdin.write_all(msg.as_bytes()).await.is_err()
                        || stdin.write_all(b"\n").await.is_err()
                        || stdin.flush().await.is_err()
                    {
                        fail_all_pending(&pending, &dead).await;
                        break;
                    }
                }
            });
        }

        // Stdout reader — parses one JSON line at a time, dispatches by
        // `id` to the matching pending oneshot. On EOF or read error, fail
        // every pending call (stdout could close while the child stays
        // alive — same reasoning as the writer-failure path).
        {
            let pending = Arc::clone(&pending);
            let dead = Arc::clone(&dead);
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("[sidecar] bad json on stdout: {e}: {trimmed}");
                            continue;
                        }
                    };
                    if let Some(id) = value.get("id").and_then(Value::as_u64) {
                        let mut map = pending.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            // Receiver dropped (cancelled future) is fine —
                            // silently drop the reply.
                            let _ = tx.send(value);
                        }
                    }
                }
                fail_all_pending(&pending, &dead).await;
            });
        }

        // Stderr forwarder — prefixed for grep-ability in the host log.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[sidecar] {line}");
            }
        });

        // Reaper — when the child exits, fail every still-pending call so
        // awaiting callers see SidecarError::Dead immediately instead of
        // hanging forever.
        {
            let pending = Arc::clone(&pending);
            let dead = Arc::clone(&dead);
            tokio::spawn(async move {
                let status = child.wait().await;
                eprintln!("[sidecar] process exited: {status:?}");
                fail_all_pending(&pending, &dead).await;
            });
        }

        Ok(Self {
            inner: Arc::new(Inner {
                next_id: AtomicU64::new(1),
                pending,
                writer_tx,
                dead,
            }),
        })
    }

    /// Returns true once the child has exited or any stdin write has failed.
    /// Public so callers can choose between retry / restart strategies.
    pub fn is_dead(&self) -> bool {
        self.inner.dead.load(Ordering::Acquire)
    }

    async fn call(&self, verb: &str, args: Value) -> Result<Value> {
        if self.is_dead() {
            return Err(SidecarError::Dead);
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);
        let line = json!({ "id": id, "verb": verb, "args": args }).to_string();
        if self.inner.writer_tx.send(line).is_err() {
            // Writer task gone. Drop our pending slot so it doesn't leak.
            self.inner.pending.lock().await.remove(&id);
            return Err(SidecarError::Dead);
        }
        match rx.await {
            Ok(reply) => match reply.get("ok").and_then(Value::as_bool) {
                Some(true) => Ok(reply),
                _ => {
                    let msg = reply
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string();
                    Err(SidecarError::Remote(msg))
                }
            },
            Err(_) => Err(SidecarError::Dead),
        }
    }

    pub async fn open(&self, tab_id: &str, cols: u16, rows: u16) -> Result<()> {
        self.call(
            "open",
            json!({ "tab_id": tab_id, "cols": cols, "rows": rows }),
        )
        .await?;
        Ok(())
    }

    /// Fire-and-forget `open`. Pushes the line onto the writer mpsc
    /// synchronously and returns; no reply is awaited. The sidecar
    /// processes lines in arrival order, so a subsequent `write_bytes`
    /// from the same thread is guaranteed to land after this line — that
    /// is the ordering invariant `StreamHub::ensure_tab` relies on.
    ///
    /// Any sidecar-side failure (bad cols, OOM, etc.) is silently dropped
    /// from the caller's perspective but surfaces on the sidecar's stderr
    /// log, which the Rust client forwards with a `[sidecar]` prefix.
    pub fn open_nonblocking(&self, tab_id: &str, cols: u16, rows: u16) {
        if self.is_dead() {
            return;
        }
        let line = json!({
            "verb": "open",
            "args": { "tab_id": tab_id, "cols": cols, "rows": rows }
        })
        .to_string();
        let _ = self.inner.writer_tx.send(line);
    }

    /// Push raw PTY bytes to the sidecar's parser for `tab_id`. Returns
    /// immediately — there is no reply. If the sidecar has died, the bytes
    /// silently drop; the caller's hot path stays branch-free.
    ///
    /// `seq` is the sequence number the StreamHub assigned to this chunk.
    /// The sidecar records the highest seq it has seen per tab and returns
    /// it from `serialize`, so subscribe_remote can tag its snapshot with
    /// the exact seq whose bytes are reflected in the payload (no drift
    /// window between "state in snapshot" and "next Bytes broadcast seq").
    pub fn write_bytes(&self, tab_id: &str, bytes: &[u8], seq: u64) {
        if self.is_dead() {
            return;
        }
        let bytes_b64 = B64.encode(bytes);
        let line = json!({
            "verb": "write",
            "args": { "tab_id": tab_id, "bytes_b64": bytes_b64, "seq": seq }
        })
        .to_string();
        let _ = self.inner.writer_tx.send(line);
    }

    pub async fn resize(&self, tab_id: &str, cols: u16, rows: u16) -> Result<()> {
        self.call(
            "resize",
            json!({ "tab_id": tab_id, "cols": cols, "rows": rows }),
        )
        .await?;
        Ok(())
    }

    /// Fire-and-forget `resize`. Same ordering and failure semantics as
    /// `open_nonblocking`.
    pub fn resize_nonblocking(&self, tab_id: &str, cols: u16, rows: u16) {
        if self.is_dead() {
            return;
        }
        let line = json!({
            "verb": "resize",
            "args": { "tab_id": tab_id, "cols": cols, "rows": rows }
        })
        .to_string();
        let _ = self.inner.writer_tx.send(line);
    }

    /// Ask the sidecar to serialize tab_id's buffer.
    ///
    /// Returns `(payload, last_seq)`:
    ///
    /// - `payload` is the xterm-serialize output (escape sequences ready to
    ///   replay into a fresh xterm Terminal).
    /// - `last_seq` is `Some(N)` where N is the highest seq the sidecar had
    ///   fully parsed at the moment the payload was captured, or `None`
    ///   when no writes have been observed yet (freshly-opened tab). The
    ///   `None` case is distinct from `Some(0)`: seq 0 is a legitimate
    ///   first-broadcast value, and subscribe_remote uses this distinction
    ///   to decide whether to send the first broadcast (`None` → always
    ///   send it; `Some(N)` → dedupe with `if seq <= N { skip }`).
    pub async fn serialize(
        &self,
        tab_id: &str,
        scrollback: u32,
    ) -> Result<(String, Option<u64>)> {
        let reply = self
            .call(
                "serialize",
                json!({ "tab_id": tab_id, "scrollback": scrollback }),
            )
            .await?;
        let payload = reply
            .get("payload")
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| SidecarError::InvalidReply("missing payload field".to_string()))?;
        let last_seq = reply.get("last_seq").and_then(Value::as_u64);
        Ok((payload, last_seq))
    }

    pub async fn close(&self, tab_id: &str) -> Result<()> {
        self.call("close", json!({ "tab_id": tab_id })).await?;
        Ok(())
    }

    /// Fire-and-forget `close`. Same ordering and failure semantics as
    /// `open_nonblocking`.
    pub fn close_nonblocking(&self, tab_id: &str) {
        if self.is_dead() {
            return;
        }
        let line = json!({
            "verb": "close",
            "args": { "tab_id": tab_id }
        })
        .to_string();
        let _ = self.inner.writer_tx.send(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{Duration, timeout};

    // Fast helper: a "yes/echo" sidecar implemented as an inline -e script.
    // Reads JSON lines; for each line carrying an `id` field writes back
    // `{id, ok: true, payload: ''}` so `serialize` returns a non-null
    // payload and other calls succeed. No xterm — pure protocol fidelity.
    //
    // Returns None when neither node nor bun is on PATH (CI matrix without
    // a JS runtime), so the test can skip cleanly instead of failing on a
    // missing-binary error.
    fn echo_sidecar_command() -> Option<Command> {
        let runtime = which::which("node")
            .or_else(|_| which::which("bun"))
            .ok()?;
        let mut cmd = Command::new(runtime);
        cmd.arg("-e").arg(
            r#"
            const rl = require('node:readline').createInterface({ input: process.stdin });
            rl.on('line', (line) => {
                try {
                    const m = JSON.parse(line);
                    if (m.id != null) {
                        process.stdout.write(JSON.stringify({ id: m.id, ok: true, payload: '' }) + '\n');
                    }
                } catch {}
            });
            rl.on('close', () => process.exit(0));
            process.stderr.write('[echo-sidecar] ready\n');
            "#,
        );
        Some(cmd)
    }

    #[tokio::test]
    async fn open_resize_close_roundtrip() {
        let Some(cmd) = echo_sidecar_command() else {
            eprintln!("[test] skipping — no node/bun on PATH");
            return;
        };
        let client = SidecarClient::spawn(cmd).await.unwrap();
        timeout(Duration::from_secs(5), client.open("t1", 80, 24))
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(5), client.resize("t1", 132, 40))
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(5), client.close("t1"))
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn write_bytes_is_fire_and_forget() {
        let Some(cmd) = echo_sidecar_command() else {
            eprintln!("[test] skipping — no node/bun on PATH");
            return;
        };
        let client = SidecarClient::spawn(cmd).await.unwrap();
        // Spam writes; the call returns immediately even if the sidecar is
        // slow to process. Mostly a sanity check that the API does not
        // accidentally become blocking.
        for i in 0..1000 {
            client.write_bytes("t1", b"hello", i);
        }
        // The echo sidecar emits no reply for `write`. Sleep briefly to
        // confirm no spurious reply arrives that would corrupt later state.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn concurrent_calls_get_distinct_ids() {
        let Some(cmd) = echo_sidecar_command() else {
            eprintln!("[test] skipping — no node/bun on PATH");
            return;
        };
        let client = SidecarClient::spawn(cmd).await.unwrap();
        let handles: Vec<_> = (0..50)
            .map(|i| {
                let c = client.clone();
                tokio::spawn(async move { c.open(&format!("tab-{i}"), 80, 24).await })
            })
            .collect();
        for h in handles {
            h.await.unwrap().expect("each open should succeed");
        }
    }

    /// End-to-end test against the real `sidecar/index.js`. Requires bun
    /// (or node) on PATH and `src-tauri/sidecar/node_modules/` populated.
    /// Marked `#[ignore]` so `cargo test --lib` (the CI default) skips it;
    /// run with `cargo test --lib -- --ignored` locally to exercise.
    #[tokio::test]
    #[ignore = "requires src-tauri/sidecar/node_modules — run with `cargo test --lib -- --ignored`"]
    async fn real_sidecar_open_write_serialize_close() {
        let runtime = which::which("bun")
            .or_else(|_| which::which("node"))
            .expect("bun or node on PATH");
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let script = std::path::PathBuf::from(manifest_dir)
            .join("sidecar")
            .join("index.js");
        assert!(
            script.exists(),
            "sidecar script missing at {} — did you `cd src-tauri/sidecar && bun install`?",
            script.display()
        );

        let mut cmd = Command::new(&runtime);
        cmd.arg(&script);
        let client = SidecarClient::spawn(cmd).await.expect("spawn");

        client.open("tab-1", 80, 24).await.expect("open");
        client.write_bytes("tab-1", b"hello world\r\n", 42);

        let (payload, last_seq) = timeout(
            Duration::from_secs(10),
            client.serialize("tab-1", 1000),
        )
        .await
        .expect("serialize did not time out")
        .expect("serialize ok");

        assert!(
            payload.contains("hello world"),
            "serialize payload did not contain written text. payload: {payload}"
        );
        // Threading check: the sidecar echoes back the highest seq it saw
        // via `writeBytes.seq`. Our write above tagged seq 42, so
        // last_seq must round-trip as Some(42). None would indicate the
        // sidecar treated the write as seqless (path regression).
        assert_eq!(last_seq, Some(42));

        client.close("tab-1").await.expect("close");
    }

    #[tokio::test]
    async fn dead_after_spawn_failure_returns_clear_error() {
        // Spawn a process that exits immediately. Subsequent calls should
        // observe SidecarError::Dead (via the reaper task setting dead=true
        // and the pending map being cleared).
        let cmd = Command::new("true");
        let client = SidecarClient::spawn(cmd).await.unwrap();

        // Give the reaper a moment to fire.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(client.is_dead());

        let err = client.open("t1", 80, 24).await.unwrap_err();
        assert!(
            matches!(err, SidecarError::Dead),
            "expected Dead, got {err:?}"
        );
    }
}
