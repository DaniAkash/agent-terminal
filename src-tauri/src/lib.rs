mod commands;
mod mod_engine;
mod pty_manager;
mod shell_integration;

use mod_engine::{
    ModEngine,
    mods::{
        ClaudeCodeMod,
        CodexMod,
        DirTrackerMod,
        GitMonitorMod,
        ProcessInspectorMod,
        ProcessTrackerMod,
    },
};
use shell_integration::setup_shell_integration;
use tauri::Manager;
use pty_manager::PtyMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Best-effort: write shell integration scripts. Never fail app startup.
            if let Err(e) = setup_shell_integration() {
                eprintln!("[agent-terminal] shell integration setup failed: {e}");
            }

            let mod_engine = ModEngine::builder()
                .with_mod(DirTrackerMod::new())
                .with_mod(ProcessTrackerMod::new())
                .with_mod(ClaudeCodeMod::new())
                .with_mod(CodexMod::new())
                .with_mod(ProcessInspectorMod::new())
                .with_mod(GitMonitorMod::new())
                .build(app.handle().clone());
            app.manage(mod_engine);
            Ok(())
        })
        .manage(pty_map)
        .invoke_handler(tauri::generate_handler![
            commands::open_tab,
            commands::write_pty,
            commands::resize_pty,
            commands::close_tab,
            commands::list_projects,
            commands::save_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
