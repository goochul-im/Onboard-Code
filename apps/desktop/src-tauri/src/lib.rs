mod database;
mod repository;

use std::{path::PathBuf, sync::Mutex};

use database::{Database, RepositoryRecord};
use tauri::{Manager, State};

pub struct AppState {
    database: Mutex<Database>,
}

impl AppState {
    fn new(database: Database) -> Self {
        Self {
            database: Mutex::new(database),
        }
    }
}

#[tauri::command]
fn application_mode() -> &'static str {
    "local-only"
}

#[tauri::command]
fn list_repositories(state: State<'_, AppState>) -> Result<Vec<RepositoryRecord>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .list_repositories()
        .map_err(|error| format!("저장소 목록을 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn register_repository(
    path: String,
    state: State<'_, AppState>,
) -> Result<RepositoryRecord, String> {
    let snapshot = repository::inspect(&path)?;
    let identifier = repository::stable_repository_id(&snapshot.root_path);

    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .upsert_repository(&identifier, &snapshot)
        .map_err(|error| format!("저장소 정보를 저장할 수 없습니다: {error}"))
}

fn database_path(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?.join("data");
    Ok(directory.join("code-graph-notebook.sqlite3"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = Database::open(&database_path(app)?)?;
            app.manage(AppState::new(database));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            application_mode,
            list_repositories,
            register_repository
        ])
        .run(tauri::generate_context!())
        .expect("Tauri application failed to start");
}
