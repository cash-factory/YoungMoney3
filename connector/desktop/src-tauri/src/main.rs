#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

const UPDATE_ENDPOINT: &str =
    "https://github.com/cash-factory/YoungMoney3/releases/download/staging-signaldesk-channel/latest.json";

#[derive(Serialize)]
struct AvailableUpdate {
    configured: bool,
    available: bool,
    version: String,
    notes: Vec<String>,
}

fn updater_enabled() -> bool {
    option_env!("YMFX_SIGNALDESK_UPDATE_PUBLIC_KEY")
        .is_some_and(|value| !value.trim().is_empty())
}

#[tauri::command]
async fn check_connector_update(app: tauri::AppHandle) -> Result<AvailableUpdate, String> {
    if !updater_enabled() {
        return Ok(AvailableUpdate {
            configured: false,
            available: false,
            version: String::new(),
            notes: vec![],
        });
    }
    let updater = app.updater().map_err(|_| "Update service unavailable")?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Could not check for signed updates")?;
    if let Some(update) = update {
        let notes = update
            .body
            .as_deref()
            .unwrap_or("")
            .lines()
            .filter_map(|line| {
                let text = line.trim().trim_start_matches('-').trim();
                if text.is_empty() || text.len() > 130 || text.contains('<') || text.contains('>') {
                    None
                } else {
                    Some(text.to_string())
                }
            })
            .take(4)
            .collect();
        Ok(AvailableUpdate {
            configured: true,
            available: true,
            version: update.version,
            notes,
        })
    } else {
        Ok(AvailableUpdate {
            configured: true,
            available: false,
            version: String::new(),
            notes: vec![],
        })
    }
}

#[tauri::command]
async fn install_connector_update(
    app: tauri::AppHandle,
    expected_version: String,
) -> Result<(), String> {
    if !updater_enabled() {
        return Err("Signed automatic updates are not enabled for this preview".into());
    }
    if expected_version.len() > 35 || expected_version.is_empty() {
        return Err("Requested version is invalid".into());
    }
    // Recheck directly against the signed Tauri channel at installation time.
    // Never accept a URL, file path, or unverified installer from the frontend.
    let updater = app.updater().map_err(|_| "Update service unavailable")?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Could not verify the selected update")?
        .ok_or("No newer update is available")?;
    if update.version != expected_version {
        return Err("Available version changed; check again before installing".into());
    }
    // Tauri verifies the update's signature and version before running the NSIS
    // installer. On Windows the plugin exits the app after starting installation.
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|_| "Signed update could not be installed".into())
}

fn main() {
    let mut builder = tauri::Builder::default()
        // Only the explicitly bundled Python bridge may be launched by the UI.
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_connector_update,
            install_connector_update
        ]);
    // The preview still starts without updater signing material. Only releases
    // built with the PUBLIC key embedded can discover and verify signed updates.
    if let Some(public_key) = option_env!("YMFX_SIGNALDESK_UPDATE_PUBLIC_KEY") {
        if !public_key.trim().is_empty() {
            builder = builder.plugin(
                tauri_plugin_updater::Builder::new()
                    .pubkey(public_key)
                    .build()
            );
        }
    }
    builder
        .run(tauri::generate_context!())
        .expect("YoungMoney3 Signal Desk desktop initialization failed");
}
