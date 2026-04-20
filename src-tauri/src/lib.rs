mod commands;
mod mod_engine;
mod pty_manager;

use mod_engine::{ModEngine, mods::EchoMod};
use tauri::Manager;
use pty_manager::PtyMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_map: PtyMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mod_engine = ModEngine::builder()
                .with_mod(EchoMod)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
