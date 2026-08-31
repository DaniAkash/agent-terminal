//! Native OS notification service — fully agent-agnostic.
//!
//! `NotificationService` is the **single owner** of OS notification firing,
//! suppression, permission, and click routing. It exposes a thin opaque
//! `maybe_notify(tab_id, agent_id, state, message)` API that callers (today:
//! `AgentTurnMod`) invoke when an agent transitions state.
//!
//! ## Two backends, swapped at compile time
//!
//! | Profile | Backend | Banners | Click callbacks |
//! |---|---|---|---|
//! | `cfg(debug_assertions)` (`tauri:dev`) | `tauri-plugin-notification` | ✅ visible | ❌ none — banners are debugging-only |
//! | `cfg(not(debug_assertions))` (`tauri:build`) | `user-notify` (UNUserNotificationCenter on macOS) | ✅ visible | ✅ real per-notification callbacks via UNUserNotificationCenterDelegate |
//!
//! **Why split:** Tauri's notification plugin has zero click-handling
//! capability on desktop (verified via plugin source + docs + maintainer
//! statement on tauri-apps/plugins-workspace#2150) AND in dev mode it
//! attributes notifications to `com.apple.Terminal` rather than our app.
//! `user-notify` properly registers as the source app and delivers click
//! events with our embedded routing data — but requires a code-signed
//! binary, so it can't run in `tauri:dev`.
//!
//! Result: dev gets visible banners for development feedback (no click
//! routing — clicks just dismiss). Production gets the full
//! "click-and-land-on-the-right-tab" experience.
//!
//! ## Agent-agnosticism
//!
//! The service knows nothing about specific agents. It receives an `agent_id`
//! string and looks up the display name from `AGENT_HOOK_CONFIGS`. Adding a
//! new agent = one entry in the registry + one new mod that calls into here.
//! Architecture-conformance test enforces no agent-specific code in the
//! frontend bridge module.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

use crate::hook_config::config_for_agent_id;

// ─── Public types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentNotifyState {
    Idle,
    InProgress,
    Awaiting,
    Completed,
    Error,
}

impl AgentNotifyState {
    fn fires_notification(self) -> bool {
        matches!(self, Self::Awaiting | Self::Completed | Self::Error)
    }

