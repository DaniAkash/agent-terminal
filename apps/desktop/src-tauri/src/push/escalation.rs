//! Pure escalation logic. No I/O, no Tauri, no Keychain, no clock of its
//! own: everything arrives as an argument so the whole decision surface
//! is a table test rather than a set of sleeps.
//!
//! ## The rule this file encodes
//!
//! A desktop notification escalates to a paired phone only when the user
//! missed it, and "missed" has exactly one definition: the desktop was
//! never foreground with the notifying tab active during the grace
//! window. That predicate is evaluated by `NotificationService`, which
//! already tracks both terms, and arrives here as the `seen` flag.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::notifications::AgentNotifyState;

use super::{BUCKET_CAPACITY, BUCKET_REFILL_PER, PER_TAB_FLOOR, STALE_AFTER_DUE};

/// One registered phone, as the desktop knows it. Built from a
/// `PairedDevice` record; the phone is the only writer of the
/// preferences, delivered over `ClientFrame::RegisterPush`.
///
/// There is deliberately no `enabled` field. A device with a token wants
/// push; a device without one does not. Collapsing the toggle into token
/// presence removes the state where a token exists but must not be used,
/// which is the state a separate flag eventually drifts into.
#[derive(Debug, Clone)]
pub struct DevicePrefs {
    pub device_id: String,
    /// `None` means unregistered, which is also how "switched off on the
    /// phone" is represented.
    pub token: Option<String>,
    /// SHA-256 hex of the device token, which `PairedDevice` already
    /// stores. Doubles as the payload signing key: the phone holds the
    /// raw token and derives the same value, so neither side has to
    /// transmit a secret to agree on one.
    pub token_hash: String,
    pub platform: String,
    pub delay: Duration,
    pub redact_names: bool,
}

impl DevicePrefs {
    pub fn is_ios(&self) -> bool {
        self.platform.eq_ignore_ascii_case("ios")
    }
}

/// One tab's in-flight escalation. At most one per tab: a newer
/// transition replaces the older one and resets `fired_at`, because the
/// newer state is the one worth telling the user about.
#[derive(Debug, Clone)]
pub struct Pending {
    pub composite_tab_id: String,
    pub project_id: String,
    pub tab_id_in_project: String,
    pub agent_id: String,
    pub state: AgentNotifyState,
    /// Exactly the strings the desktop banner used. One source of truth
    /// for the copy, so the phone reads identically to the Mac.
    pub title: String,
    pub body: String,
    /// Monotonic. Each device's deadline is derived as
    /// `fired_at + device.delay + wake_grace`.
    pub fired_at: Instant,
    /// Epoch ms. `Instant` does not advance while the Mac sleeps, so the
    /// staleness check needs a wall clock to notice that three hours
    /// passed.
    pub fired_at_wall: i64,
    /// Accumulated grace added on each observed sleep-wake, so a user who
    /// has just opened the lid gets a chance to see the banner before
    /// their pocket buzzes.
    pub wake_grace: Duration,
    /// Registered devices that have not yet reached a terminal outcome.
    /// The pending is dropped once this empties. With one phone paired,
    /// which is the common case, this is a set of one.
    pub remaining: HashSet<String>,
}

