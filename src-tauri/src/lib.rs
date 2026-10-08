mod auth;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cache.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_cache(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(cache_path(&app).ok()?).ok()
}

#[tauri::command]
fn write_cache(app: AppHandle, json: String) -> Result<(), String> {
    let path = cache_path(&app)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    // Write then rename, so a crash mid-write never leaves a half-written cache.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(auth::AuthState::default())
        .invoke_handler(tauri::generate_handler![
            auth::sign_in,
            auth::get_access_token,
            read_cache,
            write_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running deskpin");
}
