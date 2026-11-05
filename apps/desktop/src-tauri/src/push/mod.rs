//! Push escalation: hand a missed desktop notification to the paired
//! phone, and only a missed one.
//!
//! ## The model
//!
//! The phone is a second chance, not a mirror. Mirroring every banner
//! trains the user to swipe the phone notification away unread, which
//! kills the one case that matters. So a notification escalates only
//! when the desktop one went unseen, and "seen" has exactly one
//! definition, the one the user named:
//!
//! ```text
//! seen := desktop window foreground AND active tab == the notifying tab
//! ```
//!
//! Both terms already stream into `NotificationService` from the
//! renderer (`notif_set_app_focus`, `notif_set_active_tab`), so the
//! oracle costs no new instrumentation. `NotificationService` calls
//! `mark_seen` the moment the pair matches.
//!
//! ## Why the desktop is the sender
//!
//! An agent can only change state while the Mac is awake, so the one
//! machine that knows something happened is awake exactly when it needs
//! to speak. Every architecture with a relay server exists to solve a
//! store-and-forward problem this feature does not have, so there is no
//! backend here: the desktop POSTs to Expo itself with `reqwest`, which
//! was already a dependency.
//!
//! ## Layout
//!
//! - `escalation` is pure: the decision, the rate budget, the rendering.
//!   Every edge case is a table test there rather than a timing-
//!   dependent integration test here.
//! - `sign` is pure: the payload MAC, keyed on the pairing secret.
//! - `expo` is the transport.
//! - this file owns the state, the clock and the I/O.

pub mod escalation;
pub mod expo;
pub mod sign;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

use crate::notifications::AgentNotifyState;
use crate::pairing::PairedTokens;

use escalation::{CancelReason, DevicePrefs, DropReason, Outcome, Pending, RateBudget, decide, render};

// ─── Constants ───────────────────────────────────────────────────────────────

/// Grace window default, overridable per device from the phone. Three
/// minutes rather than the 45 seconds this started at: a user can be at
/// their desk and heads-down in another window for a long time, and the
/// window exists to let them notice on their own first.
pub const DEFAULT_DELAY_SECONDS: u32 = 180;

/// Accepted range for the phone-supplied delay. The register handler
/// clamps rather than rejecting, so a future companion build degrades to
/// something sane instead of disabling the feature with an error the
/// user cannot act on.
pub const DELAY_MIN_SECONDS: u32 = 0;
pub const DELAY_MAX_SECONDS: u32 = 1800;

/// How long a notification stays worth sending AFTER it came due.
///
/// Anchored to the deadline, not to the fire time. Anchoring it to the
/// fire time made any delay at or beyond the ceiling self-defeating: it
/// would drop as stale the instant it came due, with no error and no
/// clue why.
pub const STALE_AFTER_DUE: Duration = Duration::from_secs(10 * 60);

/// Minimum spacing between pushes for one tab on one device.
pub const PER_TAB_FLOOR: Duration = Duration::from_secs(60);

/// Global token bucket per device: burst 3, refilling to roughly 6 per
/// five minutes.
pub const BUCKET_CAPACITY: u32 = 3;
pub const BUCKET_REFILL_PER: Duration = Duration::from_secs(50);

/// Tick interval for the single escalation loop. Matches the reconcile
/// tick idiom in `agent_state.rs`; at a handful of tabs a timer wheel
/// would be unjustified complexity, and one loop keeps sleep-wake
/// handling in a single place.
pub const TICK: Duration = Duration::from_secs(1);

/// Added to every pending deadline when a sleep-wake is observed.
pub const POST_WAKE_GRACE: Duration = Duration::from_secs(10);

/// A wall-clock jump larger than this inside one tick means the machine
/// slept: `Instant` does not advance while it does.
pub const WAKE_JUMP: Duration = Duration::from_secs(3);

// ─── Service ─────────────────────────────────────────────────────────────────