impl Pending {
    /// When this device's notification comes due, in wall-clock ms.
    fn due_wall(&self, device: &DevicePrefs) -> i64 {
        self.fired_at_wall + (device.delay + self.wake_grace).as_millis() as i64
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Hold. The deadline has not arrived and nothing cancelled it.
    Wait,
    /// Send to this device.
    Send,
    /// The user dealt with it, or the device opted out. Forget it.
    Cancelled(CancelReason),
    /// The deadline arrived but sending would be wrong or useless.
    Dropped(DropReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Seen,
    /// Release-build only: the user clicked the macOS banner, which is
    /// unambiguous evidence they saw it.
    #[cfg_attr(debug_assertions, allow(dead_code))]
    Clicked,
    TabClosed,
    Unregistered,
    Superseded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    StateChanged,
    Stale,
    RateLimited,
    NoDevices,
}

/// Two layers, because the two failure modes differ. The per-tab floor
/// stops one thrashing agent monopolising attention; the bucket stops ten
/// tabs finishing at once from emptying a battery. Keyed per device
/// because a bucket is about one recipient's attention, not the Mac's
/// output rate.
#[derive(Debug, Default)]
pub struct RateBudget {
    by_device: HashMap<String, DeviceBudget>,
}

#[derive(Debug)]
struct DeviceBudget {
    last_sent: HashMap<String, Instant>,
    /// Outstanding reservations, with what `last_sent` held before each
    /// one, so releasing a hold can put the per-tab floor back exactly
    /// as it was. At most one per tab: the floor refuses a second hold
    /// on a tab that already has one.
    holds: HashMap<String, Option<Instant>>,
    tokens: f64,
    last_refill: Instant,
}

impl RateBudget {
    /// Take capacity for a send that is about to be dispatched, and
    /// return whether there was any.
    ///
    /// Consuming here rather than after the send is what makes
    /// `BUCKET_CAPACITY` bound a burst at all. Checking without
    /// consuming let every tab that came due in the same tick observe
    /// the same full bucket, so ten tabs finishing together all queued
    /// and the cap bounded nothing. Each hold is then either made
    /// permanent with `redeem` or handed back with `release`.
    pub fn reserve(&mut self, device_id: &str, tab: &str, now: Instant) -> bool {
        let b = self.entry(device_id, now);
        b.refill(now);
        if let Some(prev) = b.last_sent.get(tab) {
            if now.saturating_duration_since(*prev) < PER_TAB_FLOOR {
                return false;
            }
        }
        if b.tokens < 1.0 {
            return false;
        }
        b.tokens -= 1.0;
        let prev = b.last_sent.insert(tab.to_string(), now);
        b.holds.insert(tab.to_string(), prev);
        true
    }

    /// The send happened. The hold stands.
    pub fn redeem(&mut self, device_id: &str, tab: &str) {
        if let Some(b) = self.by_device.get_mut(device_id) {
            b.holds.remove(tab);
        }
    }

    /// The send failed. Hand the capacity back, and put the per-tab
    /// floor back where it was: a notification that never left must not
    /// suppress the next one for the same tab for a minute.
    pub fn release(&mut self, device_id: &str, tab: &str) {
        let Some(b) = self.by_device.get_mut(device_id) else {
            return;
        };
        let Some(prev) = b.holds.remove(tab) else {
            return;
        };
        b.tokens = (b.tokens + 1.0).min(BUCKET_CAPACITY as f64);
        match prev {
            Some(at) => {
                b.last_sent.insert(tab.to_string(), at);
            }
            None => {
                b.last_sent.remove(tab);
            }
        }
    }

    #[allow(dead_code)] // called from devices_changed
    pub fn forget_device(&mut self, device_id: &str) {
        self.by_device.remove(device_id);
    }

    fn entry(&mut self, device_id: &str, now: Instant) -> &mut DeviceBudget {
        self.by_device
            .entry(device_id.to_string())
            .or_insert_with(|| DeviceBudget {
                last_sent: HashMap::new(),
                holds: HashMap::new(),
                tokens: BUCKET_CAPACITY as f64,
                last_refill: now,
            })
    }
}

impl DeviceBudget {
    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last_refill).as_secs_f64();
        if elapsed <= 0.0 {
            return;
        }
        let per = BUCKET_REFILL_PER.as_secs_f64();
        self.tokens = (self.tokens + elapsed / per).min(BUCKET_CAPACITY as f64);
        self.last_refill = now;
    }
}

