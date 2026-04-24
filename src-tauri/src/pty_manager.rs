use crate::mod_engine::ModEngineHandle;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri::ipc::Channel;

/// Sent directly to the frontend via the per-tab Channel.
/// No tabId field — the channel is already bound to a specific tab.
#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub data: String,
}

/// Emitted as a global event on shell exit. Fires rarely so the event bus
/// overhead is acceptable; no Channel needed.
#[derive(Serialize, Clone)]
pub struct PtyExitPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
}

pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    /// The child process (shell or agent). Kept alive so we can call
    /// try_wait() during reconnect to distinguish "child still running but
    /// channel dropped" from "child exited and PTY is truly dead".
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Flipped to false by the reader thread when it exits — for any reason,
    /// whether the channel was dropped (WebView disconnect) or the PTY process
    /// exited. open_tab checks this flag to decide whether to reattach.
    pub reader_alive: Arc<AtomicBool>,
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

/// 256 KB read buffer. A single read() call can return up to this many bytes
/// when the kernel has burst output ready (build tools, cat, find). This IS
/// the coalescing — no separate accumulation loop is needed.
///
/// For interactive use (prompt, keystroke echo) the kernel returns a small
/// number of bytes immediately and read() blocks again. Those bytes are sent
/// right away so the terminal never freezes waiting for a threshold.
const READ_BUF_SIZE: usize = 256 * 1024;

/// Outcome returned by try_reattach — tells open_tab what happened.
pub enum ReattachResult {
    /// Reader thread was alive — already connected, no action taken.
    AlreadyLive,
    /// Reader was dead but child is still running — new reader thread spawned
    /// on the existing PTY. The caller should return false (not a new session).
    Reattached,
    /// Reader was dead and child has exited — stale PtyMap entry removed.
    /// The caller should spawn a fresh PTY.
    Expired,
    /// No PtyMap entry for this tab — caller should spawn a fresh PTY.
    NotFound,
}

/// Spawns a dedicated reader thread that forwards PTY output to the frontend
/// via the per-tab Channel.
///
/// Reader thread exit behaviour:
/// - PTY process exits (read returns 0 or Err): emits `pty:exit`, calls
///   on_tab_close, then exits. PTY is truly dead.
/// - Channel dropped (send returns Err — WebView disconnected): exits silently.
///   Does NOT emit pty:exit and does NOT call on_tab_close, because the PTY
///   process is still running. MOD state is preserved so it can be resumed
///   when the frontend reconnects.
///
/// In both cases reader_alive is set to false before the thread exits,
/// allowing open_tab to detect the stale state on reconnect.
///
/// # Reconnection limitations
///
/// This mechanism heals WebView-restart disconnects (window close/reopen, HMR
/// reload) by reattaching a new reader thread to the existing PTY master fd.
///
/// It does NOT cover:
/// - Output replay: bytes that the old reader thread read but could not send
///   before the channel drop are gone. Output written by the PTY process after
///   the channel dropped but before the new reader attaches may survive if still
///   in the kernel PTY buffer, but this is not guaranteed.
/// - Mid-session IPC drops while the WebView is still running: those require
///   an active heartbeat/liveness probe, which is not implemented.
/// - Full-app crash recovery: if the Tauri process exits, all PTY sessions are
///   lost. A separate pty-host process (VS Code model) would be needed for that.
fn spawn_reader_thread(
    app: AppHandle,
    tab_id: String,
    mut reader: Box<dyn Read + Send>,
    on_data: Channel<PtyDataPayload>,
    mod_handle: ModEngineHandle,
    reader_alive: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // PTY process exited or read error — PTY is dead.
                    app.emit(
                        "pty:exit",
                        PtyExitPayload { tab_id: tab_id.clone() },
                    )
                    .ok();
                    mod_handle.on_tab_close(&tab_id);
                    break;
                }
                Ok(n) => {
                    // Send to terminal — always first, never skipped.
                    if on_data
                        .send(PtyDataPayload {
                            data: String::from_utf8_lossy(&buf[..n]).into_owned(),
                        })
                        .is_err()
                    {
                        // Channel dropped — WebView disconnected.
                        // The PTY process is still running; do not emit pty:exit
                        // and do not call on_tab_close. MOD state is intact and
                        // the next open_tab call will reattach a new reader.
                        break;
                    }
                    // Forward to MOD engine — non-blocking, silently drops under load.
                    // The terminal always gets every byte regardless of engine backpressure.
                    mod_handle.on_output(&tab_id, buf[..n].to_vec());
                }
            }
        }

        // Always mark dead on exit, regardless of reason. open_tab reads this
        // flag to decide whether a reattach is needed on the next call.
        reader_alive.store(false, Ordering::Relaxed);
    });
}