/// What the phone needs to know about this desktop's push support.
///
/// Sent unprompted right after `AuthOk`, and its *presence* is the
/// capability advertisement: the desktop closes the whole WebSocket on a
/// `ClientFrame` it cannot deserialise, so a newer companion that
/// registers blind against an older Mac would disconnect the terminal
/// session on every connect. The phone waits for this frame before it
/// sends `RegisterPush`.
// Consumed by the WSS RegisterPush / UnregisterPush handlers.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct PushStatusView {
    pub supported: bool,
    pub registered: bool,
    pub delay_seconds: u32,
    pub redact_names: bool,
    pub last_error: Option<String>,
}

/// Everything needed to arm one escalation. A struct rather than seven
/// positional arguments, which is both unreadable and easy to transpose.
pub struct ScheduleRequest<'a> {
    pub composite_tab_id: &'a str,
    pub project_id: &'a str,
    pub tab_id_in_project: &'a str,
    pub agent_id: &'a str,
    pub state: AgentNotifyState,
    pub title: &'a str,
    pub body: &'a str,
}

pub struct PushService {
    tokens: Arc<PairedTokens>,
    inner: Mutex<Inner>,
    client: reqwest::Client,
}

struct Inner {
    /// One per composite tab id.
    pending: HashMap<String, Pending>,
    /// Current fused state per tab, fed by every `maybe_notify` call
    /// including the non-firing ones. This is what rule 4 revalidates
    /// against at send time, and keeping our own copy avoids a second
    /// lock on the mod engine from the tick loop.
    live: HashMap<String, AgentNotifyState>,
    budget: RateBudget,
    last_tick_wall: i64,
}

