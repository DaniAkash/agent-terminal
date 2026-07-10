mod commands;
// `pub` so integration tests in `tests/` can call `ensure_hooks_installed()` and
// build payloads against `HookPayload`. Internal API otherwise — the app uses these
// modules directly.
pub mod hook_config;
pub mod hook_server;
// `pub` so integration tests can read NAMESPACE/HOOK_PORT.
pub mod identity;
mod mod_engine;
// Narrow re-export for integration tests that need to build a
// ModEngineHandle::noop() or read the CwdTable type. Keeps the rest of
// the mod_engine tree private (clippy has opinions on those internal
// mod-specific types).
#[doc(hidden)]
pub use mod_engine::{CwdTable, ModEngineHandle};
mod notifications;
// pub so integration tests can construct a bare PtyMap without a full
// PtyHandle harness (tests only need the map's shape for ServerState).
pub mod pty_manager;
mod shell_integration;
// pub so integration tests can drive a SidecarClient instance directly
// without going through the full Tauri startup path.
pub mod sidecar_client;
// pub for the same reason — tests construct StreamHub directly.
pub mod stream_hub;
// pub so the WSS server (next sub-step) and future integration tests can
// build wire frames from these types directly. Also exported at the crate
// root so `cargo xtask regen-protocol` (which shells out to typeshare)
// can find the #[typeshare]-annotated types by scanning src-tauri/src/.
pub mod protocol;
// pub for direct test coverage (config file round-trip, constant-time
// compare, error paths).
pub mod auth_stub;
// pub for direct test coverage. The WSS server (next commit) constructs
// one at startup and hands it to per-connection tasks.
pub mod projects_cache;
pub mod tls;
// pub so integration tests can drive the server directly (spin up on
// 127.0.0.1:0 with an in-process client).
pub mod wss_server;

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
#[cfg(all(target_os = "macos", not(feature = "dev-instance")))]
use tauri::Emitter;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
#[cfg(all(target_os = "macos", not(feature = "dev-instance")))]
use tauri::menu::MenuItemBuilder;
use auth_stub::AuthStub;
use projects_cache::ProjectsCache;
use pty_manager::PtyMap;
use sidecar_client::SidecarClient;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use stream_hub::StreamHub;
use tokio::process::Command;
use wss_server::ServerState;

/// Locate the runtime binary + sidecar entry script. Dev launches read from
/// the source tree via CARGO_MANIFEST_DIR; production bundling is a separate
/// follow-up (Tauri externalBin + a bundled Node binary). Returns None when
/// either piece is missing so startup degrades to "no sidecar" gracefully.
fn resolve_sidecar_paths() -> Option<(PathBuf, PathBuf)> {
    // Prefer node; fall back to bun (compatible enough for the JSON-RPC loop
    // + @xterm/headless). Whichever is present on PATH wins.
    let runtime = which::which("node")
        .or_else(|_| which::which("bun"))
        .ok()?;
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let script = PathBuf::from(manifest_dir).join("sidecar").join("index.js");
    if !script.exists() {
        return None;
    }
    Some((runtime, script))
}

