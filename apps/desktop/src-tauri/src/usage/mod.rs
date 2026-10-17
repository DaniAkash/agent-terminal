mod credentials;
mod discovery;
mod http;
mod popover;
mod preferences;
mod providers;
mod service;
mod tray;
mod types;

pub use service::UsageService;
pub use types::{Preferences, UsageSnapshot};

#[tauri::command]
pub fn jarvis_snapshot(service: tauri::State<'_, UsageService>) -> UsageSnapshot {
    service.snapshot()
}

#[tauri::command]
pub fn jarvis_refresh(service: tauri::State<'_, UsageService>) {
    service.refresh();
}

#[tauri::command]
pub async fn jarvis_rescan_agents(service: tauri::State<'_, UsageService>) -> Result<(), String> {
    service.scan_agents().await
}

#[tauri::command]
pub fn jarvis_open_main(app: tauri::AppHandle, settings: bool) -> Result<(), String> {
    tray::open_main(&app, settings)
}

#[tauri::command]
pub fn jarvis_dismiss_tray(app: tauri::AppHandle) {
    popover::dismiss(&app);
}

pub fn close_popover(app: &tauri::AppHandle) {
    popover::destroy(app);
}

#[tauri::command]
pub async fn jarvis_set_preferences(
    service: tauri::State<'_, UsageService>,
    preferences: Preferences,
) -> Result<UsageSnapshot, String> {
    service.set_preferences(preferences).await
}

#[tauri::command]
pub async fn jarvis_authorize_claude_keychain(
    service: tauri::State<'_, UsageService>,
) -> Result<(), String> {
    if !service.snapshot().preferences.collects("claude-code") {
        return Err("Enable Claude Code in Jarvis settings first.".into());
    }
    tokio::task::spawn_blocking(credentials::authorize_claude_keychain)
        .await
        .map_err(|_| "Could not authorize Claude Code Keychain access.")??;
    service.refresh();
    Ok(())
}

#[cfg(test)]
mod tests;
