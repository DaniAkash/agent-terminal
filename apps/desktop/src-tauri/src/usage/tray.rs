//! Native presentation only. The tray never fetches provider data itself.
use super::types::UsageSnapshot;

pub const TRAY_ID: &str = "jarvis";

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[derive(Default)]
pub struct NativeState(std::sync::Mutex<Option<Presentation>>);

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct Presentation {
    menu: tauri::menu::Menu<tauri::Wry>,
    rows: Vec<Option<MenuRow>>,
    icon: Option<(u8, u8)>,
    #[cfg(target_os = "macos")]
    tooltip: String,
    #[cfg(target_os = "macos")]
    title: String,
    visible: bool,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[derive(Clone, PartialEq, Eq)]
pub(super) struct MenuRow {
    id: String,
    text: String,
    enabled: bool,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn icon_key(used: Option<f64>) -> Option<(u8, u8)> {
    used.map(|used| {
        (
            ((100.0 - used).clamp(0.0, 100.0) / 100.0 * 13.0).round() as u8,
            if used >= 90.0 {
                2
            } else if used >= 75.0 {
                1
            } else {
                0
            },
        )
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn same_structure(a: &[Option<MenuRow>], b: &[Option<MenuRow>]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.as_ref().map(|row| &row.id) == b.as_ref().map(|row| &row.id))
}

pub fn open_main(app: &tauri::AppHandle, settings: bool) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    super::popover::dismiss(app);
    let window = app
        .get_webview_window("main")
        .ok_or("Agent Terminal's window is unavailable.")?;
    window
        .show()
        .map_err(|_| "Could not show Agent Terminal.")?;
    if let Some(service) = app.try_state::<super::UsageService>() {
        service.set_window_hidden(false);
    }
    window
        .unminimize()
        .map_err(|_| "Could not restore Agent Terminal.")?;
    window
        .set_focus()
        .map_err(|_| "Could not focus Agent Terminal.")?;
    window
        .emit("jarvis:open", settings)
        .map_err(|_| "Could not open the Jarvis panel.".into())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn mini_meter(used: f64) -> String {
    let remaining = ((100.0 - used) / 100.0 * 8.0).round().clamp(0.0, 8.0) as usize;
    format!("{}{}", "●".repeat(remaining), "○".repeat(8 - remaining))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn tooltip(snapshot: &UsageSnapshot) -> String {
    use super::types::UsageStatus;
    let mut lines = vec!["Jarvis · Provider usage".to_owned()];
    for provider in snapshot
        .providers
        .iter()
        .filter(|p| snapshot.preferences.collects(&p.id))
    {
        let status = match provider.status {
            UsageStatus::Available => "Current",
            UsageStatus::Stale => "Last known",
            UsageStatus::NotConfigured => "Needs sign-in · open Agent Terminal for help",
            UsageStatus::Unsupported => "Quota unavailable",
            UsageStatus::Pending => "Waiting for refresh",
            _ => "Unavailable · open Agent Terminal for details",
        };
        lines.push(format!("{} · {}", provider.name, status));
        for window in &provider.windows {
            lines.push(format!(
                "  {}: {:.0}% left · {}",
                window.label,
                100.0 - window.used_percent,
                reset_label(window.resets_at)
            ));
        }
    }
    if lines.len() == 1 {
        lines.push("Choose providers in Jarvis settings.".into());
    }
    lines.join("\n")
}

pub fn check_host() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use dbus::blocking::{stdintf::org_freedesktop_dbus::Properties, Connection};
        let available = || -> Result<bool, dbus::Error> {
            let connection = Connection::new_session()?;
            let proxy = connection.with_proxy(
                "org.kde.StatusNotifierWatcher",
                "/StatusNotifierWatcher",
                std::time::Duration::from_millis(500),
            );
            proxy.get(
                "org.kde.StatusNotifierWatcher",
                "IsStatusNotifierHostRegistered",
            )
        };
        if !available().unwrap_or(false) {
            return Err("No Linux tray host is available. Enable your desktop’s application indicator support or use the in-app Jarvis panel.".into());
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn sync(
    app: &tauri::AppHandle,
    snapshot: &UsageSnapshot,
    host: Result<(), String>,
) -> Result<(), String> {
    if snapshot.preferences.enabled && snapshot.preferences.show_tray {
        if let Err(message) = host {
            let _ = hide_and_restore(app);
            return Err(message);
        }
    }
    sync_native(app, snapshot).map_err(|_| "The native Jarvis indicator is unavailable. On Linux, check that your desktop supports application indicators.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn sync(
    _app: &tauri::AppHandle,
    _snapshot: &UsageSnapshot,
    _host: Result<(), String>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sync_native(app: &tauri::AppHandle, snapshot: &UsageSnapshot) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;
    let enabled = snapshot.preferences.enabled && snapshot.preferences.show_tray;
    let existing = app.tray_by_id(TRAY_ID);
    if !enabled {
        return hide_and_restore(app);
    }
    let state = app.state::<NativeState>();
    let mut cached = state.0.lock().unwrap();
    let rows = menu_rows(snapshot);
    let reuse = cached
        .as_ref()
        .is_some_and(|old| same_structure(&old.rows, &rows));
    let menu = if reuse {
        let old = cached.as_ref().unwrap();
        for (previous, current) in old.rows.iter().zip(&rows) {
            if let (Some(previous), Some(current)) = (previous, current) {
                if previous == current {
                    continue;
                }
                if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = old.menu.get(&current.id) {
                    if previous.text != current.text {
                        item.set_text(&current.text)?;
                    }
                    if previous.enabled != current.enabled {
                        item.set_enabled(current.enabled)?;
                    }
                }
            }
        }
        old.menu.clone()
    } else {
        build_menu(app, &rows)?
    };
    let constrained = snapshot.most_constrained();
    let percent = constrained.map(|(_, w)| w.used_percent);
    let tooltip = tooltip(snapshot);
    let key = icon_key(percent);
    #[cfg(target_os = "macos")]
    let title = percent
        .map(|used| format!("{:.0}%", 100.0 - used))
        .unwrap_or_else(|| "—".into());
    let tray = match existing {
        Some(tray) => {
            // Preserve the exported DBusMenu object while only text/state
            // changes. Quickshell and Waybar keep open menus attached to it.
            if !reuse {
                tray.set_menu(Some(menu.clone()))?;
            }
            if cached.as_ref().map_or(true, |old| old.icon != key) {
                tray.set_icon(Some(meter_icon(percent)))?;
            }
            #[cfg(target_os = "macos")]
            if cached.as_ref().map_or(true, |old| old.tooltip != tooltip) {
                tray.set_tooltip(Some(&tooltip))?;
            }
            if cached.as_ref().map_or(true, |old| !old.visible) {
                tray.set_visible(true)?;
            }
            tray
        }
        None => TrayIconBuilder::with_id(TRAY_ID)
            .icon(meter_icon(percent))
            .icon_as_template(cfg!(target_os = "macos"))
            .tooltip(&tooltip)
            .menu(&menu)
            .show_menu_on_left_click(!cfg!(target_os = "macos"))
            .on_tray_icon_event(|_tray, _event| {
                #[cfg(target_os = "macos")]
                super::popover::handle(_tray.app_handle(), _event);
            })
            .on_menu_event(|app, event| match event.id().as_ref() {
                "jarvis-quickview" => {
                    if super::popover::quick_view(app).is_err() {
                        // Keep an actionable fallback instead of swallowing a
                        // native-window error with no visible result.
                        let _ = open_main(app, false);
                    }
                }
                "jarvis-open" | "jarvis-settings" => {
                    let _ = open_main(app, event.id().as_ref() == "jarvis-settings");
                }
                "jarvis-refresh" => {
                    if let Some(service) = app.try_state::<super::UsageService>() {
                        service.refresh();
                    }
                }
                "jarvis-quit" => app.exit(0),
                id if id.starts_with("jarvis-provider-") => {
                    let provider = &id["jarvis-provider-".len()..];
                    if super::providers::PROVIDERS.iter().any(|p| p.id == provider) {
                        let _ = open_main(app, false);
                    }
                }
                _ => {}
            })
            .build(app)?,
    };
    #[cfg(target_os = "macos")]
    if cached.as_ref().map_or(true, |old| old.title != title) {
        tray.set_title(Some(&title))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = tray;
    *cached = Some(Presentation {
        menu,
        rows,
        icon: key,
        #[cfg(target_os = "macos")]
        tooltip,
        #[cfg(target_os = "macos")]
        title,
        visible: true,
    });
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn hide_and_restore(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;
    super::close_popover(app);
    let mut hide_error = None;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        hide_error = tray.set_visible(false).err();
    }
    if let Some(state) = app.try_state::<NativeState>() {
        if let Some(cached) = state.0.lock().unwrap().as_mut() {
            cached.visible = false;
        }
    }
    if let Some(service) = app.try_state::<super::UsageService>() {
        if service.take_hidden_window() {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.show() {
                    service.set_window_hidden(true);
                    return Err(error);
                }
            }
        }
    }
    hide_error.map_or(Ok(()), Err)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn build_menu(
    app: &tauri::AppHandle,
    rows: &[Option<MenuRow>],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItem};
    let mut builder = MenuBuilder::new(app);
    for row in rows {
        builder = if let Some(row) = row {
            builder.item(&MenuItem::with_id(
                app,
                &row.id,
                &row.text,
                row.enabled,
                None::<&str>,
            )?)
        } else {
            builder.separator()
        };
    }
    builder.build()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn menu_rows(snapshot: &UsageSnapshot) -> Vec<Option<MenuRow>> {
    use super::types::UsageStatus;
    let row = |id: String, text: String, enabled| Some(MenuRow { id, text, enabled });
    let mut rows = vec![
        row(
            "jarvis-quickview".into(),
            "Jarvis · Usage overview…".into(),
            true,
        ),
        None,
    ];
    for provider in snapshot
        .providers
        .iter()
        .filter(|p| snapshot.preferences.collects(&p.id))
    {
        let status = match provider.status {
            UsageStatus::Available => "Live",
            UsageStatus::Stale => "Last-known usage",
            UsageStatus::Pending => "Waiting for refresh",
            UsageStatus::Unsupported => "Quota unavailable",
            UsageStatus::NotConfigured => "Sign in to view usage",
            _ => "Usage unavailable",
        };
        let needs_help = matches!(
            provider.status,
            UsageStatus::NotConfigured
                | UsageStatus::Error
                | UsageStatus::Unsupported
                | UsageStatus::Stale
        );
        rows.push(row(
            format!("jarvis-provider-{}", provider.id),
            format!(
                "{} · {}{}",
                provider.name,
                status,
                if needs_help { " →" } else { "" }
            ),
            needs_help,
        ));
        for window in &provider.windows {
            rows.push(row(
                format!("jarvis-{}-{}", provider.id, window.id),
                format!(
                    "  {}  {} · {:.0}% left · {}",
                    mini_meter(window.used_percent),
                    window.label,
                    100.0 - window.used_percent,
                    reset_label(window.resets_at)
                ),
                false,
            ));
        }
        if let Some(time) = provider.updated_at {
            rows.push(row(
                format!("jarvis-{}-age", provider.id),
                format!("Captured {}m ago", (super::types::now() - time).max(0) / 60),
                false,
            ));
        }
        rows.push(None);
    }
    rows.extend([
        row(
            "jarvis-refresh".into(),
            if snapshot.refreshing {
                "Refreshing…"
            } else {
                "Refresh Usage"
            }
            .into(),
            !snapshot.refreshing && !snapshot.preferences.providers.is_empty(),
        ),
        row("jarvis-settings".into(), "Jarvis Settings…".into(), true),
        row("jarvis-open".into(), "Open Agent Terminal…".into(), true),
        None,
        row("jarvis-quit".into(), "Quit Agent Terminal".into(), true),
    ]);
    rows
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn reset_label(reset: Option<i64>) -> String {
    match reset {
        Some(at) => {
            let seconds = at - super::types::now();
            if seconds <= 0 {
                "reset passed".into()
            } else if seconds >= 86_400 {
                format!(
                    "resets in {}d {}h",
                    seconds / 86_400,
                    seconds % 86_400 / 3600
                )
            } else if seconds >= 3600 {
                format!("resets in {}h {}m", seconds / 3600, seconds % 3600 / 60)
            } else {
                format!("resets in {}m", (seconds + 59) / 60)
            }
        }
        None => "reset not reported".into(),
    }
}

/// A Rust-rendered, dependency-free 20px meter. macOS treats it as a template;
/// Linux uses explicit contrast and a status color for the remaining allowance.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn meter_icon(used: Option<f64>) -> tauri::image::Image<'static> {
    let mut pixels = vec![0u8; 20 * 20 * 4];
    let color = if cfg!(target_os = "macos") {
        [0, 0, 0]
    } else if used.is_some_and(|u| u >= 90.0) {
        [239, 100, 100]
    } else if used.is_some_and(|u| u >= 75.0) {
        [235, 185, 85]
    } else {
        [135, 200, 175]
    };
    let remaining = used
        .map(|u| ((100.0 - u) / 100.0 * 13.0).round() as usize)
        .unwrap_or(0);
    for x in 2..18 {
        for y in 3..18 {
            let outline = x == 2 || x == 17 || y == 3 || y == 17;
            let fill = (5..15).contains(&x) && y >= 17 - remaining;
            if outline || fill {
                let i = (y * 20 + x) * 4;
                pixels[i..i + 3].copy_from_slice(&color);
                pixels[i + 3] = if outline { 190 } else { 255 };
            }
        }
    }
    tauri::image::Image::new_owned(pixels, 20, 20)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::types::{Preferences, ProviderUsage, UsageStatus, UsageWindow};

    fn snapshot() -> UsageSnapshot {
        let mut provider = ProviderUsage::empty("codex", "Codex", true);
        provider.status = UsageStatus::Available;
        provider.windows = vec![UsageWindow::new("session", "5 hours", 20.0, None).unwrap()];
        provider.updated_at = Some(crate::usage::types::now());
        UsageSnapshot {
            revision: 1,
            preferences: Preferences {
                enabled: true,
                show_tray: true,
                refresh_seconds: 0,
                providers: vec!["codex".into()],
            },
            providers: vec![provider],
            refreshing: false,
            tray_supported: true,
            claude_keychain_supported: false,
            tray_error: None,
            settings_error: None,
        }
    }

    #[test]
    fn quota_updates_keep_native_menu_structure_stable() {
        let mut snapshot = snapshot();
        let before = menu_rows(&snapshot);
        snapshot.providers[0].windows[0].used_percent = 60.0;
        snapshot.providers[0].updated_at = Some(crate::usage::types::now() - 120);
        snapshot.refreshing = true;
        let after = menu_rows(&snapshot);
        assert!(same_structure(&before, &after));
        assert!(before != after);
        assert!(
            !after
                .iter()
                .flatten()
                .find(|row| row.id == "jarvis-refresh")
                .unwrap()
                .enabled
        );
    }

    #[test]
    fn new_windows_require_a_menu_rebuild() {
        let mut snapshot = snapshot();
        let before = menu_rows(&snapshot);
        snapshot.providers[0]
            .windows
            .push(UsageWindow::new("weekly", "Weekly", 0.0, None).unwrap());
        assert!(!same_structure(&before, &menu_rows(&snapshot)));
    }

    #[test]
    fn icon_updates_only_when_visible_pixels_change() {
        assert_eq!(icon_key(Some(20.0)), icon_key(Some(20.1)));
        assert_ne!(icon_key(Some(74.9)), icon_key(Some(75.0)));
        assert_ne!(icon_key(Some(89.9)), icon_key(Some(90.0)));
        assert_ne!(icon_key(None), icon_key(Some(100.0)));
        assert_eq!(icon_key(Some(0.0)).unwrap().0, 13);
        assert_eq!(icon_key(Some(100.0)).unwrap().0, 0);
    }
}
