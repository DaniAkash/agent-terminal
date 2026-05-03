mod commands;
// `pub` so integration tests in `tests/` can call `ensure_hooks_installed()` and
// build payloads against `HookPayload`. Internal API otherwise — the app uses these
// modules directly.
pub mod hook_config;
pub mod hook_server;
// `pub` so integration tests can read NAMESPACE/HOOK_PORT.
pub mod identity;
mod mod_engine;
mod notifications;
mod pty_manager;
mod shell_integration;

use hook_config::ensure_hooks_installed;
use hook_server::start_hook_server;
use mod_engine::{
    ModEngine,
    mods::{
        AgentTurnMod,
        ClaudeCodeMod,
        CodexMod,
        DirTrackerMod,
        GitMonitorMod,
        ProcessTrackerMod,
        ShellProcessMod,
    },
};
use notifications::NotificationService;
use shell_integration::setup_shell_integration;
use tauri::Manager;
use pty_manager::PtyMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        // Single-instance MUST be the first plugin so duplicate launches
        // (notification clicks routing to a fresh .app, double-clicking the
        // dock icon, etc.) get intercepted before any other plugin tries to
        // initialize. The callback runs in the EXISTING process and just
        // re-focuses the window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Best-effort: write shell integration scripts. Never fail app startup.
            if let Err(e) = setup_shell_integration() {
                eprintln!("[agent-terminal] shell integration setup failed: {e}");
            }

            // Silently install/verify agent hook configs at every launch.
            // Runs in the background — never blocks startup, never crashes the app.
            tauri::async_runtime::spawn(ensure_hooks_installed());

            // Notification service — single owner of OS notifications.
            // Backend swaps at compile time: tauri-plugin-notification in dev
            // (banners, no clicks), user-notify in release (banners + real
            // per-notification click callbacks via UNUserNotificationCenter).
            let notification_service = NotificationService::new(app.handle().clone());
            app.manage(notification_service.clone());

            // Build the mod engine. Hook channel is created inside the builder.
            let engine_builder = ModEngine::builder()
                .with_mod(DirTrackerMod::new())
                .with_mod(ProcessTrackerMod::new())
                .with_mod(ClaudeCodeMod::new())
                .with_mod(CodexMod::new())
                .with_mod(ShellProcessMod::new())
                .with_mod(GitMonitorMod::new())
                .with_mod(AgentTurnMod::new().with_notifications(notification_service.clone()));

            // Start the hook HTTP server, wired to the engine's hook channel.
            let hook_tx = engine_builder.hook_sender();
            start_hook_server(hook_tx);

            let mod_engine = engine_builder.build(app.handle().clone());
            app.manage(mod_engine);

            // Window focus → suppression signal only.
            // (The previous focus-event-based click heuristic is gone — it
            // only "sometimes worked" in dev mode and was actively wrong:
            // macOS attributes dev banners to com.apple.Terminal so the
            // activation goes there, not us. Production click routing comes
            // from user-notify's per-notification UNUserNotificationCenter
            // callback — see `notifications::backend` (release path).)
            if let Some(window) = app.get_webview_window("main") {
                let svc = notification_service.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        svc.set_app_focus(*focused);
                    }
                });
            }

            Ok(())
        })
        .manage(pty_map)
        .invoke_handler(tauri::generate_handler![
            commands::open_tab,
            commands::write_pty,
            commands::resize_pty,
            commands::close_tab,
            commands::list_projects,
            commands::save_projects,
            notifications::notif_set_projects,
            notifications::notif_set_active_tab,
            notifications::notif_set_app_focus,
            notifications::notif_set_enabled,
            notifications::notif_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