/// Checks whether the PTY for `tab_id` needs reconnection and, if so, handles
/// it. Call this before spawn_pty so open_tab can short-circuit.
///
/// Returns a ReattachResult describing what happened. The caller acts on it:
/// - AlreadyLive / Reattached → return Ok(false) to the frontend
/// - Expired / NotFound → call spawn_pty, return Ok(true)
pub fn try_reattach(
    app: AppHandle,
    pty_map: &PtyMap,
    mod_handle: ModEngineHandle,
    tab_id: &str,
    on_data: Channel<PtyDataPayload>,
) -> Result<ReattachResult, String> {
    let mut map = pty_map.lock().unwrap();

    let Some(handle) = map.get_mut(tab_id) else {
        return Ok(ReattachResult::NotFound);
    };

    if handle.reader_alive.load(Ordering::Relaxed) {
        // Reader is still running — normal reconnect path (StrictMode double
        // mount, tab switch, etc.). Nothing to do.
        return Ok(ReattachResult::AlreadyLive);
    }

    // Reader thread has exited. Determine whether the child process is alive.
    // try_wait() is non-blocking: returns Ok(Some(_)) if exited, Ok(None) if
    // still running, Err if the check itself failed.
    match handle.child.try_wait() {
        Ok(Some(_)) => {
            // Child has exited — PTY is truly dead. Remove the stale entry so
            // the caller can spawn a fresh PTY for this tab.
            map.remove(tab_id);
            Ok(ReattachResult::Expired)
        }
        _ => {
            // Child is still running (try_wait returned Ok(None) or Err).
            // Reattach: get a new read handle on the same PTY master fd and
            // spin up a fresh reader thread wired to the new Channel.
            //
            // try_clone_reader() is the key API here — it creates a second
            // Box<dyn Read + Send> on the existing master fd without disturbing
            // the PTY or the process running inside it. The original read handle
            // (held by the now-dead thread) has been dropped; this call is safe.
            let reader = handle.master.try_clone_reader().map_err(|e| e.to_string())?;

            let new_alive = Arc::new(AtomicBool::new(true));
            handle.reader_alive = new_alive.clone();

            drop(map); // release the lock before spawning the thread

            spawn_reader_thread(
                app,
                tab_id.to_string(),
                reader,
                on_data,
                mod_handle,
                new_alive,
            );

            Ok(ReattachResult::Reattached)
        }
    }
}

pub fn spawn_pty(
    app: AppHandle,
    pty_map: &PtyMap,
    mod_handle: ModEngineHandle,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    on_data: Channel<PtyDataPayload>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell_path = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.env("AGENT_TERMINAL_TAB_ID", &tab_id);
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    // Inject shell integration based on the shell binary name
    let shell_name = std::path::Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    if shell_name == "zsh" {
        // ZDOTDIR redirect: zsh will load ~/.config/agent-terminal/zsh/.zshrc
        // instead of ~/.zshrc. Our script then sources the real ~/.zshrc.
        let at_zsh_dir = dirs::home_dir()
            .map(|h| h.join(".config").join("agent-terminal").join("zsh"))
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        if let Some(zdotdir) = at_zsh_dir {
            let home = dirs::home_dir()
                .and_then(|h| h.to_str().map(|s| s.to_string()))
                .unwrap_or_default();
            cmd.env("ZDOTDIR", &zdotdir);
            cmd.env("ZDOTDIR_ORIG", &home);
        }
    } else if shell_name == "bash" {
        // --init-file replaces ~/.bashrc for non-login shells
        let init_file = dirs::home_dir()
            .map(|h| h.join(".config").join("agent-terminal").join("bash-integration.bash"))
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        if let Some(init) = init_file {
            cmd.arg("--init-file");
            cmd.arg(&init);
        }
    }
    // Other shells: no injection

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let shell_pid = child.process_id().unwrap_or(0);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Notify MODs before the read thread starts so on_open is always processed
    // before any on_output messages in the engine's ordered channel.
    mod_handle.on_tab_open(&tab_id, shell_pid);

    let reader_alive = Arc::new(AtomicBool::new(true));

    spawn_reader_thread(
        app,
        tab_id.clone(),
        reader,
        on_data,
        mod_handle,
        reader_alive.clone(),
    );

    pty_map.lock().unwrap().insert(
        tab_id,
        PtyHandle { master: pair.master, writer, child, reader_alive },
    );

    Ok(())
}
