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

/// The active frontend channel, shared between the reader thread and open_tab.
///
/// Wrapped in Arc<Mutex<Option<...>>> so open_tab can swap in a new Channel
/// when the WebView reconnects without stopping or restarting the reader thread.
/// The Option is None when the WebView is disconnected — the reader discards
/// output silently during that window rather than exiting.
pub type SharedChannel = Arc<Mutex<Option<Channel<PtyDataPayload>>>>;

pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    /// The child process (shell or agent). Kept so open_tab can call try_wait()
    /// to distinguish "child still running but WebView disconnected" (healable)
    /// from "child exited and PTY is truly dead" (needs fresh spawn).
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Flipped to false when the reader thread exits. Only exits on PTY EOF —
    /// not on channel failure. Used to know whether a new reader thread must be
    /// spawned if the reader somehow exited before the reconnect arrived.
    pub reader_alive: Arc<AtomicBool>,
    /// The live frontend channel. Swapped by open_tab on reconnect without
    /// touching the reader thread or the PTY process.
    pub channel: SharedChannel,
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
    /// Channel was updated and the reader thread is still running. open_tab
    /// should return false; the reader picks up the new channel on next output.
    ChannelUpdated,
    /// Channel was updated and a new reader thread was spawned (the previous one
    /// had already exited before the reconnect arrived). open_tab returns false.
    Reattached,
    /// Child process has exited — PTY is truly dead. Stale entry removed.
    /// open_tab should spawn a fresh PTY.
    Expired,
    /// No PtyMap entry found. open_tab should spawn a fresh PTY.
    NotFound,
}

/// Spawns a dedicated reader thread that forwards PTY output to the frontend.
///
/// # Channel failure behaviour (self-healing contract)
///
/// When on_data.send() fails (WebView disconnected, Channel JS object dropped),
/// the reader thread does NOT exit. It clears the shared channel and keeps
/// reading, discarding output until open_tab swaps in a new Channel.
///
/// This is the critical design choice that makes reconnection work regardless
/// of timing: even if the reader thread is blocked on read() when the WebView
/// disconnects, open_tab can safely hand it a new channel and the reader will
/// start forwarding again on the very next byte of PTY output — no thread
/// restart, no race on reader_alive.
///
/// # Known limitations
///
/// - **No output replay**: bytes sent to the terminal between disconnect and
///   reconnect are discarded. Output still in the kernel PTY buffer at the
///   moment the channel is cleared may or may not be delivered — it depends on
///   whether the send error is detected before or after that read() returns.
///   A VS Code-style ring buffer would close this gap but is not implemented.
///
/// - **Mid-session drops only heal on next open_tab**: if the IPC channel dies
///   while the WebView is still running (not a WebView restart), the reader
///   clears its channel and goes silent — but nothing triggers open_tab again.
///   A heartbeat/ping mechanism would be needed to detect and surface this.
///
/// - **Full-app crash**: if the Tauri process exits, all PTY sessions are lost.
///   A separate long-lived pty-host process (VS Code model) would be needed
///   for crash survival, and is out of scope for now.
fn spawn_reader_thread(
    app: AppHandle,
    tab_id: String,
    mut reader: Box<dyn Read + Send>,
    channel: SharedChannel,
    mod_handle: ModEngineHandle,
    reader_alive: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // PTY process exited or master fd closed (close_tab called).
                    // Clear the channel before emitting exit so no stale sends
                    // race the teardown.
                    channel.lock().unwrap().take();
                    app.emit(
                        "pty:exit",
                        PtyExitPayload { tab_id: tab_id.clone() },
                    )
                    .ok();
                    mod_handle.on_tab_close(&tab_id);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();

                    // Lock briefly to send — released before calling on_output.
                    let send_ok = {
                        let guard = channel.lock().unwrap();
                        match guard.as_ref() {
                            Some(ch) => {
                                ch.send(PtyDataPayload { data: data.clone() }).is_ok()
                            }
                            // No channel — WebView is disconnected. Discard and
                            // keep reading so the reader thread stays alive for
                            // the next open_tab call.
                            None => true,
                        }
                    };

                    if !send_ok {
                        // Channel dropped mid-flight (WebView disconnected while
                        // we were sending). Clear the dead channel and keep the
                        // reader thread alive — the PTY process is still running
                        // and open_tab will swap in a new channel on reconnect.
                        // Output from this read is lost; no replay buffer.
                        channel.lock().unwrap().take();
                    } else {
                        // Forward to MOD engine — non-blocking, silently drops
                        // under load. The terminal always gets every byte.
                        mod_handle.on_output(&tab_id, buf[..n].to_vec());
                    }
                }
            }
        }

        // Reader thread is exiting — only happens on PTY EOF or master fd close.
        reader_alive.store(false, Ordering::Relaxed);
    });
}

