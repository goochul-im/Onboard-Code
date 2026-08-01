#[tauri::command]
fn application_mode() -> &'static str {
    "local-only"
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![application_mode])
        .run(tauri::generate_context!())
        .expect("Tauri application failed to start");
}