impl PushService {
    pub fn new(app: AppHandle, tokens: Arc<PairedTokens>) -> Arc<Self> {
        let svc = Arc::new(Self {
            tokens,
            inner: Mutex::new(Inner {
                pending: HashMap::new(),
                live: HashMap::new(),
                budget: RateBudget::default(),
                last_tick_wall: now_wall(),
            }),
            client: reqwest::Client::new(),
        });
        let tick_svc = svc.clone();
        drop(app);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(TICK);
            loop {
                ticker.tick().await;
                tick_svc.clone().tick().await;
            }
        });
        svc
    }

    /// Record the tab's current state. Called for every transition,
    /// firing or not, so rule 4 has something current to compare
    /// against.
    pub fn note_state(&self, tab: &str, state: AgentNotifyState) {
        self.inner
            .lock()
            .unwrap()
            .live
            .insert(tab.to_string(), state);
    }

    /// Arm an escalation. Replacing an existing pending for the same tab
    /// resets the clock and refills the device set, because the newer
    /// state is the one worth telling the user about.
    pub fn schedule(&self, req: ScheduleRequest<'_>) {
        let ScheduleRequest {
            composite_tab_id,
            project_id,
            tab_id_in_project,
            agent_id,
            state,
            title,
            body,
        } = req;
        let recipients: HashSet<String> = self
            .tokens
            .with_push_tokens()
            .into_iter()
            .map(|d| d.id)
            .collect();
        if recipients.is_empty() {
            return;
        }
        let mut inner = self.inner.lock().unwrap();
        if inner.pending.contains_key(composite_tab_id) {
            log_outcome(composite_tab_id, "all", &Outcome::Cancelled(CancelReason::Superseded));
        }
        inner.pending.insert(
            composite_tab_id.to_string(),
            Pending {
                composite_tab_id: composite_tab_id.to_string(),
                project_id: project_id.to_string(),
                tab_id_in_project: tab_id_in_project.to_string(),
                agent_id: agent_id.to_string(),
                state,
                title: title.to_string(),
                body: body.to_string(),
                fired_at: Instant::now(),
                fired_at_wall: now_wall(),
                wake_grace: Duration::ZERO,
                remaining: recipients,
            },
        );
    }

    /// The seen oracle fired: the user is looking at this tab on the
    /// desktop. Drop the escalation for every device.
    pub fn mark_seen(&self, tab: &str) {
        self.cancel(tab, CancelReason::Seen);
    }

    pub fn cancel(&self, tab: &str, why: CancelReason) {
        let removed = self.inner.lock().unwrap().pending.remove(tab);
        if removed.is_some() {
            log_outcome(tab, "all", &Outcome::Cancelled(why));
        }
    }

    /// The tab is gone. Drop both the escalation and the state we were
    /// going to revalidate it against.
    pub fn forget_tab(&self, tab: &str) {
        let mut inner = self.inner.lock().unwrap();
        let had = inner.pending.remove(tab).is_some();
        inner.live.remove(tab);
        drop(inner);
        if had {
            log_outcome(tab, "all", &Outcome::Cancelled(CancelReason::TabClosed));
        }
    }

    /// A device registered or unregistered. Re-evaluate on the next
    /// tick, and stop holding budget for a device that is gone.
    #[allow(dead_code)] // wired by the WSS RegisterPush handler
    pub fn devices_changed(&self, device_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        let still_registered = self
            .tokens
            .with_push_tokens()
            .iter()
            .any(|d| d.id == device_id);
        if !still_registered {
            inner.budget.forget_device(device_id);
            for p in inner.pending.values_mut() {
                p.remaining.remove(device_id);
            }
            inner.pending.retain(|_, p| !p.remaining.is_empty());
        }
    }

    #[allow(dead_code)] // wired by the WSS handshake
    pub fn status_for(&self, device_id: &str) -> PushStatusView {
        let d = self.tokens.get(device_id);
        PushStatusView {
            supported: true,
            registered: d.as_ref().and_then(|d| d.push_token.as_ref()).is_some(),
            delay_seconds: d
                .as_ref()
                .map(|d| d.push_delay_seconds)
                .unwrap_or(DEFAULT_DELAY_SECONDS),
            redact_names: d.as_ref().map(|d| d.push_redact_names).unwrap_or(false),
            last_error: d.and_then(|d| d.push_last_error),
        }
    }

    async fn tick(self: Arc<Self>) {
        let due: Vec<(Pending, DevicePrefs)> = {
            let prefs: HashMap<String, DevicePrefs> = self
                .tokens
                .with_push_tokens()
                .into_iter()
                .map(|d| {
                    (
                        d.id.clone(),
                        DevicePrefs {
                            device_id: d.id,
                            token: d.push_token,
                            token_hash: d.token_hash,
                            platform: d.push_platform.unwrap_or_else(|| "android".to_string()),
                            delay: Duration::from_secs(d.push_delay_seconds as u64),
                            redact_names: d.push_redact_names,
                        },
                    )
                })
                .collect();

            let now = Instant::now();
            let wall = now_wall();
            let mut inner = self.inner.lock().unwrap();

            // Sleep-wake detection. `Instant` stands still while the Mac
            // sleeps, so a deadline set before a three hour nap still has
            // its full remaining time on wake. Give the user who just
            // opened the lid a moment to see the banner first.
            if wall.saturating_sub(inner.last_tick_wall) > WAKE_JUMP.as_millis() as i64 {
                for p in inner.pending.values_mut() {
                    p.wake_grace += POST_WAKE_GRACE;
                }
            }
            inner.last_tick_wall = wall;

            if prefs.is_empty() {
                for tab in inner.pending.keys().cloned().collect::<Vec<_>>() {
                    log_outcome(&tab, "none", &Outcome::Dropped(DropReason::NoDevices));
                }
                inner.pending.clear();
                return;
            }

            let mut due = Vec::new();
            let tabs: Vec<String> = inner.pending.keys().cloned().collect();
            for tab in tabs {
                let live = inner.live.get(&tab).copied();
                let Some(pending) = inner.pending.get(&tab).cloned() else {
                    continue;
                };
                for device_id in pending.remaining.iter() {
                    let Some(device) = prefs.get(device_id) else {
                        // Paired but no longer registered.
                        if let Some(p) = inner.pending.get_mut(&tab) {
                            p.remaining.remove(device_id);
                        }
                        continue;
                    };
                    let outcome = decide(
                        &pending,
                        device,
                        live,
                        false,
                        now,
                        wall,
                        &mut inner.budget,
                    );
                    match outcome {
                        Outcome::Wait => {}
                        Outcome::Send => {
                            due.push((pending.clone(), device.clone()));
                            if let Some(p) = inner.pending.get_mut(&tab) {
                                p.remaining.remove(device_id);
                            }
                        }
                        ref terminal => {
                            log_outcome(&tab, device_id, terminal);
                            if let Some(p) = inner.pending.get_mut(&tab) {
                                p.remaining.remove(device_id);
                            }
                        }
                    }
                }
                if inner
                    .pending
                    .get(&tab)
                    .map(|p| p.remaining.is_empty())
                    .unwrap_or(false)
                {
                    inner.pending.remove(&tab);
                }
            }
            due
        };

        // Dispatch outside the lock. PushService must never be holding
        // its mutex while NotificationService might call into it, and
        // vice versa.
        for (pending, device) in due {
            self.deliver(&pending, &device).await;
        }
    }

    async fn deliver(&self, pending: &Pending, device: &DevicePrefs) {
        let Some(token) = device.token.clone() else {
            return;
        };
        let (title, body) = render(pending, device);
        let state = state_slug(pending.state);
        let msg = sign::canonical_for(pending, &device.device_id, state);
        let signature = sign::sign(&device.token_hash, &msg);

        let message = expo::build_message(
            &token,
            pending,
            device,
            &title,
            &body,
            state,
            &signature,
        );

        // Deliberately logs no title, body or token: notification
        // content is sensitive and a push token is a send capability.
        eprintln!(
            "[push] sending tab={} state={state} device={}",
            pending.composite_tab_id, device.device_id
        );

        match expo::send(&self.client, &message).await {
            Ok(()) => {
                let _ = self.tokens.set_push_error(&device.device_id, None);
                let mut inner = self.inner.lock().unwrap();
                inner.budget.commit(
                    &device.device_id,
                    &pending.composite_tab_id,
                    Instant::now(),
                );
            }
            Err(expo::SendError::DeviceNotRegistered) => {
                eprintln!(
                    "[push] device {} no longer registered, clearing token",
                    device.device_id
                );
                let _ = self.tokens.clear_push_token(&device.device_id);
            }
            Err(e @ expo::SendError::Credentials(_)) => {
                eprintln!("[push] credentials problem: {e}");
                let _ = self
                    .tokens
                    .set_push_error(&device.device_id, Some(e.to_string()));
            }
            Err(e) => eprintln!("[push] send failed: {e}"),
        }
    }
}

