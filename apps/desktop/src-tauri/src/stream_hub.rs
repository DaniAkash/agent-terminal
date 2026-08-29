// Per-tab fan-out of PTY output. The reader thread broadcasts every chunk
// through here instead of sending directly to the WebView Channel; the hub
// then delivers to every subscriber (local WebView + future remote mobile
// clients) AND writes the same bytes to the sidecar's shadow xterm so the
// sidecar's terminal state stays in sync with the real PTY for the upcoming
// `serialize` op.
//
// What the hub owns per tab:
// - A monotonic u64 sequence counter for every broadcast chunk.
// - A bytes-capped ring buffer of recent (seq, bytes) entries — used for
//   replay-on-reconnect to remote clients (no consumers yet; sub-step 4
//   wires this up).
// - A list of subscribers. In this sub-step only `Subscriber::Local` exists;
//   `Subscriber::Remote` arrives when the WSS server lands.
// - Last-known cols/rows so future `subscribe_remote` calls know what size
//   to ask the sidecar to serialise.
//
// What the hub does NOT own:
// - The PTY itself (lives in `PtyHandle` inside `PtyMap`).
// - The UTF-8 stream decoder (lives in the reader thread, kept there so the
//   stateful cross-chunk decode stays single-threaded and identical to
//   today's byte-for-byte behaviour).
// - The mod engine. `pty_manager` still feeds `mod_handle.on_output` with
//   raw bytes directly — the hub is purely a forwarder.
//
// Locking discipline (matters for reasoning about deadlocks):
// - `tabs` is a DashMap (sharded). Holding a per-tab `Arc<TabState>` does
//   not block other tabs.
// - Within a tab, the order is always: `subscribers` lock first, then
//   `shared.lock()` on a Local subscriber's channel. No code path goes the
//   other way, so there is no AB / BA deadlock between hub broadcast and
//   `try_reattach`'s channel swap.

use crate::protocol::ServerFrame;
use crate::pty_manager::{PtyDataPayload, SharedChannel};
use crate::sidecar_client::SidecarClient;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use tokio::sync::mpsc;

/// Default ring buffer cap per tab — bytes, not entries. Holds roughly five
/// to ten seconds of continuous high-bandwidth output. Past this point a
/// reconnecting remote client receives a fresh snapshot instead of byte
/// replay (sub-step 4 implements the snapshot path).
pub const DEFAULT_RING_CAP_BYTES: usize = 512 * 1024;

/// Stable identifier for a subscriber within a tab. Allocated by the hub
/// at subscribe time; callers hand it back to unsubscribe. Opaque on
/// purpose — the underlying counter is an implementation detail.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SubscriberId(u64);

/// Sentinel for `Subscriber::Remote::last_acked_seq` meaning "no bytes have
/// been delivered to this subscriber yet." Distinct from `Some(0)` (which
/// means the subscriber has been sent seq 0 already). Broadcast dedup:
/// `if acked != REMOTE_ACK_UNSET && seq <= acked { skip }`.
///
/// `u64::MAX` is safe as a sentinel because a real broadcast seq would take
/// ~285 years to reach it at 1 GB/s continuous output — the practical
/// upper bound is far below.
const REMOTE_ACK_UNSET: u64 = u64::MAX;

/// Per-tab fan-out target. `#[non_exhaustive]` so adding future variants
/// (relay backends, notification sinks, etc.) stays non-breaking.
#[non_exhaustive]
pub enum Subscriber {
    /// Desktop WebView path. The SharedChannel inside flips between
    /// `Some(channel)` and `None` as the WebView connects and reconnects
    /// without ever re-subscribing — same shape pty_manager has used since
    /// before the hub existed.
    Local(SharedChannel),

    /// Paired mobile / remote client. Each connection owns its own
    /// `mpsc::UnboundedSender<ServerFrame>`; the WSS server's writer task
    /// drains it into the WebSocket. Two atomics track per-subscriber
    /// delivery state so `broadcast` can dedupe against subscribe-time
    /// ring replay and reap dead subscribers on send failure.
    Remote {
        /// Highest seq delivered to this subscriber (via Snapshot or a
        /// Bytes frame). Starts as `REMOTE_ACK_UNSET`; updates on every
        /// successful delivery. Broadcast fan-out uses it to skip re-
        /// sending bytes the subscribe path already replayed from ring.
        last_acked_seq: Arc<AtomicU64>,
        outbox: mpsc::UnboundedSender<ServerFrame>,
    },
}

struct TabState {
    next_seq: AtomicU64,
    ring: Mutex<RingBuffer>,
    subscribers: Mutex<Vec<(SubscriberId, Subscriber)>>,
    next_sub_id: AtomicU64,
    // Last-known terminal size. `resize_tab` updates this; future
    // `subscribe_remote` will read it to know what dimensions to ask the
    // sidecar to serialise.
    cols: AtomicU16,
    rows: AtomicU16,
}

