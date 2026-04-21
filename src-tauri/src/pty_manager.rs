use crate::mod_engine::ModEngineHandle;
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

/// 256 KB read buffer. A single read() call can return up to this many bytes
/// when the kernel has burst output ready (build tools, cat, find). This IS
/// the coalescing — no separate accumulation loop is needed.
///
/// For interactive use (prompt, keystroke echo) the kernel returns a small
/// number of bytes immediately and read() blocks again. Those bytes are sent
/// right away so the terminal never freezes waiting for a threshold.
const READ_BUF_SIZE: usize = 256 * 1024;

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

    pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Notify MODs before the read thread starts so on_open is always processed
    // before any on_output messages in the engine's ordered channel.
    mod_handle.on_tab_open(&tab_id);

    let tab_id_thread = tab_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    app.emit(
                        "pty:exit",
                        PtyExitPayload { tab_id: tab_id_thread.clone() },
                    )
                    .ok();
                    mod_handle.on_tab_close(&tab_id_thread);
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
                        break;
                    }
                    // Forward to MOD engine — non-blocking, silently drops under load.
                    // The terminal always gets every byte regardless of engine backpressure.
                    mod_handle.on_output(&tab_id_thread, buf[..n].to_vec());
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