/// Evaluated once per (pending tab, registered device).
///
/// The ordering below is load bearing and is itself a test. Moving `seen`
/// after the deadline check, for instance, would escalate the common case
/// where the user reads the banner inside the window.
///
/// Not pure in one respect: an `Outcome::Send` has taken a reservation
/// out of the device's rate budget, which the caller must redeem or
/// release once the send has been attempted.
pub fn decide(
    pending: &Pending,
    device: &DevicePrefs,
    live_state: Option<AgentNotifyState>,
    seen: bool,
    now: Instant,
    now_wall: i64,
    budget: &mut RateBudget,
) -> Outcome {
    if device.token.is_none() {
        return Outcome::Cancelled(CancelReason::Unregistered);
    }
    if seen {
        return Outcome::Cancelled(CancelReason::Seen);
    }
    if now < pending.fired_at + device.delay + pending.wake_grace {
        return Outcome::Wait;
    }
    // The highest leverage rule here. Revalidating against the live state
    // at send time subsumes a family of cases that timer bookkeeping
    // handles badly: the prompt was answered from the phone, the agent
    // moved on by itself, the question was superseded, the tab respawned.
    // One comparison replaces all of them, so resist deleting it as
    // redundant.
    if live_state != Some(pending.state) {
        return Outcome::Dropped(DropReason::StateChanged);
    }
    // Anchored to when this notification came DUE, not to when it fired.
    // The fire-time version made any delay at or beyond the ceiling drop
    // itself as stale the instant it came due.
    if now_wall.saturating_sub(pending.due_wall(device)) > STALE_AFTER_DUE.as_millis() as i64 {
        return Outcome::Dropped(DropReason::Stale);
    }
    // Last, and it consumes: every earlier rule returns before a hold
    // is taken, so a dropped or cancelled outcome still costs nothing.
    // The caller redeems the hold once the send succeeded and releases
    // it when it did not.
    if !budget.reserve(&device.device_id, &pending.composite_tab_id, now) {
        return Outcome::Dropped(DropReason::RateLimited);
    }
    Outcome::Send
}

