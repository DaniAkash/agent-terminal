use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub data: Vec<u8>,
}

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

pub fn spawn_pty(
    app: AppHandle,
    pty_map: &PtyMap,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
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

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let tab_id_thread = tab_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    app.emit("pty:exit", PtyExitPayload { tab_id: tab_id_thread.clone() })
                        .ok();
                    break;
                }
                Ok(n) => {
                    app.emit(
                        "pty:data",
                        PtyDataPayload {
                            tab_id: tab_id_thread.clone(),
                            data: buf[..n].to_vec(),
                        },
                    )
                    .ok();
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
