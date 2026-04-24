use crate::mod_engine::ModEngine;
use crate::pty_manager::{spawn_pty, try_reattach, PtyDataPayload, PtyMap, ReattachResult};
use portable_pty::PtySize;
use std::io::Write;
use tauri::{AppHandle, Emitter, State};
use tauri::ipc::Channel;

#[tauri::command]
pub async fn open_tab(
    app: AppHandle,
    pty_map: State<'_, PtyMap>,
    mod_engine: State<'_, ModEngine>,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    on_data: Channel<PtyDataPayload>,
) -> Result<bool, String> {
    // Returns true  → new PTY spawned; frontend waits for the initial prompt.
    // Returns false → existing PTY (live or just reattached); frontend sends \r
    //                 to make the shell redraw its prompt.
    //
    // Three cases handled before falling through to spawn_pty:
    //
    // 1. ChannelUpdated — reader thread is alive and blocking on read(). The
    //    shared Channel ref has been swapped to the new WebView connection.
    //    Output resumes on the next byte from the PTY. Returns false.
    //
    // 2. Reattached — reader thread had already exited before the reconnect
    //    arrived (rare race: PTY EOF beat the reconnect). A new reader thread
    //    is spawned on the same master fd. Returns false.
    //
    // 3. Expired / NotFound — child exited or no entry. Fall through to a fresh
    //    spawn_pty. Returns true.
    match try_reattach(app.clone(), &pty_map, mod_engine.handle(), &tab_id, on_data.clone()) {
        Ok(ReattachResult::ChannelUpdated) | Ok(ReattachResult::Reattached) => {
            // The [Reconnected] banner is written directly to the data channel
            // inside try_reattach — no listener timing gap. This event is emitted
            // for any future consumers that want to react to reconnects without
            // rendering text (e.g. status bar state, telemetry).
            app.emit("pty:reconnected", serde_json::json!({ "tabId": &tab_id })).ok();
            return Ok(false);
        }
        Ok(ReattachResult::Expired) | Ok(ReattachResult::NotFound) => {
            // Fall through to fresh spawn below.
        }
        Err(e) => return Err(e),
    }

    spawn_pty(app, &pty_map, mod_engine.handle(), tab_id, cwd, shell, on_data)?;
    Ok(true)
}

#[tauri::command]
pub async fn write_pty(
    pty_map: State<'_, PtyMap>,
    mod_engine: State<'_, ModEngine>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let data_bytes = data.into_bytes();
    {
        let mut map = pty_map.lock().unwrap();
        if let Some(handle) = map.get_mut(&tab_id) {
            handle.writer.write_all(&data_bytes).map_err(|e| e.to_string())?;
        } else {
            return Ok(()); // Tab already closed — no-op, not an error.
        }
    } // Lock released before dispatching to MOD engine.
    mod_engine.handle().on_input(&tab_id, data_bytes);
    Ok(())
}

#[tauri::command]
pub async fn resize_pty(
    pty_map: State<'_, PtyMap>,
    mod_engine: State<'_, ModEngine>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let map = pty_map.lock().unwrap();
        if let Some(handle) = map.get(&tab_id) {
            handle
                .master
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        } else {
            return Ok(()); // Tab already closed — no-op, not an error.
        }
    } // Lock released before dispatching to MOD engine.
    mod_engine.handle().on_resize(&tab_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn close_tab(
    pty_map: State<'_, PtyMap>,
    tab_id: String,
) -> Result<(), String> {
    // MOD on_close is triggered by the PTY read thread exiting (pty:exit), not
    // here — close_tab only drops the master/writer, causing the thread to see
    // EOF and fire on_close itself. This avoids a double on_close if the shell
    // exits on its own before close_tab is called.
    pty_map.lock().unwrap().remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn save_projects(projects: serde_json::Value) -> Result<(), String> {
    let path = projects_config_path()?;
    let parent = path.parent().unwrap().to_owned();
    tokio::fs::create_dir_all(&parent).await.map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_projects() -> Result<serde_json::Value, String> {
    let path = projects_config_path()?;
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn projects_config_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not determine home directory")?;
    Ok(home.join(".config/agent-terminal/projects.json"))
}