impl TabState {
    fn new(cols: u16, rows: u16, ring_cap_bytes: usize) -> Self {
        Self {
            next_seq: AtomicU64::new(0),
            ring: Mutex::new(RingBuffer::new(ring_cap_bytes)),
            subscribers: Mutex::new(Vec::new()),
            next_sub_id: AtomicU64::new(1),
            cols: AtomicU16::new(cols),
            rows: AtomicU16::new(rows),
        }
    }
}

struct RingBuffer {
    cap_bytes: usize,
    bytes_held: usize,
    entries: VecDeque<(u64, Vec<u8>)>,
}

impl RingBuffer {
    fn new(cap_bytes: usize) -> Self {
        Self {
            cap_bytes,
            bytes_held: 0,
            entries: VecDeque::new(),
        }
    }

    /// Append a new chunk, evicting older ones from the front until the
    /// held byte total fits the cap. The newest entry is always kept even
    /// if it alone exceeds the cap — losing it would silently drop bytes
    /// the producer just claimed to broadcast.
    fn push(&mut self, seq: u64, bytes: Vec<u8>) {
        self.bytes_held = self.bytes_held.saturating_add(bytes.len());
        self.entries.push_back((seq, bytes));
        while self.bytes_held > self.cap_bytes && self.entries.len() > 1 {
            if let Some((_, evicted)) = self.entries.pop_front() {
                self.bytes_held = self.bytes_held.saturating_sub(evicted.len());
            }
        }
    }
}

pub struct StreamHub {
    tabs: DashMap<String, Arc<TabState>>,
    sidecar: Option<Arc<SidecarClient>>,
    ring_cap_bytes: usize,
}

impl StreamHub {
    pub fn new(sidecar: Option<Arc<SidecarClient>>) -> Arc<Self> {
        Self::with_ring_cap(sidecar, DEFAULT_RING_CAP_BYTES)
    }

    pub fn with_ring_cap(sidecar: Option<Arc<SidecarClient>>, ring_cap_bytes: usize) -> Arc<Self> {
        Arc::new(Self {
            tabs: DashMap::new(),
            sidecar,
            ring_cap_bytes,
        })
    }