    /// Sound name used by the dev backend (tauri-plugin-notification). The
    /// release backend (user-notify) uses macOS's default category sound;
    /// per-state distinction can be added later via NotificationCategory.
    #[allow(dead_code)]
    fn sound(self) -> &'static str {
        match self {
            Self::Awaiting => "Glass",
            Self::Completed => "Pop",
            Self::Error => "Basso",
            _ => "default",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct NotificationService {
    app: AppHandle,
    inner: Mutex<Inner>,
    /// Release-mode only: handle to the user-notify NotificationManager. Held
    /// for its lifetime so the registered click callback stays alive.
    /// Wrapped in Mutex<Option<...>> so it can be initialized lazily after
    /// the service is wrapped in Arc.
    #[cfg(not(debug_assertions))]
    manager: Mutex<Option<std::sync::Arc<dyn user_notify::NotificationManager>>>,
}

struct Inner {
    projects: HashMap<String, ProjectInfo>,
    active_tab: Option<String>,
    app_foreground: bool,
    last_state: HashMap<String, AgentNotifyState>,
    permission_resolved: bool,
    permission_granted: bool,
    enabled: bool,
}

impl NotificationService {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let svc = Arc::new(Self {
            app,
            inner: Mutex::new(Inner {
                projects: HashMap::new(),
                active_tab: None,
                app_foreground: true,
                last_state: HashMap::new(),
                permission_resolved: false,
                permission_granted: false,
                enabled: true,
            }),
            #[cfg(not(debug_assertions))]
            manager: Mutex::new(None),
        });
        backend::init(&svc);
        svc
    }

    pub fn set_projects(&self, projects: Vec<ProjectInfo>) {
        let mut inner = self.inner.lock().unwrap();
        inner.projects.clear();
        for p in projects {
            inner.projects.insert(p.id.clone(), p);
        }
    }

    pub fn set_active_tab(&self, composite_tab_id: Option<String>) {
        self.inner.lock().unwrap().active_tab = composite_tab_id;
    }

    pub fn set_app_focus(&self, focused: bool) {
        self.inner.lock().unwrap().app_foreground = focused;
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.lock().unwrap().enabled = enabled;
    }

    pub fn cancel(&self, composite_tab_id: &str) {
        self.inner
            .lock()
            .unwrap()
            .last_state
            .remove(composite_tab_id);
        backend::cancel(self, composite_tab_id);
    }

    /// Decide whether to fire and, if so, post the OS notification.
    ///
    /// All transition / suppression logic is synchronous and runs inside
    /// the Mutex lock. Backend dispatch happens after the lock drops.
    pub fn maybe_notify(
        self: Arc<Self>,
        composite_tab_id: String,
        agent_id: String,
        state: AgentNotifyState,
        message: Option<String>,
    ) {
        let payload = {
            let mut inner = self.inner.lock().unwrap();

            if !inner.enabled {
                eprintln!(
                    "[notifications] suppressed (master toggle off): tab={composite_tab_id} state={state:?}"
                );
                return;
            }

            let prev = inner.last_state.get(&composite_tab_id).copied();

            // Non-firing states (idle / in-progress) update last_state so
            // future transitions are correctly detected (e.g. Completed →
            // InProgress → Completed must fire the second Completed because
            // an intermediate state happened).
            if !state.fires_notification() {
                inner.last_state.insert(composite_tab_id.clone(), state);
                return;
            }

            // Same state as last NOTIFIED state — already covered, no refire.
            if Some(state) == prev {
                return;
            }

            // Suppression check (window foreground AND active tab match).
            // CRITICAL: we deliberately do NOT update last_state when
            // suppressing, so that if the user moves to a different tab
            // and the SAME state arrives again, it will fire correctly.
            // (Future: tighten with xterm-focus signal — see plan rev 2026-04-29.)
            if inner.app_foreground
                && inner.active_tab.as_deref() == Some(composite_tab_id.as_str())
            {
                eprintln!(
                    "[notifications] suppressed (foreground+active): tab={composite_tab_id} state={state:?}"
                );
                return;
            }

            // Past suppression — record the state we're about to notify for
            // so a duplicate transition into the same state won't double-fire.
            inner.last_state.insert(composite_tab_id.clone(), state);

            // Split composite tab id — frontend's navigateToTab expects
            // (project_id, tab_id_within_project). The split must succeed;
            // malformed composites get dropped rather than misrouted.
            let (project_id, tab_id_in_project) = match composite_tab_id.split_once(':') {
                Some((p, t)) if !p.is_empty() && !t.is_empty() => {
                    (p.to_string(), t.to_string())
                }
                _ => {
                    eprintln!(
                        "[notifications] malformed composite tab id: {composite_tab_id}"
                    );
                    return;
                }
            };

            let project_name = inner
                .projects
                .get(&project_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| project_id.clone());

            // Resolve display name from registry — agent-agnostic lookup.
            let display_name = config_for_agent_id(&agent_id)
                .map(|c| c.agent_name.to_string())
                .unwrap_or_else(|| agent_id.clone());

            let title = format!("{display_name} · {project_name}");
            let body = match (message, state) {
                (Some(m), _) if !m.trim().is_empty() => m,
                (_, AgentNotifyState::Awaiting) => "Needs your attention".to_string(),
                (_, AgentNotifyState::Completed) => "Turn complete".to_string(),
                (_, AgentNotifyState::Error) => "Agent exited unexpectedly".to_string(),
                _ => return,
            };

            FirePayload {
                composite_tab_id: composite_tab_id.clone(),
                project_id,
                tab_id_in_project,
                title,
                body,
                state,
            }
        };

        // Async firing path — backend chooses how to deliver.
        let svc = self;
        tauri::async_runtime::spawn(async move {
            if !svc.ensure_permission().await {
                eprintln!("[notifications] permission denied — skipping");
                return;
            }
            backend::fire(&svc, payload).await;
        });
    }

    async fn ensure_permission(&self) -> bool {
        {
            let inner = self.inner.lock().unwrap();
            if inner.permission_resolved {
                return inner.permission_granted;
            }
        }
        let outcome = backend::ensure_permission(self).await;
        match outcome {
            // OS gave us a real Yes/No — cache it for the rest of the session.
            // (macOS's permission state only changes via System Settings, and
            // even that only takes effect after restart for our app — so
            // caching is safe.)
            PermissionOutcome::Granted => {
                let mut inner = self.inner.lock().unwrap();
                inner.permission_resolved = true;
                inner.permission_granted = true;
                true
            }
            PermissionOutcome::Denied => {
                let mut inner = self.inner.lock().unwrap();
                inner.permission_resolved = true;
                inner.permission_granted = false;
                false
            }
            // Manager wasn't ready when we asked — almost certainly a startup
            // race where init() hadn't finished dispatching to the main thread
            // before the first notification fired. Don't cache; let the next
            // call retry. Otherwise the very first failed-because-unready
            // permission check would lock the service into "denied" forever.
            PermissionOutcome::NotReady => {
                eprintln!(
                    "[notifications] permission check ran before manager init completed — will retry on next notification"
                );
                false
            }
        }
    }
}

/// Result of a permission check from the backend. Distinguishes a real OS
/// answer (cacheable for the session) from a transient "manager not yet
/// initialized" condition (must be retried).
///
/// `NotReady` is only constructed by the release backend (where init runs
/// async via run_on_main_thread). The dev backend always returns a real
/// Granted/Denied because tauri-plugin-notification works synchronously.
/// Hence the `#[allow(dead_code)]` for dev builds — the variant exists in
/// both profiles for type stability but is unused in one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum PermissionOutcome {
    Granted,
    Denied,
    NotReady,
}

