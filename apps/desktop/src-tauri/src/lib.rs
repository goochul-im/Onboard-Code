mod analysis;
mod database;
mod indexer;
mod repository;

use std::{fs, path::PathBuf, sync::Mutex};

use analysis::IndexedSymbol;
use database::{
    AnalysisSummary, Database, GraphData, NoteRecord, OrphanNote, RepositoryRecord, SourceFile,
};
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

#[tauri::command]
fn analyze_repository(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<AnalysisSummary, String> {
    let repository = state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .repository_by_id(&repository_id)
        .map_err(|error| format!("저장소 정보를 읽을 수 없습니다: {error}"))?
        .ok_or_else(|| "등록되지 않은 저장소입니다.".to_owned())?;
    let snapshot = repository::inspect(&repository.root_path)?;
    let analysis = indexer::analyze_repository(&snapshot.root_path)?;

    let mut database = state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?;
    database
        .upsert_repository(&repository_id, &snapshot)
        .map_err(|error| format!("저장소 정보를 갱신할 수 없습니다: {error}"))?;
    database
        .replace_analysis(&repository_id, &snapshot.head, &analysis)
        .map_err(|error| format!("분석 결과를 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn search_symbols(
    repository_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<IndexedSymbol>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .search_symbols(&repository_id, &query)
        .map_err(|error| format!("함수를 검색할 수 없습니다: {error}"))
}

#[tauri::command]
fn get_graph(
    repository_id: String,
    root_symbol_id: String,
    depth: u8,
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .graph_for_symbol(&repository_id, &root_symbol_id, depth)
        .map_err(|error| format!("호출 그래프를 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn list_notes(
    repository_id: String,
    symbol_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<NoteRecord>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .list_notes(&repository_id, &symbol_id)
        .map_err(|error| format!("분석 문서를 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn get_note(
    repository_id: String,
    symbol_id: String,
    state: State<'_, AppState>,
) -> Result<Option<NoteRecord>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .list_notes(&repository_id, &symbol_id)
        .map(|notes| notes.into_iter().next())
        .map_err(|error| format!("분석 문서를 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn create_note(
    repository_id: String,
    symbol_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<NoteRecord, String> {
    let clean_title = clean_note_title(title);
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .create_note(&repository_id, &symbol_id, &clean_title)
        .map_err(|error| format!("분석 문서를 만들 수 없습니다: {error}"))
}

#[tauri::command]
fn update_note(
    repository_id: String,
    symbol_id: String,
    note_id: i64,
    title: String,
    body_markdown: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<NoteRecord, String> {
    let clean_title = clean_note_title(title);
    let clean_tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .take(20)
        .collect::<Vec<_>>();
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .update_note(
            &repository_id,
            &symbol_id,
            note_id,
            &clean_title,
            &body_markdown,
            &clean_tags,
        )
        .map_err(|error| format!("분석 문서를 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn save_note(
    repository_id: String,
    symbol_id: String,
    body_markdown: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<NoteRecord, String> {
    let clean_tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .take(20)
        .collect::<Vec<_>>();
    let mut database = state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?;
    let note = database
        .list_notes(&repository_id, &symbol_id)
        .map_err(|error| format!("분석 문서를 읽을 수 없습니다: {error}"))?
        .into_iter()
        .next();
    let note = match note {
        Some(note) => note,
        None => database
            .create_note(&repository_id, &symbol_id, "기본 분석")
            .map_err(|error| format!("분석 문서를 만들 수 없습니다: {error}"))?,
    };
    database
        .update_note(
            &repository_id,
            &symbol_id,
            note.id,
            &note.title,
            &body_markdown,
            &clean_tags,
        )
        .map_err(|error| format!("분석 문서를 저장할 수 없습니다: {error}"))
}

fn clean_note_title(title: String) -> String {
    let clean = title.trim().chars().take(80).collect::<String>();
    if clean.is_empty() {
        "새 분석".to_owned()
    } else {
        clean
    }
}

#[tauri::command]
fn list_orphan_notes(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<OrphanNote>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .list_orphan_notes(&repository_id)
        .map_err(|error| format!("연결이 끊긴 노트를 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn read_source(
    repository_id: String,
    symbol_id: String,
    state: State<'_, AppState>,
) -> Result<SourceFile, String> {
    let (repository, source_location) = {
        let database = state
            .database
            .lock()
            .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?;
        let repository = database
            .repository_by_id(&repository_id)
            .map_err(|error| format!("저장소 정보를 읽을 수 없습니다: {error}"))?
            .ok_or_else(|| "등록되지 않은 저장소입니다.".to_owned())?;
        let source_location = database
            .source_for_symbol(&repository_id, &symbol_id)
            .map_err(|error| format!("함수 위치를 읽을 수 없습니다: {error}"))?
            .ok_or_else(|| "분석 결과에서 함수를 찾을 수 없습니다.".to_owned())?;
        (repository, source_location)
    };
    let root = PathBuf::from(&repository.root_path)
        .canonicalize()
        .map_err(|error| format!("저장소 경로를 확인할 수 없습니다: {error}"))?;
    let source_path = root
        .join(&source_location.0)
        .canonicalize()
        .map_err(|error| {
            format!("소스 파일이 이동했거나 읽을 수 없습니다. 다시 분석하세요: {error}")
        })?;
    if !source_path.starts_with(&root) {
        return Err("저장소 밖의 파일은 읽을 수 없습니다.".to_owned());
    }
    let source = fs::read_to_string(source_path)
        .map_err(|error| format!("소스 파일을 읽을 수 없습니다: {error}"))?;

    Ok(SourceFile {
        relative_path: source_location.0,
        source,
        start_line: source_location.1,
        end_line: source_location.2,
    })
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
            register_repository,
            analyze_repository,
            search_symbols,
            get_graph,
            list_notes,
            get_note,
            create_note,
            update_note,
            save_note,
            list_orphan_notes,
            read_source
        ])
        .run(tauri::generate_context!())
        .expect("Tauri application failed to start");
}
