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
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use pty_manager::PtyMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));

    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_notification::init());

    // Self-update — only the prod-namespaced build registers the plugin.
    // The dev bundle id (com.daniakash.agent-terminal-dev) cannot be the
    // legitimate target of a manifest signed for the prod app, so
    // dev-instance builds skip the plugin entirely rather than risk an
    // update attempt that overlays a foreign bundle.
    #[cfg(not(feature = "dev-instance"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            // Custom macOS menu — omits the default items whose shortcuts
            // conflict with our keyboard handlers:
            //   View → Actual Size / Zoom In / Zoom Out  (⌘0 / ⌘+ / ⌘-)
            //   Edit → Find → Find Next / Previous       (⌘G / ⌘⇧G)
            //   Window → Select Next / Previous Tab      (⌘⇧] / ⌘⇧[)
            // macOS routes menu shortcuts at the OS level BEFORE the
            // keystroke reaches the WebView, so leaving the defaults in
            // place silently swallows our hotkeys. Standard items the
            // user does expect (Quit, Hide, Cut/Copy/Paste/Select All,
            // Minimize) stay in.
            //
            // macOS-only — the menu items and their stripping rationale
            // are platform-specific. On Win/Linux Tauri's defaults are
            // native and stay untouched.
            //
            // Errors here are logged and ignored — a missing menu degrades
            // the app, but doesn't break it (Cmd+Q still quits via the OS).
            #[cfg(target_os = "macos")]
            if let Err(e) = install_app_menu(app) {
                eprintln!("[agent-terminal] menu setup failed: {e}");
            }

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

/// Builds and installs a custom macOS menu that intentionally omits the
/// default items whose shortcuts collide with our app-level hotkeys.
#[cfg(target_os = "macos")]
fn install_app_menu(
    app: &tauri::App,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app_submenu = SubmenuBuilder::new(app, "Agent Terminal")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // Edit submenu — standard text-edit items but no Find submenu.
    // ⌘F / ⌘G / ⌘⇧G are owned by the in-app find overlay.
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Window submenu — minimize + fullscreen, NO "Select Next/Previous Tab"
    // (⌘⇧] / ⌘⇧[ are owned by our tab navigation hotkeys).
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;

    // Note: no View submenu at all. The View defaults are exclusively
    // page-zoom items (⌘0 / ⌘+ / ⌘-) which we own for terminal font size.
    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &edit_submenu, &window_submenu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
