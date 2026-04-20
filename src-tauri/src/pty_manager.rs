use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
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
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

/// 256 KB — captures a full burst of output in a single read() call on most
/// shells. Reduces Channel message count by ~64× vs the old 4 KB buffer for
/// high-throughput output (cat, build tools, find).
const READ_BUF_SIZE: usize = 256 * 1024;

/// Flush the accumulation buffer once it exceeds this size even if the read
/// loop has not blocked. Prevents unbounded accumulation during continuous
/// high-speed streams.
const FLUSH_THRESHOLD: usize = 32 * 1024;

pub fn spawn_pty(
    app: AppHandle,
    pty_map: &PtyMap,
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

    pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let tab_id_thread = tab_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        let mut accumulated = String::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // Flush any remaining accumulated data before signalling exit.
                    if !accumulated.is_empty() {
                        on_data
                            .send(PtyDataPayload { data: std::mem::take(&mut accumulated) })
                            .ok();
                    }
                    app.emit(
                        "pty:exit",
                        PtyExitPayload { tab_id: tab_id_thread.clone() },
                    )
                    .ok();
                    break;
                }
                Ok(n) => {
                    accumulated.push_str(&String::from_utf8_lossy(&buf[..n]));

                    // Flush when the buffer is large enough. For interactive sessions
                    // (small writes, ~1–64 bytes per keystroke echo) accumulated stays
                    // well below the threshold and is flushed on the next read block.
                    // For burst output the threshold caps the message payload at 32 KB.
                    if accumulated.len() >= FLUSH_THRESHOLD {
                        on_data
                            .send(PtyDataPayload { data: std::mem::take(&mut accumulated) })
                            .ok();
                    }
                }
            }
        }
    });

    pty_map
        .lock()
        .unwrap()
        .insert(tab_id, PtyHandle { master: pair.master, writer });

    Ok(())
}