#[derive(Debug)]
#[allow(dead_code)] // project_id + tab_id_in_project only used by release backend
struct FirePayload {
    composite_tab_id: String,
    project_id: String,
    tab_id_in_project: String,
    title: String,
    body: String,
    state: AgentNotifyState,
}

// ─── Tauri commands (frontend bridge) ────────────────────────────────────────

#[tauri::command]
pub async fn notif_set_projects(
    service: tauri::State<'_, Arc<NotificationService>>,
    projects: Vec<ProjectInfo>,
) -> Result<(), String> {
    service.set_projects(projects);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_active_tab(
    service: tauri::State<'_, Arc<NotificationService>>,
    tab_id: Option<String>,
) -> Result<(), String> {
    service.set_active_tab(tab_id);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_app_focus(
    service: tauri::State<'_, Arc<NotificationService>>,
    focused: bool,
) -> Result<(), String> {
    service.set_app_focus(focused);
    Ok(())
}

#[tauri::command]
pub async fn notif_set_enabled(
    service: tauri::State<'_, Arc<NotificationService>>,
    enabled: bool,
) -> Result<(), String> {
    service.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub async fn notif_cancel(
    service: tauri::State<'_, Arc<NotificationService>>,
    tab_id: String,
) -> Result<(), String> {
    service.cancel(&tab_id);
    Ok(())
}

// ─── Backend selection ───────────────────────────────────────────────────────

#[cfg(debug_assertions)]
mod backend {
    //! Dev backend — `tauri-plugin-notification`.
    //!
    //! Visible banners for development feedback. **No click handling**:
    //! the plugin has no callback API on desktop, AND in dev mode it
    //! attributes the notification to `com.apple.Terminal` so even if we
    //! tried to detect clicks via window-focus events, macOS routes the
    //! activation to Terminal.app, not us. We deliberately do nothing on
    //! click — banners just dismiss. Production gets the real thing via
    //! the `user-notify` backend.

    use super::{FirePayload, NotificationService};
    use std::sync::Arc;
    use tauri_plugin_notification::{NotificationExt, PermissionState};

    pub fn init(_svc: &Arc<NotificationService>) {
        eprintln!(
            "[notifications] dev backend (tauri-plugin-notification) — banners visible, click routing disabled"
        );
    }

    pub async fn fire(svc: &Arc<NotificationService>, payload: FirePayload) {
        eprintln!(
            "[notifications] (dev) firing: tab={} state={:?} title={:?} body={:?}",
            payload.composite_tab_id, payload.state, payload.title, payload.body,
        );
        if let Err(e) = svc
            .app
            .notification()
            .builder()
            .title(&payload.title)
            .body(&payload.body)
            .sound(payload.state.sound())
            .show()
        {
            eprintln!("[notifications] (dev) show failed: {e}");
        }
    }

    pub fn cancel(_svc: &NotificationService, composite_tab_id: &str) {
        eprintln!("[notifications] (dev) cancel: tab={composite_tab_id}");
        // tauri-plugin-notification has no programmatic cancellation on desktop.
    }

    pub async fn ensure_permission(svc: &NotificationService) -> super::PermissionOutcome {
        let plugin = svc.app.notification();
        let granted = matches!(plugin.permission_state(), Ok(PermissionState::Granted))
            || matches!(plugin.request_permission(), Ok(PermissionState::Granted));
        eprintln!("[notifications] (dev) permission granted = {granted}");
        if granted { super::PermissionOutcome::Granted } else { super::PermissionOutcome::Denied }
    }
}

#[cfg(not(debug_assertions))]
mod backend {
    //! Release backend — `user-notify` wrapping native UNUserNotificationCenter.
    //!
    //! Per-notification click callbacks delivered via the OS delegate. Each
    //! notification carries its routing data in `user_info` so the callback
    //! gets `project_id` + `tab_id` directly — no focus-event heuristics.
    //!
    //! ## Threading
    //!
    //! All UNUserNotificationCenter / NSUserNotificationCenterDelegate calls
    //! MUST run on the macOS main thread (Cocoa is not thread-safe). user-notify
    //! itself doesn't enforce this — it just calls the underlying objc2 APIs,
    //! which silently no-op when called off main. Symptom of getting this
    //! wrong: the permission prompt never appears, notifications never fire,
    //! the user has to manually enable in System Settings → Notifications,
    //! and even then click callbacks may misbehave.
    //!
    //! `tauri::AppHandle::run_on_main_thread` dispatches a sync closure to
    //! the main runloop. For async user-notify methods we wrap with a
    //! oneshot channel: spawn the future on the main thread via block_on,
    //! send the result back, await on the calling task.

    use super::{FirePayload, NotificationService};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tauri::{Emitter, Manager};
    use tokio::sync::oneshot;
    use user_notify::{NotificationBuilder, get_notification_manager};

    /// Initialize the user-notify manager and register the click callback.
    /// MUST run on macOS main thread (UNUserNotificationCenterDelegate setup).
    pub fn init(svc: &Arc<NotificationService>) {
        let bundle_id = svc.app.config().identifier.clone();
        let app_for_callback = svc.app.clone();
        let svc_for_storage = svc.clone();

        // run_on_main_thread dispatches the closure to the macOS main runloop.
        // The closure runs synchronously THERE; the returned Result tells us
        // only whether the dispatch succeeded, not the closure's outcome.
        let dispatch = svc.app.run_on_main_thread(move || {
            let manager = get_notification_manager(bundle_id, None);

            let app = app_for_callback;
            let result = manager.register(
                Box::new(move |response| {
                    let info = &response.user_info;
                    let project_id = info.get("project_id").cloned().unwrap_or_default();
                    let tab_id = info.get("tab_id").cloned().unwrap_or_default();
                    if project_id.is_empty() || tab_id.is_empty() {
                        eprintln!(
                            "[notifications] click with no routing data: {:?}",
                            response,
                        );
                        return;
                    }
                    // Bring the window forward as well — single-instance plugin
                    // takes care of preventing duplicate launches, but we want
                    // the running window to surface immediately on click.
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit(
                        "notification:click",
                        serde_json::json!({
                            "project_id": project_id,
                            "tab_id": tab_id,
                        }),
                    );
                }),
                Vec::new(), // No interactive buttons / reply inputs in v1.
            );
            if let Err(e) = result {
                eprintln!("[notifications] register on main thread failed: {e}");
                return;
            }
            *svc_for_storage.manager.lock().unwrap() = Some(manager);
            eprintln!("[notifications] release backend (user-notify) initialized on main thread");
        });
        if let Err(e) = dispatch {
            eprintln!("[notifications] failed to dispatch init to main thread: {e}");
        }
    }

    pub async fn fire(svc: &Arc<NotificationService>, payload: FirePayload) {
        let manager = match svc.manager.lock().unwrap().clone() {
            Some(m) => m,
            None => {
                eprintln!("[notifications] manager not initialized");
                return;
            }
        };

        let mut user_info = HashMap::new();
        user_info.insert("project_id".to_string(), payload.project_id.clone());
        user_info.insert("tab_id".to_string(), payload.tab_id_in_project.clone());

        let thread_id = format!("agent-terminal:tab:{}", payload.composite_tab_id);

        let title = payload.title.clone();
        let body = payload.body.clone();

        // Dispatch send_notification to the main thread to be safe — Cocoa
        // notification posting commonly requires it. Use a oneshot to ferry
        // the Result back to our async caller.
        let (tx, rx) = oneshot::channel();
        let dispatch = svc.app.run_on_main_thread(move || {
            let builder = NotificationBuilder::new()
                .title(&title)
                .body(&body)
                .set_thread_id(&thread_id)
                .set_user_info(user_info);
            let result = tauri::async_runtime::block_on(manager.send_notification(builder));
            let _ = tx.send(result.map(|_| ()).map_err(|e| e.to_string()));
        });
        if let Err(e) = dispatch {
            eprintln!("[notifications] failed to dispatch send to main thread: {e}");
            return;
        }
        match rx.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => eprintln!("[notifications] user-notify send failed: {e}"),
            Err(_) => eprintln!("[notifications] send dispatch dropped before completion"),
        }
    }

    pub fn cancel(svc: &NotificationService, composite_tab_id: &str) {
        let Some(manager) = svc.manager.lock().unwrap().clone() else { return };
        let id = format!("agent-terminal:tab:{composite_tab_id}");
        // remove_delivered_notifications is sync — dispatch to main thread.
        let id_owned = id;
        let _ = svc.app.run_on_main_thread(move || {
            let _ = manager.remove_delivered_notifications(vec![&id_owned]);
        });
    }

    pub async fn ensure_permission(svc: &NotificationService) -> super::PermissionOutcome {
        // If init hasn't finished dispatching to the main thread yet, the
        // manager is still None. That's transient — return NotReady so the
        // caller doesn't cache this as a permanent denial.
        let Some(manager) = svc.manager.lock().unwrap().clone() else {
            return super::PermissionOutcome::NotReady;
        };
        // Both permission calls must run on main thread.
        let (tx, rx) = oneshot::channel();
        let manager_clone = manager.clone();
        let dispatch = svc.app.run_on_main_thread(move || {
            let granted = tauri::async_runtime::block_on(async move {
                if let Ok(true) = manager_clone.get_notification_permission_state().await {
                    return true;
                }
                manager_clone
                    .first_time_ask_for_notification_permission()
                    .await
                    .unwrap_or(false)
            });
            let _ = tx.send(granted);
        });
        if let Err(e) = dispatch {
            // Failure to dispatch to main thread is also transient (could be
            // an event loop quirk during startup). Treat as NotReady rather
            // than caching denial.
            eprintln!("[notifications] failed to dispatch permission to main thread: {e}");
            return super::PermissionOutcome::NotReady;
        }
        match rx.await {
            Ok(true) => super::PermissionOutcome::Granted,
            Ok(false) => super::PermissionOutcome::Denied,
            Err(_) => super::PermissionOutcome::NotReady,
        }
    }
}