    /// Create per-tab state (idempotent) and tell the sidecar to open a
    /// matching headless xterm. Fully synchronous — the sidecar `open`
    /// line lands on the writer mpsc before this call returns, so any
    /// subsequent `broadcast` from the same thread is guaranteed to push
    /// its `write` line after the `open`. The previous version spawned
    /// the open as a tokio task, which broke that ordering whenever the
    /// reader thread raced ahead of the runtime scheduler.
    pub fn ensure_tab(&self, tab_id: &str, cols: u16, rows: u16) {
        self.tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(cols, rows, self.ring_cap_bytes)));

        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.open_nonblocking(tab_id, cols, rows);
        }
    }

    /// Add a Local subscriber for `tab_id`. Caller stores the returned id
    /// and passes it to `unsubscribe` later. If the tab doesn't exist yet
    /// (broadcast hasn't happened), it is created with default 80x24
    /// dimensions; the upcoming resize call will correct them.
    pub fn subscribe_local(&self, tab_id: &str, channel: SharedChannel) -> SubscriberId {
        let state = self
            .tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(80, 24, self.ring_cap_bytes)))
            .clone();
        let id = SubscriberId(state.next_sub_id.fetch_add(1, Ordering::Relaxed));
        state
            .subscribers
            .lock()
            .expect("subscribers lock poisoned")
            .push((id, Subscriber::Local(channel)));
        id
    }

    pub fn unsubscribe(&self, tab_id: &str, sub_id: SubscriberId) {
        if let Some(state) = self.tabs.get(tab_id) {
            state
                .subscribers
                .lock()
                .expect("subscribers lock poisoned")
                .retain(|(id, _)| *id != sub_id);
        }
    }

    /// Broadcast one chunk of PTY output. Local subscribers receive the
    /// UTF-8 decoded string (matches the `PtyDataPayload { data: String }`
    /// shape the WebView already consumes). The ring buffer and the
    /// sidecar receive the raw bytes (xterm-headless parses escape
    /// sequences from bytes; the ring's replay path needs raw too).
    ///
    /// Caller passes both raw and decoded because the stateful UTF-8
    /// decoder lives in the reader thread — moving it into the hub would
    /// require synchronising the decoder across hypothetical concurrent
    /// broadcasts to the same tab, which today never happens (one reader
    /// thread per tab) but would be a footgun for future contributors.
    ///
    /// Sync (not async) so the reader thread's hot loop stays on a real
    /// OS thread without bouncing off the tokio runtime.
    pub fn broadcast(&self, tab_id: &str, raw_bytes: &[u8], decoded_str: &str) {
        if raw_bytes.is_empty() && decoded_str.is_empty() {
            return;
        }
        let state = match self.tabs.get(tab_id) {
            Some(s) => Arc::clone(&s),
            None => return,
        };

        // Assign seq + push to ring + write to sidecar shadow FIRST, before
        // any subscriber fan-out. This ordering matters for two reasons:
        //   1. If a Remote subscriber is added between now and the
        //      subs.lock() below, its subscribe-time ring replay will
        //      include this chunk — no gap.
        //   2. `sidecar.write_bytes(seq)` and the ring push must happen
        //      atomically relative to `state.next_seq`, otherwise the
        //      ordering guarantee subscribe_remote relies on for snapshot
        //      alignment breaks. Nothing awaits between them.
        let assigned_seq: Option<u64> = if !raw_bytes.is_empty() {
            let seq = state.next_seq.fetch_add(1, Ordering::AcqRel);
            state
                .ring
                .lock()
                .expect("ring lock poisoned")
                .push(seq, raw_bytes.to_vec());
            if let Some(sidecar) = &self.sidecar {
                sidecar.write_bytes(tab_id, raw_bytes, seq);
            }
            Some(seq)
        } else {
            None
        };

        // Single fan-out pass. Local subscribers get the decoded string;
        // Remote subscribers get base64-encoded raw bytes wrapped in a
        // ServerFrame::Bytes. Encoding is lazy so tabs with no remote
        // subscribers pay zero base64 cost.
        let mut subs = state.subscribers.lock().expect("subscribers lock poisoned");
        let mut dead: Vec<SubscriberId> = Vec::new();
        let mut encoded: Option<String> = None;

        for (sid, sub) in subs.iter() {
            match sub {
                Subscriber::Local(shared) => {
                    if decoded_str.is_empty() {
                        continue;
                    }
                    let send_failed = {
                        let guard = shared.lock().expect("channel lock poisoned");
                        match guard.as_ref() {
                            Some(ch) => ch
                                .send(PtyDataPayload {
                                    data: decoded_str.to_string(),
                                })
                                .is_err(),
                            // WebView disconnected; the next `open_tab`
                            // call will swap a fresh Channel into this
                            // SharedChannel. Skip without fault.
                            None => false,
                        }
                    };
                    if send_failed {
                        // Channel dropped mid-send (WebView vanished
                        // while we were forwarding). Clear so the next
                        // broadcast skips cleanly. Matches the pre-hub
                        // behaviour byte-for-byte.
                        shared
                            .lock()
                            .expect("channel lock poisoned")
                            .take();
                    }
                }
                Subscriber::Remote {
                    last_acked_seq,
                    outbox,
                } => {
                    // Remotes only get non-empty raw bytes; a decoded-only
                    // broadcast (EOF flush case) isn't representable on the
                    // wire protocol yet and gets dropped for Remotes.
                    let Some(seq) = assigned_seq else { continue };
                    // Dedup: skip if we've already sent (or the subscribe
                    // path replayed) this seq via the ring.
                    let acked = last_acked_seq.load(Ordering::Acquire);
                    if acked != REMOTE_ACK_UNSET && seq <= acked {
                        continue;
                    }
                    let data = encoded
                        .get_or_insert_with(|| B64.encode(raw_bytes))
                        .clone();
                    match outbox.send(ServerFrame::Bytes {
                        tab_id: tab_id.to_string(),
                        seq,
                        data,
                    }) {
                        Ok(()) => last_acked_seq.store(seq, Ordering::Release),
                        Err(_) => dead.push(*sid),
                    }
                }
            }
        }
        if !dead.is_empty() {
            subs.retain(|(id, _)| !dead.contains(id));
        }
    }

    /// Register a Remote subscriber for `tab_id`. Fetches the sidecar's
    /// current serialize payload (which includes state through the highest
    /// seq the sidecar has parsed so far) and delivers it as a Snapshot
    /// frame; then replays any ring entries with seqs newer than that
    /// snapshot's `last_seq`, catching up bytes that landed between the
    /// serialize call and the subscribers-lock acquisition.
    ///
    /// Returns `Some(SubscriberId)` on success. Returns `None` when the
    /// receiver is already dropped and initial delivery fails — no
    /// subscriber is registered in that case (would otherwise sit dead
    /// in the list until a broadcast triggers reap). Async because
    /// sidecar.serialize awaits a reply.
    pub async fn subscribe_remote(
        &self,
        tab_id: &str,
        outbox: mpsc::UnboundedSender<ServerFrame>,
        scrollback: u32,
    ) -> Option<SubscriberId> {
        let state = self
            .tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(80, 24, self.ring_cap_bytes)))
            .clone();

        let (payload, sidecar_seq) = self.fetch_snapshot(tab_id, scrollback).await;
        self.attach_remote_and_catch_up(&state, tab_id, outbox, payload, sidecar_seq)
    }

    /// Reconnect path: client's last-known seq is `last_seq`. If the ring
    /// still has the byte immediately after that seq, replay from there —
    /// no snapshot needed, cheap. Otherwise fall through to a fresh
    /// snapshot (same shape as `subscribe_remote`), including the client's
    /// implicit re-init of state from the snapshot payload.
    ///
    /// The "can replay" cut-off is `ring.front.seq <= last_seq + 1`. If the
    /// oldest ring entry is exactly the byte the client needs next, replay
    /// works; anything older has been evicted and the gap is unrecoverable
    /// without a fresh snapshot.
    pub async fn resume_remote(
        &self,
        tab_id: &str,
        outbox: mpsc::UnboundedSender<ServerFrame>,
        last_seq: u64,
        scrollback: u32,
    ) -> Option<SubscriberId> {
        let state = self
            .tabs
            .entry(tab_id.to_string())
            .or_insert_with(|| Arc::new(TabState::new(80, 24, self.ring_cap_bytes)))
            .clone();

        let can_replay = {
            let ring = state.ring.lock().expect("ring lock poisoned");
            !ring.entries.is_empty()
                && ring.entries.front().expect("checked non-empty above").0
                    <= last_seq.saturating_add(1)
        };

        if can_replay {
            let mut subs = state.subscribers.lock().expect("subscribers lock poisoned");
            let ring = state.ring.lock().expect("ring lock poisoned");
            let mut highest_delivered = last_seq;
            // Track outbox health across every ring-replay send. If the
            // receiver dropped mid-delivery, don't register a dead
            // subscriber that would sit in the list until a later
            // broadcast triggers the reap.
            let mut delivery_ok = true;
            for (seq, bytes) in ring.entries.iter() {
                if *seq > last_seq {
                    if outbox
                        .send(ServerFrame::Bytes {
                            tab_id: tab_id.to_string(),
                            seq: *seq,
                            data: B64.encode(bytes),
                        })
                        .is_err()
                    {
                        delivery_ok = false;
                        break;
                    }
                    highest_delivered = *seq;
                }
            }
            drop(ring);
            if !delivery_ok {
                eprintln!(
                    "[stream_hub] resume_remote({tab_id}): outbox closed \
                     mid-replay; skipping subscriber registration"
                );
                return None;
            }
            let id = SubscriberId(state.next_sub_id.fetch_add(1, Ordering::Relaxed));
            subs.push((
                id,
                Subscriber::Remote {
                    last_acked_seq: Arc::new(AtomicU64::new(highest_delivered)),
                    outbox,
                },
            ));
            Some(id)
        } else {
            let (payload, sidecar_seq) = self.fetch_snapshot(tab_id, scrollback).await;
            self.attach_remote_and_catch_up(&state, tab_id, outbox, payload, sidecar_seq)
        }
    }

    /// Sync helper shared by `subscribe_remote` and `resume_remote`'s
    /// gap-too-wide fallback. Holds `subscribers` + `ring` locks during the
    /// snapshot send + ring replay so no concurrent broadcast can slip in
    /// with a seq that would land between the snapshot's tail and the
    /// subscriber's registration.
    fn attach_remote_and_catch_up(
        &self,
        state: &Arc<TabState>,
        tab_id: &str,
        outbox: mpsc::UnboundedSender<ServerFrame>,
        payload: String,
        sidecar_seq: Option<u64>,
    ) -> Option<SubscriberId> {
        let mut subs = state.subscribers.lock().expect("subscribers lock poisoned");
        let ring = state.ring.lock().expect("ring lock poisoned");

        // Snapshot's seq on the wire: sidecar_seq if known, else 0 with an
        // empty payload. Client stores this for future resume requests.
        let snapshot_seq_on_wire = sidecar_seq.unwrap_or(0);
        if outbox
            .send(ServerFrame::Snapshot {
                tab_id: tab_id.to_string(),
                seq: snapshot_seq_on_wire,
                payload,
            })
            .is_err()
        {
            eprintln!(
                "[stream_hub] subscribe_remote({tab_id}): outbox closed \
                 before Snapshot delivery; skipping subscriber registration"
            );
            return None;
        }

        // Replay ring entries newer than the snapshot's coverage. Closes
        // the race where a broadcast landed between subscribe's serialize
        // call and this lock acquisition.
        let mut highest_delivered = sidecar_seq;
        for (seq, bytes) in ring.entries.iter() {
            let should_replay = match sidecar_seq {
                Some(t) => *seq > t,
                None => true,
            };
            if should_replay {
                if outbox
                    .send(ServerFrame::Bytes {
                        tab_id: tab_id.to_string(),
                        seq: *seq,
                        data: B64.encode(bytes),
                    })
                    .is_err()
                {
                    eprintln!(
                        "[stream_hub] subscribe_remote({tab_id}): outbox closed \
                         mid-replay; skipping subscriber registration"
                    );
                    return None;
                }
                highest_delivered = Some(*seq);
            }
        }
        drop(ring);

        // Initial ack: highest seq we actually delivered, or the "unset"
        // sentinel when nothing concrete has gone out yet (empty snapshot,
        // empty ring — first broadcast will pass the dedup gate).
        let initial_ack = highest_delivered.unwrap_or(REMOTE_ACK_UNSET);

        let id = SubscriberId(state.next_sub_id.fetch_add(1, Ordering::Relaxed));
        subs.push((
            id,
            Subscriber::Remote {
                last_acked_seq: Arc::new(AtomicU64::new(initial_ack)),
                outbox,
            },
        ));
        Some(id)
    }

    /// Ask the sidecar for a serialize snapshot; degrade to empty payload
    /// when the sidecar is absent or errors.
    async fn fetch_snapshot(
        &self,
        tab_id: &str,
        scrollback: u32,
    ) -> (String, Option<u64>) {
        match self.sidecar.as_ref() {
            Some(sc) => match sc.serialize(tab_id, scrollback).await {
                Ok(x) => x,
                Err(e) => {
                    eprintln!("[stream_hub] sidecar.serialize({tab_id}) failed: {e}");
                    (String::new(), None)
                }
            },
            None => (String::new(), None),
        }
    }

    /// Update the tab's known size and tell the sidecar to resize its
    /// shadow xterm. Sync + fire-and-forget so callers don't have to be
    /// async just to drag a divider.
    pub fn resize_tab(&self, tab_id: &str, cols: u16, rows: u16) {
        if let Some(state) = self.tabs.get(tab_id) {
            state.cols.store(cols, Ordering::Release);
            state.rows.store(rows, Ordering::Release);
        }
        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.resize_nonblocking(tab_id, cols, rows);
        }
    }

    /// Drop per-tab state and tell the sidecar to dispose its shadow.
    /// Sync + fire-and-forget. Called both from the user-facing close_tab
    /// command and from spawn_pty when restarting a tab whose previous
    /// PTY died (resets ring + seq + sidecar shadow so the new session
    /// doesn't inherit stale state).
    pub fn close_tab(&self, tab_id: &str) {
        self.tabs.remove(tab_id);
        if let Some(sidecar) = self.sidecar.as_ref() {
            sidecar.close_nonblocking(tab_id);
        }
    }

    // ---- introspection — used by tests and by future remote ops ----

    /// Read the current seq counter for a tab. Returns None if the tab is
    /// unknown. Mostly a test affordance today; future `subscribe_remote`
    /// will use it to stamp the snapshot frame.
    pub fn next_seq(&self, tab_id: &str) -> Option<u64> {
        self.tabs
            .get(tab_id)
            .map(|s| s.next_seq.load(Ordering::Acquire))
    }

    /// Snapshot of the current ring contents. Test affordance + future
    /// resume-remote path. Returns a clone so callers don't hold the lock.
    pub fn ring_entries(&self, tab_id: &str) -> Option<Vec<(u64, Vec<u8>)>> {
        self.tabs.get(tab_id).map(|s| {
            s.ring
                .lock()
                .expect("ring lock poisoned")
                .entries
                .iter()
                .cloned()
                .collect()
        })
    }

    /// Aggregate bytes currently held in the ring for `tab_id`.
    pub fn ring_bytes_held(&self, tab_id: &str) -> Option<usize> {
        self.tabs.get(tab_id).map(|s| {
            s.ring
                .lock()
                .expect("ring lock poisoned")
                .bytes_held
        })
    }

    /// Number of subscribers currently registered for `tab_id`.
    pub fn subscriber_count(&self, tab_id: &str) -> Option<usize> {
        self.tabs
            .get(tab_id)
            .map(|s| s.subscribers.lock().expect("subscribers lock poisoned").len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_hub() -> Arc<StreamHub> {
        StreamHub::new(None)
    }

    fn new_hub_with_cap(cap: usize) -> Arc<StreamHub> {
        StreamHub::with_ring_cap(None, cap)
    }

    #[test]
    fn ensure_tab_creates_state_at_zero_seq() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.subscriber_count("t1"), Some(0));
    }

    #[test]
    fn ensure_tab_is_idempotent() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"a", "a");
        // Re-ensuring must not reset seq or wipe state.
        hub.ensure_tab("t1", 120, 30);
        assert_eq!(hub.next_seq("t1"), Some(1));
    }

    #[test]
    fn broadcast_increments_seq_per_chunk() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        for _ in 0..5 {
            hub.broadcast("t1", b"x", "x");
        }
        assert_eq!(hub.next_seq("t1"), Some(5));
    }

    #[test]
    fn broadcast_pushes_raw_bytes_to_ring() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"hello", "hello");
        let entries = hub.ring_entries("t1").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, 0);
        assert_eq!(entries[0].1, b"hello");
    }

    #[test]
    fn ring_evicts_oldest_when_over_cap() {
        // Tiny cap so eviction kicks in after a few writes.
        let hub = new_hub_with_cap(100);
        hub.ensure_tab("t1", 80, 24);
        for i in 0..10u8 {
            hub.broadcast("t1", &[i; 20], "x");
        }
        let entries = hub.ring_entries("t1").unwrap();
        let total: usize = entries.iter().map(|(_, b)| b.len()).sum();
        assert!(total <= 100, "ring exceeded cap: {total}");
        // Newest entry must still be present — losing it would mean
        // dropping bytes the caller just claimed to broadcast.
        assert_eq!(entries.last().unwrap().0, 9);
        // Oldest entries should have been evicted.
        assert!(entries.first().unwrap().0 >= 5);
    }

    #[test]
    fn ring_keeps_single_oversize_entry() {
        let hub = new_hub_with_cap(50);
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", &vec![0u8; 500], "x");
        let entries = hub.ring_entries("t1").unwrap();
        assert_eq!(entries.len(), 1, "must not silently drop the only entry");
        assert_eq!(entries[0].1.len(), 500);
    }

    #[test]
    fn separate_tabs_have_independent_seqs() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.ensure_tab("t2", 80, 24);
        hub.broadcast("t1", b"a", "a");
        hub.broadcast("t1", b"b", "b");
        hub.broadcast("t2", b"x", "x");
        assert_eq!(hub.next_seq("t1"), Some(2));
        assert_eq!(hub.next_seq("t2"), Some(1));
    }

    #[test]
    fn broadcast_to_unknown_tab_is_silent() {
        let hub = new_hub();
        hub.broadcast("ghost", b"x", "x");
        assert_eq!(hub.next_seq("ghost"), None);
    }

    #[test]
    fn empty_broadcast_is_noop() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"", "");
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);
    }

    #[test]
    fn decoded_only_broadcast_skips_ring() {
        // Simulates the reader-thread EOF flush: decoder spits out a
        // partial-codepoint tail, raw bytes are empty.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"", "tail");
        // No raw bytes → no ring entry, no seq increment, no sidecar
        // (verified indirectly by ring + seq state).
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);
    }

    #[test]
    fn close_tab_drops_state() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        hub.broadcast("t1", b"hello", "hello");
        hub.close_tab("t1");
        assert_eq!(hub.next_seq("t1"), None);
        assert!(hub.ring_entries("t1").is_none());
    }

    /// Regression: when `spawn_pty` restarts a tab whose previous PTY
    /// expired, it calls `close_tab` then `ensure_tab` on the same id.
    /// The hub state must come up fresh — same seq counter as a brand-
    /// new tab, empty ring, no carried-over subscribers — otherwise
    /// remote subscribers' resume-by-seq math is wrong on the next
    /// session.
    #[test]
    fn close_then_ensure_resets_seq_ring_and_subscribers() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));

        // First session.
        hub.ensure_tab("t1", 80, 24);
        let _id = hub.subscribe_local("t1", make_chan());
        hub.broadcast("t1", b"first-session-bytes", "x");
        assert_eq!(hub.next_seq("t1"), Some(1));
        assert_eq!(hub.subscriber_count("t1"), Some(1));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 1);

        // Simulated respawn-after-expiry path.
        hub.close_tab("t1");
        hub.ensure_tab("t1", 80, 24);

        // Fresh state: seq back to zero, no subscribers, empty ring.
        assert_eq!(hub.next_seq("t1"), Some(0));
        assert_eq!(hub.subscriber_count("t1"), Some(0));
        assert_eq!(hub.ring_entries("t1").unwrap().len(), 0);

        // A new subscriber attaches cleanly and its broadcasts are
        // accounted against the fresh seq counter.
        hub.subscribe_local("t1", make_chan());
        hub.broadcast("t1", b"second-session", "x");
        assert_eq!(hub.next_seq("t1"), Some(1));
    }

    #[test]
    fn subscribe_local_returns_distinct_ids() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));
        let id1 = hub.subscribe_local("t1", make_chan());
        let id2 = hub.subscribe_local("t1", make_chan());
        let id3 = hub.subscribe_local("t1", make_chan());
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_eq!(hub.subscriber_count("t1"), Some(3));
    }

    #[test]
    fn unsubscribe_removes_only_named_subscriber() {
        let hub = new_hub();
        let make_chan = || Arc::new(Mutex::new(None));
        let id1 = hub.subscribe_local("t1", make_chan());
        let _id2 = hub.subscribe_local("t1", make_chan());
        assert_eq!(hub.subscriber_count("t1"), Some(2));
        hub.unsubscribe("t1", id1);
        assert_eq!(hub.subscriber_count("t1"), Some(1));
    }

    #[test]
    fn unsubscribe_unknown_tab_is_silent() {
        let hub = new_hub();
        hub.unsubscribe("ghost", SubscriberId(99));
        // No panic; nothing to verify beyond "didn't crash".
    }

    /// Stress: many threads broadcasting into different tabs hammer the
    /// DashMap shards. The hub must remain consistent: each tab's seq
    /// counter equals the number of broadcasts that hit it.
    #[test]
    fn concurrent_broadcasts_across_tabs_consistent() {
        let hub = new_hub();
        for t in 0..16 {
            hub.ensure_tab(&format!("t{t}"), 80, 24);
        }
        let handles: Vec<_> = (0..16)
            .map(|t| {
                let hub = Arc::clone(&hub);
                std::thread::spawn(move || {
                    for _ in 0..1000 {
                        hub.broadcast(&format!("t{t}"), b"x", "x");
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        for t in 0..16 {
            assert_eq!(hub.next_seq(&format!("t{t}")), Some(1000));
        }
    }

    // ---- Remote subscriber coverage ----
    //
    // These tests exercise the WSS-facing path. `StreamHub::new(None)` means
    // no sidecar, so `subscribe_remote` sends an empty-payload Snapshot at
    // seq 0 and initialises `last_acked_seq = REMOTE_ACK_UNSET`. That's
    // enough to lock in the wire-level behaviour; real-sidecar coverage
    // lives in the integration tests.

    /// Drain everything currently in an unbounded receiver into a Vec.
    /// Small helper to keep the test bodies focused on the assertions.
    fn drain(rx: &mut mpsc::UnboundedReceiver<ServerFrame>) -> Vec<ServerFrame> {
        let mut out = Vec::new();
        while let Ok(f) = rx.try_recv() {
            out.push(f);
        }
        out
    }

    #[tokio::test]
    async fn remote_subscribe_receives_snapshot_frame() {
        let hub = new_hub();
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.subscribe_remote("t1", tx, 500).await;
        let frames = drain(&mut rx);
        assert_eq!(frames.len(), 1, "exactly one Snapshot frame on subscribe");
        match &frames[0] {
            ServerFrame::Snapshot {
                tab_id,
                seq,
                payload,
            } => {
                assert_eq!(tab_id, "t1");
                // No sidecar → empty payload, seq 0 (client's local
                // last_seq starts there for future resume).
                assert_eq!(*seq, 0);
                assert_eq!(payload, "");
            }
            other => panic!("expected Snapshot, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn remote_subscribe_first_broadcast_delivered_despite_seq_zero() {
        // Regression pin for the sentinel-init dedup. Without
        // REMOTE_ACK_UNSET, initial last_acked would be 0 and the
        // dedup check `seq <= 0` would drop the first broadcast.
        let hub = new_hub();
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.subscribe_remote("t1", tx, 500).await;
        // Drop the snapshot frame — we care about what happens next.
        let _ = drain(&mut rx);
        hub.broadcast("t1", b"first", "first");
        let frames = drain(&mut rx);
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerFrame::Bytes { seq, data, .. } => {
                assert_eq!(*seq, 0);
                assert_eq!(data, &B64.encode(b"first"));
            }
            other => panic!("expected Bytes, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn remote_subscribe_replays_ring_entries_and_dedupes() {
        // Broadcasts land in the ring before the subscribe; the
        // subscribe path replays them as Bytes frames. Subsequent
        // broadcasts continue via the normal fan-out without duplicating
        // any of the replayed seqs.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        for i in 0..3u8 {
            hub.broadcast("t1", &[i], "x");
        }
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.subscribe_remote("t1", tx, 500).await;
        // Expect: Snapshot(seq=0, empty) + Bytes(seq=0,1,2) replayed from
        // ring (no sidecar → replay everything).
        let subscribe_frames = drain(&mut rx);
        assert!(matches!(subscribe_frames[0], ServerFrame::Snapshot { .. }));
        let byte_seqs: Vec<u64> = subscribe_frames[1..]
            .iter()
            .filter_map(|f| match f {
                ServerFrame::Bytes { seq, .. } => Some(*seq),
                _ => None,
            })
            .collect();
        assert_eq!(byte_seqs, vec![0, 1, 2]);

        // Next broadcast advances the seq — should arrive as Bytes(3),
        // NOT as a repeat of any replayed seq.
        hub.broadcast("t1", b"next", "next");
        let live_frames = drain(&mut rx);
        assert_eq!(live_frames.len(), 1);
        match &live_frames[0] {
            ServerFrame::Bytes { seq, .. } => assert_eq!(*seq, 3),
            other => panic!("expected Bytes, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn remote_resume_within_ring_replays_only_newer_bytes() {
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        for i in 0..5u8 {
            hub.broadcast("t1", &[i], "x");
        }
        // Client claims to have seen through seq 2 → server should
        // replay 3, 4 only. No Snapshot on the resume-within-ring path.
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.resume_remote("t1", tx, 2, 500).await;
        let frames = drain(&mut rx);
        let byte_seqs: Vec<u64> = frames
            .iter()
            .filter_map(|f| match f {
                ServerFrame::Bytes { seq, .. } => Some(*seq),
                _ => None,
            })
            .collect();
        assert_eq!(byte_seqs, vec![3, 4]);
        assert!(
            !frames
                .iter()
                .any(|f| matches!(f, ServerFrame::Snapshot { .. })),
            "no Snapshot on the in-ring resume path"
        );
    }

    #[tokio::test]
    async fn remote_resume_beyond_ring_falls_through_to_snapshot() {
        // Tiny ring so eviction bites after a few writes.
        let hub = new_hub_with_cap(20);
        hub.ensure_tab("t1", 80, 24);
        for i in 0..50u8 {
            hub.broadcast("t1", &[i; 10], "x");
        }
        // Ring now holds only the tail (single ~10-byte entry). Client's
        // last_seq=0 is way outside the ring's coverage → fall through
        // to Snapshot.
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.resume_remote("t1", tx, 0, 500).await;
        let frames = drain(&mut rx);
        assert!(
            frames
                .iter()
                .any(|f| matches!(f, ServerFrame::Snapshot { .. })),
            "gap-too-wide resume must send a fresh Snapshot"
        );
    }

    #[tokio::test]
    async fn subscribe_remote_returns_none_when_outbox_already_closed() {
        // Regression pin: if the outbox receiver is already dropped
        // by the time subscribe_remote runs, the function must NOT
        // register a dead subscriber (which would sit in the list
        // until a future broadcast triggers the reap). It returns
        // None and subscriber_count stays at zero.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        let (tx, rx) = mpsc::unbounded_channel::<ServerFrame>();
        drop(rx);
        let id = hub.subscribe_remote("t1", tx, 500).await;
        assert!(id.is_none(), "closed outbox must not produce a SubscriberId");
        assert_eq!(hub.subscriber_count("t1"), Some(0));
    }

    #[tokio::test]
    async fn resume_remote_returns_none_when_outbox_closed_mid_replay() {
        // Same regression pin for the resume-within-ring fast path.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        for i in 0..3u8 {
            hub.broadcast("t1", &[i], "x");
        }
        let (tx, rx) = mpsc::unbounded_channel::<ServerFrame>();
        drop(rx);
        let id = hub.resume_remote("t1", tx, 0, 500).await;
        assert!(id.is_none(), "closed outbox must not produce a SubscriberId");
        assert_eq!(hub.subscriber_count("t1"), Some(0));
    }

    #[tokio::test]
    async fn remote_disconnect_reaps_on_next_broadcast() {
        let hub = new_hub();
        let (tx, rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _id = hub.subscribe_remote("t1", tx, 500).await;
        assert_eq!(hub.subscriber_count("t1"), Some(1));
        // Drop the receiver; the outbox now returns Err on send.
        drop(rx);
        // First broadcast attempts to send, gets Err, marks dead, retains
        // trimmed list.
        hub.broadcast("t1", b"post-drop", "x");
        assert_eq!(
            hub.subscriber_count("t1"),
            Some(0),
            "dead remote must be reaped on the next broadcast"
        );
    }

    #[tokio::test]
    async fn local_and_remote_subscribers_coexist() {
        // Regression pin for the master invariant: the desktop path must
        // stay byte-identical while a phone is also attached. This test
        // asserts that broadcasts reach BOTH a local subscriber and a
        // remote subscriber without cross-interference.
        let hub = new_hub();
        hub.ensure_tab("t1", 80, 24);
        let local_ch: SharedChannel = Arc::new(Mutex::new(None));
        let _local_id = hub.subscribe_local("t1", Arc::clone(&local_ch));
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerFrame>();
        let _remote_id = hub.subscribe_remote("t1", tx, 500).await;
        assert_eq!(hub.subscriber_count("t1"), Some(2));

        // Skip the Snapshot the subscribe just emitted.
        let _ = drain(&mut rx);

        hub.broadcast("t1", b"shared", "shared-decoded");

        // Remote received bytes.
        let remote_frames = drain(&mut rx);
        assert_eq!(remote_frames.len(), 1);
        match &remote_frames[0] {
            ServerFrame::Bytes { data, .. } => {
                assert_eq!(data, &B64.encode(b"shared"));
            }
            other => panic!("expected Bytes, got {other:?}"),
        }
        // Local subscriber is on a Tauri Channel which we can't easily
        // observe in-process. Its presence (subscriber_count=2 after
        // subscribe and no reaping) plus the "no panic / no lock
        // contention" success of the broadcast is the regression pin.
    }
}