/// Spawn the headless-xterm sidecar. Returns None on any failure (missing
/// runtime, missing script, spawn error). The desktop continues running
/// without it; the sidecar is only consumed by the upcoming StreamHub +
/// WSS server modules.
async fn try_spawn_sidecar() -> Option<SidecarClient> {
    let (runtime, script) = match resolve_sidecar_paths() {
        Some(p) => p,
        None => {
            eprintln!(
                "[sidecar] disabled: node/bun not on PATH or sidecar/index.js missing — \
                 remote-attach features will be unavailable until the sidecar is bundled"
            );
            return None;
        }
    };
    let mut cmd = Command::new(&runtime);
    cmd.arg(&script);
    match SidecarClient::spawn(cmd).await {
        Ok(c) => {
            eprintln!(
                "[sidecar] spawned via {} {}",
                runtime.display(),
                script.display()
            );
            Some(c)
        }
        Err(e) => {
            eprintln!("[sidecar] spawn failed: {e}");
            None
        }
    }
}

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
    // update attempt that overlays a foreign bundle. process plugin is
    // gated under the same cfg because its only consumer here is the
    // updater flow's post-install relaunch.
    #[cfg(not(feature = "dev-instance"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Cheap Arc clones the setup closure needs before the outer scope
    // hands ownership to `.manage(pty_map)` at the end of the builder.
    let pty_map_for_setup = Arc::clone(&pty_map);

    builder
        .setup(move |app| {
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

            // Forward the "Check for Updates…" menu click to the renderer
            // as a `menu:check-for-updates` event. The renderer's
            // checkForUpdate() handler drives the rest of the flow.
            #[cfg(all(target_os = "macos", not(feature = "dev-instance")))]
            app.on_menu_event(|app_handle, event| {
                if event.id() == "check-for-updates" {
                    let _ = app_handle.emit("menu:check-for-updates", ());
                }
            });

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
            // Take handles the WSS server needs BEFORE we hand mod_engine
            // over to Tauri's managed-state store — after `app.manage`
            // moves it, direct access goes away.
            let mod_engine_handle = mod_engine.handle();
            let cwd_table = mod_engine.cwd_table();
            app.manage(mod_engine);

            // Headless-xterm sidecar. Spawned as best-effort so a missing
            // node/bun runtime or a not-yet-bundled script never blocks the
            // desktop from launching. The StreamHub built below uses
            // Option<Arc<SidecarClient>> so it degrades to local-only fan-
            // out when the sidecar isn't available.
            let sidecar = tauri::async_runtime::block_on(try_spawn_sidecar()).map(Arc::new);
            if let Some(client) = sidecar.clone() {
                app.manage(client);
            }

            // Per-tab fan-out hub. Always present so pty_manager's reader
            // threads have a stable broadcast target; the sidecar passed in
            // is the optional bit. State<'_, Arc<StreamHub>> is the handle
            // Tauri commands grab.
            let hub = StreamHub::new(sidecar);
            let hub_for_wss = Arc::clone(&hub);
            app.manage(hub);

            // Projects cache: replaces the pre-Phase-A ProjectRegistry.
            // React's `$projects` nano-store owns mutations and pushes the
            // full projects vector to the cache via the
            // `sync_projects_to_wss` Tauri command on every change. The
            // WSS server subscribes to the cache's change watch and pushes
            // a fresh Projects frame to every connected mobile client.
            //
            // Cold-start fallback: load projects.json directly from disk
            // so the ~200 ms window between backend init and React first-
            // paint does not serve an empty tree to any mobile client
            // that happens to be reconnecting at just that moment.
            let projects_cache = Arc::new(ProjectsCache::new());
            let config_dir_for_cache = dirs::home_dir()
                .map(|h| h.join(".config").join(identity::NAMESPACE));
            if let Some(dir) = &config_dir_for_cache {
                if let Some(initial) = ProjectsCache::load_from_disk(dir) {
                    projects_cache.set(initial);
                }
            }
            let projects_cache_for_wss = Arc::clone(&projects_cache);
            app.manage(Arc::clone(&projects_cache));

            // Per-op-id inboxes for routing OpError frames back to the
            // mobile client that fired a CRUD op. Managed by Tauri so
            // `report_mobile_op_error` can look up the sender.
            let mobile_op_inboxes = Arc::new(wss_server::MobileOpInboxes::new());
            let mobile_op_inboxes_for_wss = Arc::clone(&mobile_op_inboxes);
            app.manage(Arc::clone(&mobile_op_inboxes));

            // WSS server. AuthStub reads (or auto-generates) the dev
            // config file — its bind_addr + tls_enabled come from there.
            // Spawn as a tokio task; bind failure logs but doesn't block
            // startup so a broken WSS never keeps the desktop from
            // launching.
            let config_dir = dirs::home_dir()
                .map(|h| h.join(".config").join(identity::NAMESPACE));
            if let Some(dir) = config_dir {
                match AuthStub::load_or_init(&dir) {
                    Ok((auth, path)) => {
                        let auth = Arc::new(auth);
                        eprintln!(
                            "[wss] dev config: {} (token inside — copy into companion client)",
                            path.display()
                        );
                        // Load or generate the TLS material once at
                        // startup. Stored under `<config_dir>/tls/`.
                        // Fingerprint is exposed via the Tauri command
                        // `get_tls_fingerprint` so the pairing UI (PR B)
                        // can embed it in the QR.
                        let tls_material_result = if auth.tls_enabled {
                            let tls_dir = dir.join("tls");
                            let sans =
                                vec!["localhost".to_string(), "127.0.0.1".to_string()];
                            tls::TlsMaterial::load_or_generate(&tls_dir, sans)
                                .map_err(|e| e.to_string())
                        } else {
                            Err(String::from("tls_enabled=false in config"))
                        };
                        let tls_bundle = tls_material_result.and_then(|mat| {
                            let server_cfg = mat.to_server_config().map_err(|e| e.to_string())?;
                            let rustls_cfg = Arc::new(
                                axum_server::tls_rustls::RustlsConfig::from_config(Arc::new(server_cfg)),
                            );
                            Ok((mat.sha256_fingerprint.clone(), rustls_cfg))
                        });
                        let tls_fingerprint = tls_bundle
                            .as_ref()
                            .ok()
                            .map(|(fp, _)| fp.clone());
                        app.manage(commands::TlsFingerprint(tls_fingerprint));
                        let server_state = Arc::new(ServerState {
                            hub: hub_for_wss,
                            auth: Arc::clone(&auth),
                            projects_cache: projects_cache_for_wss,
                            pty_map: Arc::clone(&pty_map_for_setup),
                            mod_engine_handle,
                            cwd_table,
                            app_handle: Some(app.handle().clone()),
                            mobile_op_inboxes: mobile_op_inboxes_for_wss,
                        });
                        let bind_addr = auth.bind_addr;
                        let tls_enabled = auth.tls_enabled;
                        app.manage(auth);
                        tauri::async_runtime::spawn(async move {
                            let result = if tls_enabled {
                                match tls_bundle {
                                    Ok((_, rustls_cfg)) => {
                                        wss_server::run_with_tls(bind_addr, server_state, rustls_cfg)
                                            .await
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[wss] TLS enabled in config but material load failed: {e}. Falling back to plain ws://"
                                        );
                                        wss_server::run(bind_addr, server_state).await
                                    }
                                }
                            } else {
                                wss_server::run(bind_addr, server_state).await
                            };
                            if let Err(e) = result {
                                eprintln!("[wss] server crashed: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[wss] disabled: dev config load failed: {e}");
                    }
                }
            } else {
                eprintln!("[wss] disabled: no home directory");
            }

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
            commands::sync_projects_to_wss,
            commands::report_mobile_op_error,
            commands::report_mobile_op_ok,
            commands::get_tls_fingerprint,
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
    // "Check for Updates…" goes between About and Services in the prod
    // app menu. dev-instance builds intentionally skip it because the
    // updater plugin isn't registered in those — surfacing a menu item
    // that does nothing would be a worse footgun than not having it.
    #[cfg(not(feature = "dev-instance"))]
    let app_submenu = {
        let check_for_updates =
            MenuItemBuilder::with_id("check-for-updates", "Check for Updates…")
                .build(app)?;
        SubmenuBuilder::new(app, "Agent Terminal")
            .about(None)
            .separator()
            .item(&check_for_updates)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?
    };

    #[cfg(feature = "dev-instance")]
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
