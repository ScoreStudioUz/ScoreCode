// ScoreCode — Tauri backend
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![create_folder])
        .run(tauri::generate_context!())
        .expect("ScoreCode ishga tushmadi");
}
