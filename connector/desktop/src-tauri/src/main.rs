#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Only the explicitly bundled Python bridge may be launched by the UI.
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("YoungMoney3 Signal Desk desktop initialization failed");
}