//! macOS anchored hover/click panel and Linux compositor-managed quick view.
//! This module uses physical coordinates throughout, including mixed-DPI screens.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(not(target_os = "linux"))]
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(target_os = "linux"))]
use tauri::{PhysicalPosition, PhysicalSize};

pub const WINDOW_ID: &str = "jarvis-tray";

#[derive(Default)]
pub struct PopoverState {
    epoch: AtomicU64,
    pinned: AtomicBool,
    #[cfg(not(target_os = "linux"))]
    anchor: Mutex<Option<(f64, f64, f64, f64)>>,
}

pub fn dismiss(app: &tauri::AppHandle) {
    let state = app.state::<PopoverState>();
    state.epoch.fetch_add(1, Ordering::Relaxed);
    state.pinned.store(false, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        let _ = window.hide();
    }
}

pub fn destroy(app: &tauri::AppHandle) {
    dismiss(app);
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        let _ = window.destroy();
    }
}

#[cfg(target_os = "macos")]
pub fn handle(app: &tauri::AppHandle, event: tauri::tray::TrayIconEvent) {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
    match event {
        TrayIconEvent::Enter { position, rect, .. } => {
            let state = app.state::<PopoverState>();
            if state.pinned.load(Ordering::Relaxed) {
                return;
            }
            let epoch = state.epoch.fetch_add(1, Ordering::Relaxed) + 1;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(200)).await;
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if handle.state::<PopoverState>().epoch.load(Ordering::Relaxed) == epoch {
                        // A hover failure never opens the main app. The native
                        // tooltip and right-click menu remain available.
                        let _ = show(&handle, position, rect, false);
                    }
                });
            });
        }
        TrayIconEvent::Leave { .. } => {
            // Cancel pending hover, but let the cursor cross into an existing panel.
            if app
                .get_webview_window(WINDOW_ID)
                .map_or(true, |w| !w.is_visible().unwrap_or(false))
            {
                app.state::<PopoverState>()
                    .epoch
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
        TrayIconEvent::Click {
            position,
            rect,
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            if app.state::<PopoverState>().pinned.load(Ordering::Relaxed) {
                dismiss(app);
            } else if show(app, position, rect, true).is_err() {
                let _ = super::tray::open_main(app, false);
            }
        }
        TrayIconEvent::Click {
            button: MouseButton::Right,
            ..
        } => dismiss(app),
        _ => {}
    }
}

pub fn quick_view(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let prefs = app.state::<super::UsageService>().snapshot().preferences;
        if !prefs.enabled || !prefs.show_tray {
            return Ok(());
        }
        let window = ensure_window(app)?;
        // Wayland deliberately has no global pointer/window placement API.
        // A transient, decorated window lets Hyprland/KDE/GNOME place and focus
        // this view without requiring compositor-specific window rules.
        if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            window.set_size(tauri::LogicalSize::new(
                380.0_f64.min((area.size.width as f64 / scale - 32.0).max(1.0)),
                620.0_f64.min((area.size.height as f64 / scale - 48.0).max(1.0)),
            ))?;
        }
        let _ = window.center(); // X11 supports this; Wayland owns placement.
        let state = app.state::<PopoverState>();
        state.pinned.store(true, Ordering::Relaxed);
        let epoch = state.epoch.fetch_add(1, Ordering::Relaxed) + 1;
        window.show()?;
        // GTK applies show asynchronously. Request focus after it maps; a
        // cancelled or closed quick view must never regain focus later.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if handle.state::<PopoverState>().epoch.load(Ordering::Relaxed) == epoch {
                    if let Some(window) = handle.get_webview_window(WINDOW_ID) {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.set_focus();
                        }
                    }
                }
            });
        });
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let Some(main) = app.get_webview_window("main") else {
            return Ok(());
        };
        let cursor = main.cursor_position()?;
        show(
            app,
            cursor,
            tauri::Rect {
                position: cursor.into(),
                size: PhysicalSize::new(0.0, 0.0).into(),
            },
            true,
        )
    }
}

