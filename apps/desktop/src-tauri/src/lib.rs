mod analysis;
mod database;
mod impact;
mod indexer;
mod repository;
mod restoration;

use std::{path::PathBuf, sync::Mutex};

use analysis::IndexedSymbol;
use database::{
    AnalysisSummary, CollectionDetail, CollectionItem, CollectionSummary, Database, GraphData,
    NoteRecord, OrphanNote, RepositoryRecord, SourceFile, WorkspaceSnapshot,
    WorkspaceSnapshotRequest,
};
use impact::ChangeImpactReport;
use restoration::{RestorationRequest, RestorationValidation};
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
fn validate_restoration_references(
    request: RestorationRequest,
    state: State<'_, AppState>,
) -> Result<RestorationValidation, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?;
    restoration::validate(&database, request)
}

#[tauri::command]
fn save_workspace_snapshot(
    request: WorkspaceSnapshotRequest,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .save_workspace_snapshot(&request)
        .map_err(|error| format!("작업공간 상태를 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn current_workspace_snapshot(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<Option<WorkspaceSnapshot>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .current_workspace_snapshot(&repository_id)
        .map_err(|error| format!("작업공간 상태를 읽을 수 없습니다: {error}"))
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
fn get_change_impact(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<ChangeImpactReport, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?;
    impact::analyze_change_impact(&database, &repository_id)
}

#[tauri::command]
fn list_collections(
    repository_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionSummary>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .list_collections(&repository_id)
        .map_err(|error| format!("컬렉션 목록을 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn search_collections(
    repository_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionSummary>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .search_collections(&repository_id, &query)
        .map_err(|error| format!("컬렉션을 검색할 수 없습니다: {error}"))
}

#[tauri::command]
fn get_collection(
    repository_id: String,
    collection_id: i64,
    state: State<'_, AppState>,
) -> Result<Option<CollectionDetail>, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .get_collection(&repository_id, collection_id)
        .map_err(|error| format!("컬렉션을 읽을 수 없습니다: {error}"))
}

#[tauri::command]
fn create_collection(
    repository_id: String,
    title: String,
    overview_markdown: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<CollectionDetail, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .create_collection(
            &repository_id,
            &title,
            &overview_markdown,
            &clean_tags(tags),
        )
        .map_err(|error| format!("컬렉션을 만들 수 없습니다: {error}"))
}

#[tauri::command]
fn update_collection(
    repository_id: String,
    collection_id: i64,
    title: String,
    overview_markdown: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<CollectionDetail, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .update_collection(
            &repository_id,
            collection_id,
            &title,
            &overview_markdown,
            &clean_tags(tags),
        )
        .map_err(|error| format!("컬렉션을 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn delete_collection(
    repository_id: String,
    collection_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .delete_collection(&repository_id, collection_id)
        .map_err(|error| format!("컬렉션을 삭제할 수 없습니다: {error}"))
}

#[tauri::command]
fn add_collection_item(
    repository_id: String,
    collection_id: i64,
    symbol_id: String,
    role: String,
    memo: String,
    state: State<'_, AppState>,
) -> Result<CollectionDetail, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .add_collection_item(&repository_id, collection_id, &symbol_id, &role, &memo)
        .map_err(|error| {
            if matches!(error, rusqlite::Error::InvalidQuery) {
                "이미 이 컬렉션에 들어 있는 함수입니다.".to_owned()
            } else {
                format!("컬렉션에 함수를 추가할 수 없습니다: {error}")
            }
        })
}

#[tauri::command]
fn update_collection_item(
    repository_id: String,
    collection_id: i64,
    item_id: i64,
    role: String,
    memo: String,
    state: State<'_, AppState>,
) -> Result<CollectionItem, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .update_collection_item(&repository_id, collection_id, item_id, &role, &memo)
        .map_err(|error| format!("컬렉션 항목을 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn reorder_collection_items(
    repository_id: String,
    collection_id: i64,
    item_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<CollectionDetail, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .reorder_collection_items(&repository_id, collection_id, &item_ids)
        .map_err(|error| format!("컬렉션 순서를 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn remove_collection_item(
    repository_id: String,
    collection_id: i64,
    item_id: i64,
    state: State<'_, AppState>,
) -> Result<CollectionDetail, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .remove_collection_item(&repository_id, collection_id, item_id)
        .map_err(|error| format!("컬렉션 항목을 삭제할 수 없습니다: {error}"))
}

#[tauri::command]
fn mark_collection_item_reviewed(
    repository_id: String,
    collection_id: i64,
    item_id: i64,
    state: State<'_, AppState>,
) -> Result<CollectionItem, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .mark_collection_item_reviewed(&repository_id, collection_id, item_id)
        .map_err(|error| format!("컬렉션 항목 검토 상태를 저장할 수 없습니다: {error}"))
}

#[tauri::command]
fn relink_collection_item(
    repository_id: String,
    collection_id: i64,
    item_id: i64,
    symbol_id: String,
    state: State<'_, AppState>,
) -> Result<CollectionItem, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .relink_collection_item(&repository_id, collection_id, item_id, &symbol_id)
        .map_err(|error| {
            if matches!(error, rusqlite::Error::InvalidQuery) {
                "선택한 함수는 이미 이 컬렉션에 연결되어 있습니다.".to_owned()
            } else {
                format!("컬렉션 항목을 다시 연결할 수 없습니다: {error}")
            }
        })
}

#[tauri::command]
fn get_collection_graph(
    repository_id: String,
    collection_id: i64,
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    state
        .database
        .lock()
        .map_err(|_| "앱 데이터베이스 잠금을 얻을 수 없습니다.".to_owned())?
        .collection_graph(&repository_id, collection_id)
        .map_err(|error| format!("컬렉션 호출 그래프를 읽을 수 없습니다: {error}"))
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

fn clean_tags(tags: Vec<String>) -> Vec<String> {
    tags.into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .take(20)
        .collect()
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
    let source = repository::read_source(
        PathBuf::from(&repository.root_path).as_path(),
        &source_location.0,
    )?;

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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            validate_restoration_references,
            save_workspace_snapshot,
            current_workspace_snapshot,
            search_symbols,
            get_graph,
            get_change_impact,
            list_collections,
            search_collections,
            get_collection,
            create_collection,
            update_collection,
            delete_collection,
            add_collection_item,
            update_collection_item,
            reorder_collection_items,
            remove_collection_item,
            mark_collection_item_reviewed,
            relink_collection_item,
            get_collection_graph,
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