/// Checks whether an existing PtyMap entry can be reconnected, and if so,
/// wires up the new Channel and (if needed) a new reader thread.
///
/// Must be called before spawn_pty in open_tab. Acts on the result:
/// - ChannelUpdated / Reattached → emit pty:reconnected, return Ok(false)
/// - Expired / NotFound          → call spawn_pty, return Ok(true)
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

    // If the child has exited, the PTY is truly dead — remove the stale entry
    // so the caller can spawn a fresh PTY.
    if matches!(handle.child.try_wait(), Ok(Some(_))) {
        map.remove(tab_id);
        return Ok(ReattachResult::Expired);
    }

    // Child is still running (or indeterminate). Swap in the new channel.
    // The reader thread — whether blocking on read() or actively discarding —
    // will forward output via this channel on its next iteration.
    {
        let mut ch = handle.channel.lock().unwrap();
        *ch = Some(on_data);

        // Write the reconnect banner directly through the data channel before
        // returning. This is intentionally synchronous — the Channel.onmessage
        // handler on the JS side is registered before invoke() is called, so
        // this send is guaranteed to arrive without any listener timing issues.
        //
        // Writing via the data channel (rather than a Tauri event) avoids the
        // async listen() race: Tauri events need listen() to resolve (a Promise)
        // before the listener is active, but that Promise may not resolve before
        // pty:reconnected fires. The data channel has no such gap.
        if let Some(ch_ref) = ch.as_ref() {
            ch_ref
                .send(PtyDataPayload {
                    data: "\r\n\x1b[2m[Reconnected]\x1b[0m\r\n".to_string(),
                })
                .ok();
        }
    }

    if handle.reader_alive.load(Ordering::Relaxed) {
        // Reader is running. Channel is updated. No thread restart needed.
        return Ok(ReattachResult::ChannelUpdated);
    }

    // Reader thread exited before the reconnect arrived (it detected the dead
    // channel, cleared it, and then... wait, in the new design the reader does
    // NOT exit on channel failure). This branch is only reached if the PTY
    // process itself sent EOF and reader_alive is false, but try_wait() above
    // did not confirm child exit (race in zombie reaping). Spawn a fresh reader
    // — it will see EOF quickly and emit pty:exit on its own.
    let new_alive = Arc::new(AtomicBool::new(true));
    handle.reader_alive = new_alive.clone();
    let reader = handle.master.try_clone_reader().map_err(|e| e.to_string())?;
    let channel = handle.channel.clone();
    drop(map); // release the PtyMap lock before spawning

    spawn_reader_thread(app, tab_id.to_string(), reader, channel, mod_handle, new_alive);
    Ok(ReattachResult::Reattached)
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

    let channel: SharedChannel = Arc::new(Mutex::new(Some(on_data)));
    let reader_alive = Arc::new(AtomicBool::new(true));

    spawn_reader_thread(
        app,
        tab_id.clone(),
        reader,
        channel.clone(),
        mod_handle,
        reader_alive.clone(),
    );

    pty_map.lock().unwrap().insert(
        tab_id,
        PtyHandle { master: pair.master, writer, child, reader_alive, channel },
    );

    Ok(())
}
