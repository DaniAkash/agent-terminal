use crate::pty_manager::{spawn_pty, PtyDataPayload, PtyMap};
use portable_pty::PtySize;
use std::io::Write;
use tauri::{AppHandle, State};
use tauri::ipc::Channel;

#[tauri::command]
pub async fn open_tab(
    app: AppHandle,
    pty_map: State<'_, PtyMap>,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    on_data: Channel<PtyDataPayload>,
) -> Result<bool, String> {
    // Returns true if a new pty was spawned, false if one was already running.
    // The frontend uses this to decide whether to wait for the initial prompt
    // or send \r to re-display the prompt on a freshly-mounted terminal.
    if pty_map.lock().unwrap().contains_key(&tab_id) {
        return Ok(false);
    }
    spawn_pty(app, &pty_map, tab_id, cwd, shell, on_data)?;
    Ok(true)
}

#[tauri::command]
pub async fn write_pty(
    pty_map: State<'_, PtyMap>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let mut map = pty_map.lock().unwrap();
    if let Some(handle) = map.get_mut(&tab_id) {
        handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_pty(
    pty_map: State<'_, PtyMap>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = pty_map.lock().unwrap();
    if let Some(handle) = map.get(&tab_id) {
        handle
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_tab(
    pty_map: State<'_, PtyMap>,
    tab_id: String,
) -> Result<(), String> {
    pty_map.lock().unwrap().remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn list_projects() -> Result<serde_json::Value, String> {
    // Milestone 3: reads from ~/.config/agent-terminal/projects.json
    Ok(serde_json::json!([]))
}