/// Wire name for a state, shared by the signature and the payload so the
/// two can never disagree.
pub fn state_slug(state: AgentNotifyState) -> &'static str {
    match state {
        AgentNotifyState::Idle => "idle",
        AgentNotifyState::InProgress => "in-progress",
        AgentNotifyState::Awaiting => "awaiting",
        AgentNotifyState::Completed => "completed",
        AgentNotifyState::Error => "error",
    }
}

pub fn clamp_delay(seconds: u32) -> u32 {
    seconds.clamp(DELAY_MIN_SECONDS, DELAY_MAX_SECONDS)
}

fn now_wall() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn log_outcome(tab: &str, device: &str, outcome: &Outcome) {
    eprintln!("[push] {tab} device={device}: {outcome:?}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_is_clamped_rather_than_rejected() {
        assert_eq!(clamp_delay(0), 0);
        assert_eq!(clamp_delay(180), 180);
        assert_eq!(clamp_delay(99_999), DELAY_MAX_SECONDS);
    }

    #[test]
    fn state_slugs_are_the_kebab_case_wire_names() {
        assert_eq!(state_slug(AgentNotifyState::Awaiting), "awaiting");
        assert_eq!(state_slug(AgentNotifyState::InProgress), "in-progress");
        assert_eq!(state_slug(AgentNotifyState::Completed), "completed");
        assert_eq!(state_slug(AgentNotifyState::Error), "error");
    }
}