fn ensure_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        return Ok(window);
    }
    let builder = WebviewWindowBuilder::new(
        app,
        WINDOW_ID,
        WebviewUrl::App("index.html#jarvis-tray".into()),
    )
    .title("Jarvis usage")
    .inner_size(380.0, 620.0)
    .visible(false)
    .focused(false)
    .focusable(cfg!(target_os = "linux"))
    .accept_first_mouse(true)
    .decorations(cfg!(target_os = "linux"))
    .resizable(cfg!(target_os = "linux"))
    .skip_taskbar(!cfg!(target_os = "linux"))
    .always_on_top(cfg!(target_os = "macos"))
    .shadow(true);
    #[cfg(target_os = "linux")]
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.transient_for(&main)?
    } else {
        builder
    };
    let window = builder.build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            dismiss(&handle);
        }
        // Linux native menus and compositor focus transitions can emit blur
        // during activation. Close only explicitly there; macOS pins dismiss
        // on blur as a menu-bar panel should.
        #[cfg(target_os = "macos")]
        if matches!(event, tauri::WindowEvent::Focused(false))
            && handle
                .state::<PopoverState>()
                .pinned
                .load(Ordering::Relaxed)
        {
            dismiss(&handle);
        }
    });
    Ok(window)
}

#[cfg(not(target_os = "linux"))]
fn show(
    app: &tauri::AppHandle,
    cursor: PhysicalPosition<f64>,
    rect: tauri::Rect,
    pinned: bool,
) -> tauri::Result<()> {
    let prefs = app.state::<super::UsageService>().snapshot().preferences;
    if !prefs.enabled || !prefs.show_tray {
        return Ok(());
    }
    let window = ensure_window(app)?;
    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)?
        .or(window.primary_monitor()?);
    let scale = monitor.as_ref().map_or(1.0, |m| m.scale_factor());
    let anchor = rect.position.to_physical::<f64>(scale);
    let icon = rect.size.to_physical::<f64>(scale);
    let mut width = 380.0 * scale;
    let mut height = 620.0 * scale;
    let mut x = anchor.x + icon.width / 2.0 - width / 2.0;
    let mut y = anchor.y + icon.height + 6.0 * scale;
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let margin = 8.0 * scale;
        let left = area.position.x as f64 + margin;
        let top = area.position.y as f64 + margin;
        width = width.min((area.size.width as f64 - 2.0 * margin).max(1.0));
        height = height.min((area.size.height as f64 - 2.0 * margin).max(1.0));
        x = x.clamp(
            left,
            left + (area.size.width as f64 - 2.0 * margin - width).max(0.0),
        );
        y = y.clamp(
            top,
            top + (area.size.height as f64 - 2.0 * margin - height).max(0.0),
        );
    }
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    window.set_size(PhysicalSize::new(
        width.round() as u32,
        height.round() as u32,
    ))?;
    let state = app.state::<PopoverState>();
    *state.anchor.lock().unwrap() = Some((anchor.x, anchor.y, icon.width, icon.height));
    state.pinned.store(pinned, Ordering::Relaxed);
    let epoch = state.epoch.fetch_add(1, Ordering::Relaxed) + 1;
    window.set_focusable(pinned)?;
    window.show()?;
    if pinned {
        window.set_focus()?;
    }
    if !pinned {
        follow_pointer(app.clone(), epoch);
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn follow_pointer(app: tauri::AppHandle, epoch: u64) {
    tauri::async_runtime::spawn(async move {
        let mut outside = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let state = app.state::<PopoverState>();
            if state.epoch.load(Ordering::Relaxed) != epoch {
                break;
            }
            if state.pinned.load(Ordering::Relaxed) {
                continue;
            }
            let Some(window) = app.get_webview_window(WINDOW_ID) else {
                break;
            };
            let (Ok(cursor), Ok(position), Ok(size)) = (
                window.cursor_position(),
                window.outer_position(),
                window.outer_size(),
            ) else {
                dismiss(&app);
                break;
            };
            let near = |x: f64, y: f64, width: f64, height: f64| {
                cursor.x >= x - 12.0
                    && cursor.x <= x + width + 12.0
                    && cursor.y >= y - 12.0
                    && cursor.y <= y + height + 12.0
            };
            let on_icon = state
                .anchor
                .lock()
                .unwrap()
                .is_some_and(|(x, y, w, h)| near(x, y, w, h));
            let inside = on_icon
                || near(
                    position.x as f64,
                    position.y as f64,
                    size.width as f64,
                    size.height as f64,
                );
            outside = if inside { 0 } else { outside + 1 };
            if outside >= 3 {
                // Do not let an old hover timer close a newly pinned panel.
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let state = handle.state::<PopoverState>();
                    if state.epoch.load(Ordering::Relaxed) == epoch
                        && !state.pinned.load(Ordering::Relaxed)
                    {
                        dismiss(&handle);
                    }
                });
                break;
            }
        }
    });
}