/// Visible text for the wire, honouring the device's redaction choice.
/// Separate from `decide` so the redaction tests do not need a full
/// decision, and so the caller can render once per device.
pub fn render(pending: &Pending, device: &DevicePrefs) -> (String, String) {
    if !device.redact_names {
        return (pending.title.clone(), pending.body.clone());
    }
    let title = match pending.state {
        AgentNotifyState::Awaiting => "An agent needs your attention",
        AgentNotifyState::Completed => "An agent finished its turn",
        AgentNotifyState::Error => "An agent exited unexpectedly",
        _ => "Agent update",
    };
    (title.to_string(), "Open Agent Terminal to continue".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALL: i64 = 1_762_338_240_000;

    fn base() -> Instant {
        Instant::now()
    }

    fn pending_at(now: Instant, state: AgentNotifyState) -> Pending {
        Pending {
            composite_tab_id: "proj_01HQ:tab_04".to_string(),
            project_id: "proj_01HQ".to_string(),
            tab_id_in_project: "tab_04".to_string(),
            agent_id: "claude-code".to_string(),
            state,
            title: "Claude Code · control-center".to_string(),
            body: "Allow edit to src/push/mod.rs?".to_string(),
            fired_at: now,
            fired_at_wall: WALL,
            wake_grace: Duration::ZERO,
            remaining: HashSet::from(["dev-1".to_string()]),
        }
    }

    fn device(delay_secs: u64) -> DevicePrefs {
        DevicePrefs {
            device_id: "dev-1".to_string(),
            token: Some("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".to_string()),
            token_hash: "a".repeat(64),
            platform: "ios".to_string(),
            delay: Duration::from_secs(delay_secs),
            redact_names: false,
        }
    }

    /// Wall clock advanced in step with the monotonic clock, which is the
    /// normal case. The sleep cases pass a wall jump without a matching
    /// Instant jump on purpose.
    fn wall_after(d: Duration) -> i64 {
        WALL + d.as_millis() as i64
    }

    // 1
    #[test]
    fn seen_inside_the_window_cancels() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            true,
            now + Duration::from_secs(30),
            wall_after(Duration::from_secs(30)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Cancelled(CancelReason::Seen));
    }

    // 2
    #[test]
    fn due_with_matching_state_sends() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(181),
            wall_after(Duration::from_secs(181)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Send);
    }

    // 3
    #[test]
    fn state_moved_on_drops() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::InProgress),
            false,
            now + Duration::from_secs(181),
            wall_after(Duration::from_secs(181)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Dropped(DropReason::StateChanged));
    }

    // 4
    #[test]
    fn before_the_deadline_waits() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(179),
            wall_after(Duration::from_secs(179)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Wait);
    }

    // 5 (supersede is a service-level behaviour; this pins the primitive
    // it relies on: a fresh fired_at pushes the deadline out again)
    #[test]
    fn resetting_fired_at_pushes_the_deadline_out() {
        let now = base();
        let mut p = pending_at(now, AgentNotifyState::Awaiting);
        p.fired_at = now + Duration::from_secs(100);
        p.fired_at_wall = wall_after(Duration::from_secs(100));
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(200),
            wall_after(Duration::from_secs(200)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Wait);
    }

    // 6, 7 (TabClosed and Unregistered)
    #[test]
    fn missing_token_cancels_as_unregistered() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let mut d = device(180);
        d.token = None;
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(181),
            wall_after(Duration::from_secs(181)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Cancelled(CancelReason::Unregistered));
    }

    /// Unregistering outranks everything else, including a state that has
    /// already moved on, so a device that opted out never shows up in the
    /// drop statistics as though it had been considered.
    #[test]
    fn unregistered_outranks_state_change() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let mut d = device(0);
        d.token = None;
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Idle),
            false,
            now + Duration::from_secs(10),
            wall_after(Duration::from_secs(10)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Cancelled(CancelReason::Unregistered));
    }

    // 8
    #[test]
    fn second_push_for_a_tab_inside_the_floor_is_rate_limited() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(0);
        let mut budget = RateBudget::default();
        assert!(budget.reserve(&d.device_id, &p.composite_tab_id, now));
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(30),
            wall_after(Duration::from_secs(30)),
            &mut budget,
        );
        assert_eq!(out, Outcome::Dropped(DropReason::RateLimited));
    }

    // 9
    #[test]
    fn exhausted_bucket_rate_limits_across_tabs() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        for i in 0..BUCKET_CAPACITY {
            assert!(budget.reserve(&d.device_id, &format!("proj:tab{i}"), now));
        }
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(1),
            wall_after(Duration::from_secs(1)),
            &mut budget,
        );
        assert_eq!(out, Outcome::Dropped(DropReason::RateLimited));
    }

    #[test]
    fn the_bucket_refills_over_time() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        for i in 0..BUCKET_CAPACITY {
            assert!(budget.reserve(&d.device_id, &format!("proj:tab{i}"), now));
        }
        let later = now + BUCKET_REFILL_PER + Duration::from_secs(1);
        assert!(budget.reserve(&d.device_id, "proj:fresh", later));
    }

    // 10
    #[test]
    fn stale_past_the_ceiling_drops() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(180);
        // Monotonic clock barely moved (the Mac was asleep) but the wall
        // clock jumped well past due + ceiling.
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(181),
            wall_after(Duration::from_secs(180 + 11 * 60)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Dropped(DropReason::Stale));
    }

    // 11
    #[test]
    fn foreground_on_a_different_tab_is_not_seen() {
        // The oracle lives in NotificationService: a different active tab
        // simply never calls mark_seen, so `seen` arrives false here and
        // the notification escalates on schedule.
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(181),
            wall_after(Duration::from_secs(181)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Send);
    }

    // 13 / 14 are service-level (no token, no devices); 12 mirrors 11.

    // 15
    #[test]
    fn redaction_strips_every_name() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let mut d = device(180);
        d.redact_names = true;
        let (title, body) = render(&p, &d);
        assert!(!title.contains("control-center"));
        assert!(!title.contains("Claude Code"));
        assert!(!body.contains("src/push/mod.rs"));
        assert_eq!(title, "An agent needs your attention");
    }

    #[test]
    fn without_redaction_the_text_is_the_desktop_banner_verbatim() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let (title, body) = render(&p, &device(180));
        assert_eq!(title, p.title);
        assert_eq!(body, p.body);
    }

    // 16
    #[test]
    fn wake_grace_pushes_the_deadline_out() {
        let now = base();
        let mut p = pending_at(now, AgentNotifyState::Awaiting);
        p.wake_grace = Duration::from_secs(10);
        let out = decide(
            &p,
            &device(180),
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(185),
            wall_after(Duration::from_secs(185)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Wait);
    }

    // 17: the regression the staleness re-anchoring fixes. Anchored to
    // fire time, a 30 minute delay would have dropped itself as stale the
    // instant it came due.
    #[test]
    fn a_long_delay_is_not_stale_the_moment_it_comes_due() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(30 * 60);
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(30 * 60 + 1),
            wall_after(Duration::from_secs(30 * 60 + 1)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Send);
    }

    // 18
    #[test]
    fn eleven_minutes_past_due_is_stale() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(180);
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(180 + 11 * 60),
            wall_after(Duration::from_secs(180 + 11 * 60)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Dropped(DropReason::Stale));
    }

    #[test]
    fn nine_minutes_past_due_still_sends() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(180);
        let out = decide(
            &p,
            &d,
            Some(AgentNotifyState::Awaiting),
            false,
            now + Duration::from_secs(180 + 9 * 60),
            wall_after(Duration::from_secs(180 + 9 * 60)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Send);
    }

    #[test]
    fn a_non_firing_live_state_drops() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Completed);
        let out = decide(
            &p,
            &device(0),
            Some(AgentNotifyState::Idle),
            false,
            now + Duration::from_secs(1),
            wall_after(Duration::from_secs(1)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Dropped(DropReason::StateChanged));
    }

    #[test]
    fn an_unknown_live_state_drops_rather_than_guessing() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let out = decide(
            &p,
            &device(0),
            None,
            false,
            now + Duration::from_secs(1),
            wall_after(Duration::from_secs(1)),
            &mut RateBudget::default(),
        );
        assert_eq!(out, Outcome::Dropped(DropReason::StateChanged));
    }

    #[test]
    fn two_devices_with_different_delays_come_due_independently() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let quick = DevicePrefs { device_id: "quick".into(), ..device(30) };
        let slow = DevicePrefs { device_id: "slow".into(), ..device(600) };
        let t = now + Duration::from_secs(60);
        let w = wall_after(Duration::from_secs(60));
        let mut budget = RateBudget::default();
        assert_eq!(
            decide(&p, &quick, Some(AgentNotifyState::Awaiting), false, t, w, &mut budget),
            Outcome::Send
        );
        assert_eq!(
            decide(&p, &slow, Some(AgentNotifyState::Awaiting), false, t, w, &mut budget),
            Outcome::Wait
        );
    }

    #[test]
    fn one_devices_rate_limit_does_not_starve_another() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let a = DevicePrefs { device_id: "a".into(), ..device(0) };
        let b = DevicePrefs { device_id: "b".into(), ..device(0) };
        let mut budget = RateBudget::default();
        assert!(budget.reserve(&a.device_id, &p.composite_tab_id, now));
        let t = now + Duration::from_secs(5);
        let w = wall_after(Duration::from_secs(5));
        assert_eq!(
            decide(&p, &a, Some(AgentNotifyState::Awaiting), false, t, w, &mut budget),
            Outcome::Dropped(DropReason::RateLimited)
        );
        assert_eq!(
            decide(&p, &b, Some(AgentNotifyState::Awaiting), false, t, w, &mut budget),
            Outcome::Send
        );
    }

    #[test]
    fn a_dropped_outcome_costs_no_budget() {
        let now = base();
        let p = pending_at(now, AgentNotifyState::Awaiting);
        let d = device(0);
        let mut budget = RateBudget::default();
        // State changed: dropped before the budget is consulted at all.
        let t = now + Duration::from_secs(1);
        let w = wall_after(Duration::from_secs(1));
        for _ in 0..10 {
            decide(&p, &d, Some(AgentNotifyState::Idle), false, t, w, &mut budget);
        }
        assert!(budget.reserve(&d.device_id, &p.composite_tab_id, t));
    }

    /// The burst the bucket is supposed to bound. Before the reservation
    /// the commit happened after the whole tick had finished selecting,
    /// so every tab that came due together saw the same full bucket and
    /// all of them were queued.
    #[test]
    fn tabs_due_in_one_tick_cannot_exceed_the_bucket() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        let t = now + Duration::from_secs(1);
        let w = wall_after(Duration::from_secs(1));
        let overshoot = 4;
        let mut sent = 0;
        let mut limited = 0;
        for i in 0..(BUCKET_CAPACITY + overshoot) {
            let mut p = pending_at(now, AgentNotifyState::Awaiting);
            p.composite_tab_id = format!("proj:tab{i}");
            match decide(&p, &d, Some(AgentNotifyState::Awaiting), false, t, w, &mut budget) {
                Outcome::Send => sent += 1,
                Outcome::Dropped(DropReason::RateLimited) => limited += 1,
                other => panic!("unexpected outcome {other:?}"),
            }
        }
        assert_eq!(sent, BUCKET_CAPACITY);
        assert_eq!(limited, overshoot);
    }

    #[test]
    fn a_released_reservation_hands_the_capacity_back() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        for i in 0..BUCKET_CAPACITY {
            assert!(budget.reserve(&d.device_id, &format!("proj:tab{i}"), now));
        }
        assert!(!budget.reserve(&d.device_id, "proj:extra", now));
        budget.release(&d.device_id, "proj:tab0");
        assert!(budget.reserve(&d.device_id, "proj:extra", now));
    }

    /// A send that failed must not hold the next notification for that
    /// tab behind a floor it never earned.
    #[test]
    fn releasing_restores_the_per_tab_floor() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        assert!(budget.reserve(&d.device_id, "proj:tab0", now));
        budget.release(&d.device_id, "proj:tab0");
        assert!(budget.reserve(&d.device_id, "proj:tab0", now + Duration::from_secs(1)));
    }

    #[test]
    fn a_redeemed_reservation_keeps_the_per_tab_floor() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        assert!(budget.reserve(&d.device_id, "proj:tab0", now));
        budget.redeem(&d.device_id, "proj:tab0");
        assert!(!budget.reserve(&d.device_id, "proj:tab0", now + Duration::from_secs(1)));
    }

    /// Releasing a hold that was never taken, which is what a second
    /// release after a redeem would be.
    #[test]
    fn releasing_without_a_hold_does_nothing() {
        let now = base();
        let d = device(0);
        let mut budget = RateBudget::default();
        budget.release(&d.device_id, "proj:tab0");
        assert!(budget.reserve(&d.device_id, "proj:tab0", now));
        budget.redeem(&d.device_id, "proj:tab0");
        budget.release(&d.device_id, "proj:tab0");
        // The redeemed hold stood, so the bucket is still down one.
        for i in 1..BUCKET_CAPACITY {
            assert!(budget.reserve(&d.device_id, &format!("proj:tab{i}"), now));
        }
        assert!(!budget.reserve(&d.device_id, "proj:spare", now));
    }
}
