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
    // Three cases are handled here before falling through to spawn_pty:
    //
    // 1. Reader alive — already connected (StrictMode double-mount, tab switch).
    //    No action needed; return false.
    //
    // 2. Reader dead, child alive — WebView previously disconnected (window
    //    close/reopen, HMR reload). Reattach: a new reader thread is wired to
    //    the existing PTY master fd and the new Channel. The PTY process (shell
    //    or running agent) is undisturbed. Returns false so the frontend sends
    //    \r and the shell redraws its prompt.
    //
    // 3. Reader dead, child exited — PTY is truly dead. The stale PtyMap entry
    //    is removed and a fresh PTY is spawned below. Returns true.
    match try_reattach(app.clone(), &pty_map, mod_engine.handle(), &tab_id, on_data.clone()) {
        Ok(ReattachResult::AlreadyLive) => {
            return Ok(false);
        }
        Ok(ReattachResult::Reattached) => {
            // Notify the frontend so it can show a "[Reconnected]" banner.
            // This fires after the reader thread is already running, so the
            // banner appears before any buffered PTY output is flushed.
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
