use crate::mod_engine::ModEngine;
use crate::projects_cache::{ProjectsCache, StoredProject};
use crate::protocol::ServerFrame;
use crate::wss_server::MobileOpInboxes;
use crate::pty_manager::{spawn_pty, try_reattach, PtyDataPayload, PtyMap, ReattachResult};
use crate::stream_hub::StreamHub;
use portable_pty::PtySize;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use tauri::ipc::Channel;

// Tauri commands take their managed state + frontend args by position.
// Bundling into a struct would lose the ergonomic state injection.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn open_tab(
    app: AppHandle,
    pty_map: State<'_, PtyMap>,
    mod_engine: State<'_, ModEngine>,
    hub: State<'_, Arc<StreamHub>>,
    projects_cache: State<'_, Arc<ProjectsCache>>,
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
    match try_reattach(
        app.clone(),
        &pty_map,
        mod_engine.handle(),
        mod_engine.cwd_table(),
        Arc::clone(&hub),
        &tab_id,
        on_data.clone(),
    ) {
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

    spawn_pty(
        app,
        &pty_map,
        mod_engine.handle(),
        mod_engine.cwd_table(),
        Arc::clone(&hub),
        Some(Arc::clone(&projects_cache)),
        tab_id,
        cwd,
        shell,
        Some(on_data),
    )?;
    // Notify any WSS subscribers that the tab inventory changed so
    // they push a fresh Projects frame to their mobile clients.
    projects_cache.notify_spawn_change();
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
    hub: State<'_, Arc<StreamHub>>,
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
    // Keep the sidecar's shadow xterm in sync so its future serialize
    // payload reflects the right viewport dimensions. Fire-and-forget.
    hub.resize_tab(&tab_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn close_tab(
    pty_map: State<'_, PtyMap>,
    hub: State<'_, Arc<StreamHub>>,
    projects_cache: State<'_, Arc<ProjectsCache>>,
    tab_id: String,
) -> Result<(), String> {
    // The reader thread reads `closing` on EOF to decide between emitting
    // pty:exit (user close, current path) and respawning the shell at the
    // last known cwd (self-exit). Setting the flag and dropping the entry
    // under the same lock means there's no torn state: by the time the
    // reader reads `closing`, either we've already set it (and the entry
    // is gone — exit path) or we haven't yet (entry still present —
    // respawn path).
    {
        let mut map = pty_map.lock().unwrap();
        if let Some(handle) = map.get(&tab_id) {
            handle.closing.store(true, Ordering::Release);
        }
        map.remove(&tab_id);
    }
    // Drop hub state + tell the sidecar to dispose its shadow xterm.
    // Done after the PtyMap mutation so the reader thread's `closing`
    // check sees the same ordering it always did. Fire-and-forget.
    hub.close_tab(&tab_id);
    // Notify WSS subscribers so mobile clients see the tab disappear.
    projects_cache.notify_spawn_change();
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

/// Push the desktop React `$projects` nano-store into the WSS
/// ProjectsCache. React subscribes to `$projects` and invokes this on
/// every change (including hydration on app boot). The cache broadcasts
/// to every connected mobile client, so a phone that is already paired
/// sees create / rename / delete / reorder actions from the desktop
/// within a network round trip.
///
/// `projects` arrives in the frontend camelCase shape (matches Tab and
/// Project TS types). We reuse the same StoredProject / StoredTab
/// deserialisation the disk fallback uses, then map to the snake_case
/// wire ProjectSummary via `Into`.
#[tauri::command]
pub async fn sync_projects_to_wss(
    projects_cache: State<'_, Arc<ProjectsCache>>,
    projects: Vec<StoredProject>,
    hydrated: bool,
) -> Result<(), String> {
    projects_cache.set(projects.into_iter().map(Into::into).collect());
    // Phase B: React's first sync sets `hydrated: true` from
    // main.tsx::bootstrap after listProjects() resolves. Subsequent
    // per-mutation calls also carry `hydrated: true` (idempotent). WSS
    // CRUD dispatch gates on this flag so mobile ops arriving during
    // the cold-start window get a clean OpError instead of vanishing
    // into an unlistened Tauri event bus.
    if hydrated {
        projects_cache.set_hydrated();
    }
    Ok(())
}

/// React reports a mobile CRUD op failure back to the WSS server. The
/// server looks up the outbox we registered when the CRUD frame first
/// arrived and routes an `OpError` frame to that connection.
///
/// `connection_id + op_id` compound key: `op_id` alone would collide
/// across mobile clients since each client's counter starts at 1.
/// Rust assigns `connection_id` on WebSocket upgrade and threads it
/// through the `wss:mobile_op` payload; React echoes it back here so
/// we route to the exact originating outbox.
#[tauri::command]
pub async fn report_mobile_op_error(
    inboxes: State<'_, Arc<MobileOpInboxes>>,
    connection_id: u64,
    op_id: u64,
    reason: String,
) -> Result<(), String> {
    if let Some(tx) = inboxes
        .0
        .lock()
        .expect("mobile_op_inboxes lock poisoned")
        .remove(&(connection_id, op_id))
    {
        let _ = tx.send(ServerFrame::OpError { op_id, reason });
    }
    Ok(())
}

/// React reports a mobile CRUD op succeeded. Routes an OpOk frame back
/// to the originating client so its pending promise resolves. Without
/// this, the sender's Promise waits indefinitely until it times out,
/// even though the mutation applied cleanly. See
/// `report_mobile_op_error` for the connection_id + op_id keying
/// rationale.
#[tauri::command]
pub async fn report_mobile_op_ok(
    inboxes: State<'_, Arc<MobileOpInboxes>>,
    connection_id: u64,
    op_id: u64,
) -> Result<(), String> {
    if let Some(tx) = inboxes
        .0
        .lock()
        .expect("mobile_op_inboxes lock poisoned")
        .remove(&(connection_id, op_id))
    {
        let _ = tx.send(ServerFrame::OpOk { op_id });
    }
    Ok(())
}

/// Wrapper struct so Tauri managed-state resolution can distinguish
/// `Option<String>` from other Options in the app state map. Holds the
/// SHA-256 fingerprint of the WSS server's self-signed cert, formatted
/// as `openssl x509 -fingerprint -sha256` output (colon-separated
/// uppercase hex). None when tls_enabled=false or when cert generation
/// failed at startup.
pub struct TlsFingerprint(pub Option<String>);

/// Return the fingerprint the mobile client should verify against.
/// PR B's pairing UI embeds this in the QR alongside the WSS URL and
/// the pairing token. Returns an error when TLS is disabled so the
/// caller can surface a clear message instead of pretending pairing is
/// possible.
#[tauri::command]
pub async fn get_tls_fingerprint(
    state: tauri::State<'_, TlsFingerprint>,
) -> Result<String, String> {
    state
        .0
        .clone()
        .ok_or_else(|| "TLS is disabled or cert generation failed at startup".to_string())
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
    Ok(home
        .join(".config")
        .join(crate::identity::NAMESPACE)
        .join("projects.json"))
}
