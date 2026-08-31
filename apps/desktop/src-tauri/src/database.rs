use std::{collections::HashSet, fs, path::Path};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{
    analysis::{EdgeConfidence, IndexedEdge, IndexedSymbol},
    indexer::RepositoryAnalysis,
    repository::RepositorySnapshot,
};

pub struct Database {
    connection: Connection,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRecord {
    pub id: String,
    pub root_path: String,
    pub display_name: String,
    pub branch: String,
    pub head: String,
    pub is_dirty: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSummary {
    pub repository_id: String,
    pub source_file_count: usize,
    pub symbol_count: usize,
    pub edge_count: usize,
    pub diagnostic_count: usize,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphData {
    pub nodes: Vec<IndexedSymbol>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: i64,
    pub source: String,
    pub target: Option<String>,
    pub unresolved_name: Option<String>,
    pub confidence: String,
    pub source_line: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: i64,
    pub symbol_id: String,
    pub title: String,
    pub body_markdown: String,
    pub tags: Vec<String>,
    pub updated_at: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanNote {
    pub id: i64,
    pub title: String,
    pub symbol_fqn: String,
    pub symbol_signature: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub relative_path: String,
    pub source: String,
    pub start_line: u32,
    pub end_line: u32,
}

pub const WORKSPACE_SNAPSHOT_SCHEMA_VERSION: i64 = 1;
pub const WORKSPACE_DATABASE_FORMAT_VERSION: i64 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotRequest {
    pub schema_version: i64,
    pub app_version: String,
    pub database_format_version: i64,
    pub repository_id: String,
    pub state_json: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub snapshot_id: i64,
    pub schema_version: i64,
    pub app_version: String,
    pub database_format_version: i64,
    pub repository_id: String,
    pub state_json: String,
    pub status: String,
    pub created_at: String,
}

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }

        let mut connection = Connection::open(path)?;
        connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS repositories (
              id TEXT PRIMARY KEY NOT NULL,
              root_path TEXT UNIQUE NOT NULL,
              display_name TEXT NOT NULL,
              branch TEXT NOT NULL,
              head TEXT NOT NULL,
              is_dirty INTEGER NOT NULL CHECK (is_dirty IN (0, 1)),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS analysis_runs (
              id INTEGER PRIMARY KEY,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              revision TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
              started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              completed_at TEXT,
              diagnostics_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS symbols (
              id TEXT PRIMARY KEY NOT NULL,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              language TEXT NOT NULL CHECK (language IN ('java', 'php', 'python', 'typescript')),
              kind TEXT NOT NULL,
              fqn TEXT NOT NULL,
              signature TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL,
              ast_fingerprint TEXT NOT NULL,
              UNIQUE(repository_id, language, fqn, signature, relative_path)
            );

            CREATE TABLE IF NOT EXISTS call_edges (
              id INTEGER PRIMARY KEY,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              caller_symbol_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
              callee_symbol_id TEXT REFERENCES symbols(id) ON DELETE SET NULL,
              unresolved_name TEXT,
              confidence TEXT NOT NULL CHECK (confidence IN ('resolved', 'ambiguous', 'unresolved')),
              source_line INTEGER NOT NULL,
              CHECK (callee_symbol_id IS NOT NULL OR unresolved_name IS NOT NULL)
            );

            CREATE TABLE IF NOT EXISTS notes (
              id INTEGER PRIMARY KEY,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              symbol_id TEXT NOT NULL,
              symbol_fqn TEXT NOT NULL DEFAULT '',
              symbol_signature TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL DEFAULT '기본 분석',
              body_markdown TEXT NOT NULL DEFAULT '',
              tags_json TEXT NOT NULL DEFAULT '[]',
              status TEXT NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'orphan')),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS notes_symbol_lookup
              ON notes(repository_id, symbol_id, status, updated_at DESC);

            CREATE TABLE IF NOT EXISTS graph_preferences (
              repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
              layout_json TEXT NOT NULL DEFAULT '{}',
              filters_json TEXT NOT NULL DEFAULT '{}',
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS workspace_snapshots (
              snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
              schema_version INTEGER NOT NULL,
              app_version TEXT NOT NULL,
              database_format_version INTEGER NOT NULL,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              state_json TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'current', 'previous_valid')),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshot_one_current
              ON workspace_snapshots(repository_id) WHERE status = 'current';
            CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshot_one_previous_valid
              ON workspace_snapshots(repository_id) WHERE status = 'previous_valid';

            CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
              repository_id UNINDEXED,
              entity_type UNINDEXED,
              entity_id UNINDEXED,
              title,
              content
            );
            "#,
        )?;
        ensure_symbols_language_schema(&mut connection)?;
        ensure_notes_schema(&mut connection)?;

        Ok(Self { connection })
    }

    pub fn upsert_repository(
        &self,
        id: &str,
        snapshot: &RepositorySnapshot,
    ) -> rusqlite::Result<RepositoryRecord> {
        self.connection.execute(
            r#"
            INSERT INTO repositories (id, root_path, display_name, branch, head, is_dirty)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(root_path) DO UPDATE SET
              display_name = excluded.display_name,
              branch = excluded.branch,
              head = excluded.head,
              is_dirty = excluded.is_dirty,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                id,
                snapshot.root_path,
                snapshot.display_name,
                snapshot.branch,
                snapshot.head,
                snapshot.is_dirty,
            ],
        )?;

        self.repository_by_path(&snapshot.root_path)
            .map(|record| record.expect("upserted repository must exist"))
    }

    pub fn list_repositories(&self) -> rusqlite::Result<Vec<RepositoryRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, root_path, display_name, branch, head, is_dirty, created_at, updated_at
            FROM repositories
            ORDER BY updated_at DESC, display_name COLLATE NOCASE
            "#,
        )?;
        let records = statement
            .query_map([], row_to_repository)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(records)
    }

    pub fn repository_by_id(&self, id: &str) -> rusqlite::Result<Option<RepositoryRecord>> {
        self.connection
            .query_row(
                r#"
                SELECT id, root_path, display_name, branch, head, is_dirty, created_at, updated_at
                FROM repositories
                WHERE id = ?1
                "#,
                [id],
                row_to_repository,
            )
            .optional()
    }

    pub fn replace_analysis(
        &mut self,
        repository_id: &str,
        revision: &str,
        analysis: &RepositoryAnalysis,
    ) -> rusqlite::Result<AnalysisSummary> {
        let status = if analysis.diagnostics.is_empty() {
            "completed"
        } else {
            "partial"
        };
        let diagnostics = serde_json::to_string(&analysis.diagnostics)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO analysis_runs (repository_id, revision, status, diagnostics_json)
            VALUES (?1, ?2, 'running', '[]')
            "#,
            params![repository_id, revision],
        )?;
        let analysis_run_id = transaction.last_insert_rowid();

        transaction.execute(
            "DELETE FROM call_edges WHERE repository_id = ?1",
            [repository_id],
        )?;
        transaction.execute(
            "DELETE FROM symbols WHERE repository_id = ?1",
            [repository_id],
        )?;
        transaction.execute(
            "DELETE FROM search_index WHERE repository_id = ?1 AND entity_type = 'symbol'",
            [repository_id],
        )?;

        for symbol in &analysis.symbols {
            insert_symbol(&transaction, repository_id, symbol)?;
        }
        for edge in &analysis.edges {
            insert_edge(&transaction, repository_id, edge)?;
        }
        transaction.execute(
            r#"
            UPDATE notes
            SET status = 'orphan'
            WHERE repository_id = ?1
              AND NOT EXISTS (
                SELECT 1 FROM symbols
                WHERE symbols.repository_id = notes.repository_id
                  AND symbols.id = notes.symbol_id
              )
            "#,
            [repository_id],
        )?;
        transaction.execute(
            r#"
            UPDATE notes
            SET symbol_id = (
                  SELECT id FROM symbols
                  WHERE symbols.repository_id = notes.repository_id
                    AND symbols.fqn = notes.symbol_fqn
                    AND symbols.signature = notes.symbol_signature
                  LIMIT 1
                ),
                status = 'linked'
            WHERE repository_id = ?1
              AND status = 'orphan'
              AND EXISTS (
                SELECT 1 FROM symbols
                WHERE symbols.repository_id = notes.repository_id
                  AND symbols.fqn = notes.symbol_fqn
                  AND symbols.signature = notes.symbol_signature
              )
            "#,
            [repository_id],
        )?;
        transaction.execute(
            r#"
            UPDATE analysis_runs
            SET status = ?1, completed_at = CURRENT_TIMESTAMP, diagnostics_json = ?2
            WHERE id = ?3
            "#,
            params![status, diagnostics, analysis_run_id],
        )?;
        transaction.commit()?;

        Ok(AnalysisSummary {
            repository_id: repository_id.into(),
            source_file_count: analysis.source_file_count,
            symbol_count: analysis.symbols.len(),
            edge_count: analysis.edges.len(),
            diagnostic_count: analysis.diagnostics.len(),
            status: status.into(),
        })
    }

    pub fn search_symbols(
        &self,
        repository_id: &str,
        query: &str,
    ) -> rusqlite::Result<Vec<IndexedSymbol>> {
        let normalized_query = query.trim();
        if normalized_query.is_empty() {
            let mut statement = self.connection.prepare(
                r#"
                SELECT id, language, kind, fqn, signature, relative_path, start_line, end_line, ast_fingerprint
                FROM symbols
                WHERE repository_id = ?1
                ORDER BY fqn COLLATE NOCASE
                "#,
            )?;
            return statement
                .query_map([repository_id], row_to_symbol)?
                .collect::<rusqlite::Result<Vec<_>>>();
        }

        let terms = normalized_query
            .split(|character: char| !character.is_alphanumeric() && character != '_')
            .filter(|term| !term.is_empty())
            .map(|term| format!("{term}*"))
            .collect::<Vec<_>>()
            .join(" AND ");
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = self.connection.prepare(
            r#"
            SELECT symbols.id, symbols.language, symbols.kind, symbols.fqn, symbols.signature,
                   symbols.relative_path, symbols.start_line, symbols.end_line, symbols.ast_fingerprint
            FROM search_index
            JOIN symbols ON symbols.id = search_index.entity_id
            WHERE search_index.repository_id = ?1
              AND search_index.entity_type = 'symbol'
              AND search_index MATCH ?2
            ORDER BY rank
            LIMIT 80
            "#,
        )?;
        let results = statement
            .query_map(params![repository_id, terms], row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>();
        results
    }

    pub fn graph_for_symbol(
        &self,
        repository_id: &str,
        root_symbol_id: &str,
        depth: u8,
    ) -> rusqlite::Result<GraphData> {
        let maximum_depth = depth.clamp(1, 3);
        let all_edges = self.all_graph_edges(repository_id)?;
        let mut included_symbol_ids = HashSet::from([root_symbol_id.to_owned()]);
        let mut frontier = included_symbol_ids.clone();
        let mut included_edges = Vec::new();

        for _ in 0..maximum_depth {
            let mut next_frontier = HashSet::new();
            for edge in &all_edges {
                let touches_frontier = frontier.contains(&edge.source)
                    || edge
                        .target
                        .as_ref()
                        .is_some_and(|target| frontier.contains(target));
                if !touches_frontier {
                    continue;
                }
                if !included_edges
                    .iter()
                    .any(|included: &GraphEdge| included.id == edge.id)
                {
                    included_edges.push(edge.clone());
                }
                if included_symbol_ids.insert(edge.source.clone()) {
                    next_frontier.insert(edge.source.clone());
                }
                if let Some(target) = &edge.target {
                    if included_symbol_ids.insert(target.clone()) {
                        next_frontier.insert(target.clone());
                    }
                }
            }
            if next_frontier.is_empty() {
                break;
            }
            frontier = next_frontier;
        }

        let nodes = self.symbols_by_ids(repository_id, &included_symbol_ids)?;
        Ok(GraphData {
            nodes,
            edges: included_edges,
        })
    }

    pub fn list_notes(
        &self,
        repository_id: &str,
        symbol_id: &str,
    ) -> rusqlite::Result<Vec<NoteRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, symbol_id, title, body_markdown, tags_json, updated_at, status
            FROM notes
            WHERE repository_id = ?1 AND symbol_id = ?2 AND status = 'linked'
            ORDER BY updated_at DESC, id DESC
            "#,
        )?;
        let notes = statement
            .query_map(params![repository_id, symbol_id], row_to_note)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(notes)
    }

    pub fn create_note(
        &mut self,
        repository_id: &str,
        symbol_id: &str,
        title: &str,
    ) -> rusqlite::Result<NoteRecord> {
        let symbol = self
            .symbol_by_id(repository_id, symbol_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO notes (
              repository_id, symbol_id, symbol_fqn, symbol_signature, title, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'linked')
            "#,
            params![
                repository_id,
                symbol_id,
                symbol.fqn,
                symbol.signature,
                title
            ],
        )?;
        let note_id = transaction.last_insert_rowid();
        transaction.execute(
            r#"
            INSERT INTO search_index (repository_id, entity_type, entity_id, title, content)
            VALUES (?1, 'note', CAST(?2 AS TEXT), ?3, '')
            "#,
            params![repository_id, note_id, format!("{} {title}", symbol.fqn)],
        )?;
        transaction.commit()?;

        self.load_note_by_id(repository_id, note_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_note(
        &mut self,
        repository_id: &str,
        symbol_id: &str,
        note_id: i64,
        title: &str,
        body_markdown: &str,
        tags: &[String],
    ) -> rusqlite::Result<NoteRecord> {
        let tags_json = serde_json::to_string(tags)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let symbol = self
            .symbol_by_id(repository_id, symbol_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            r#"
            UPDATE notes
            SET symbol_fqn = ?1,
                symbol_signature = ?2,
                title = ?3,
                body_markdown = ?4,
                tags_json = ?5,
                status = 'linked',
                updated_at = CURRENT_TIMESTAMP
            WHERE repository_id = ?6 AND symbol_id = ?7 AND id = ?8
            "#,
            params![
                symbol.fqn,
                symbol.signature,
                title,
                body_markdown,
                tags_json,
                repository_id,
                symbol_id,
                note_id,
            ],
        )?;
        if changed != 1 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        transaction.execute(
            "DELETE FROM search_index WHERE repository_id = ?1 AND entity_type = 'note' AND entity_id = CAST(?2 AS TEXT)",
            params![repository_id, note_id],
        )?;
        transaction.execute(
            r#"
            INSERT INTO search_index (repository_id, entity_type, entity_id, title, content)
            VALUES (?1, 'note', CAST(?2 AS TEXT), ?3, ?4)
            "#,
            params![
                repository_id,
                note_id,
                format!("{} {title}", symbol.fqn),
                body_markdown
            ],
        )?;
        transaction.commit()?;

        self.load_note_by_id(repository_id, note_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    fn load_note_by_id(
        &self,
        repository_id: &str,
        note_id: i64,
    ) -> rusqlite::Result<Option<NoteRecord>> {
        self.connection
            .query_row(
                r#"
                SELECT id, symbol_id, title, body_markdown, tags_json, updated_at, status
                FROM notes
                WHERE repository_id = ?1 AND id = ?2
                "#,
                params![repository_id, note_id],
                row_to_note,
            )
            .optional()
    }

    pub fn list_orphan_notes(&self, repository_id: &str) -> rusqlite::Result<Vec<OrphanNote>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, title, symbol_fqn, symbol_signature, updated_at
            FROM notes
            WHERE repository_id = ?1 AND status = 'orphan'
            ORDER BY updated_at DESC
            "#,
        )?;
        let results = statement
            .query_map([repository_id], |row| {
                Ok(OrphanNote {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    symbol_fqn: row.get(2)?,
                    symbol_signature: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>();
        results
    }

    pub fn source_for_symbol(
        &self,
        repository_id: &str,
        symbol_id: &str,
    ) -> rusqlite::Result<Option<(String, u32, u32)>> {
        self.connection
            .query_row(
                r#"
                SELECT relative_path, start_line, end_line
                FROM symbols
                WHERE repository_id = ?1 AND id = ?2
                "#,
                params![repository_id, symbol_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
    }

    pub fn save_workspace_snapshot(
        &mut self,
        request: &WorkspaceSnapshotRequest,
    ) -> rusqlite::Result<WorkspaceSnapshot> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO workspace_snapshots (
              schema_version, app_version, database_format_version, repository_id, state_json, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending')
            "#,
            params![
                request.schema_version,
                request.app_version,
                request.database_format_version,
                request.repository_id,
                request.state_json,
            ],
        )?;
        let snapshot_id = transaction.last_insert_rowid();

        validate_workspace_snapshot(&transaction, request)?;

        transaction.execute(
            "DELETE FROM workspace_snapshots WHERE repository_id = ?1 AND status = 'previous_valid'",
            [&request.repository_id],
        )?;
        transaction.execute(
            "UPDATE workspace_snapshots SET status = 'previous_valid' WHERE repository_id = ?1 AND status = 'current'",
            [&request.repository_id],
        )?;
        transaction.execute(
            "UPDATE workspace_snapshots SET status = 'current' WHERE snapshot_id = ?1 AND status = 'pending'",
            [snapshot_id],
        )?;
        let snapshot = workspace_snapshot_by_id(&transaction, snapshot_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn current_workspace_snapshot(
        &self,
        repository_id: &str,
    ) -> rusqlite::Result<Option<WorkspaceSnapshot>> {
        self.connection
            .query_row(
                r#"
                SELECT snapshot_id, schema_version, app_version, database_format_version,
                       repository_id, state_json, status, created_at
                FROM workspace_snapshots
                WHERE repository_id = ?1 AND status = 'current'
                "#,
                [repository_id],
                row_to_workspace_snapshot,
            )
            .optional()
    }

    pub fn has_committed_analysis_for_revision(
        &self,
        repository_id: &str,
        revision: &str,
    ) -> rusqlite::Result<bool> {
        self.connection.query_row(
            r#"
            SELECT COALESCE((
              SELECT revision = ?2
              FROM analysis_runs
              WHERE repository_id = ?1
                AND status IN ('completed', 'partial')
                AND completed_at IS NOT NULL
              ORDER BY id DESC
              LIMIT 1
            ), 0)
            "#,
            params![repository_id, revision],
            |row| row.get(0),
        )
    }

    pub fn symbol_matches_reference(
        &self,
        repository_id: &str,
        fqn: &str,
        signature: &str,
        relative_path: &str,
        start_line: u32,
        end_line: u32,
    ) -> rusqlite::Result<bool> {
        self.connection.query_row(
            r#"
            SELECT EXISTS(
              SELECT 1
              FROM symbols
              WHERE repository_id = ?1
                AND fqn = ?2
                AND signature = ?3
                AND relative_path = ?4
                AND start_line = ?5
                AND end_line = ?6
            )
            "#,
            params![
                repository_id,
                fqn,
                signature,
                relative_path,
                start_line,
                end_line,
            ],
            |row| row.get(0),
        )
    }

    fn repository_by_path(&self, root_path: &str) -> rusqlite::Result<Option<RepositoryRecord>> {
        self.connection
            .query_row(
                r#"
                SELECT id, root_path, display_name, branch, head, is_dirty, created_at, updated_at
                FROM repositories
                WHERE root_path = ?1
                "#,
                [root_path],
                row_to_repository,
            )
            .optional()
    }

    fn symbol_by_id(
        &self,
        repository_id: &str,
        symbol_id: &str,
    ) -> rusqlite::Result<Option<IndexedSymbol>> {
        self.connection
            .query_row(
                r#"
                SELECT id, language, kind, fqn, signature, relative_path, start_line, end_line, ast_fingerprint
                FROM symbols
                WHERE repository_id = ?1 AND id = ?2
                "#,
                params![repository_id, symbol_id],
                row_to_symbol,
            )
            .optional()
    }

    fn all_graph_edges(&self, repository_id: &str) -> rusqlite::Result<Vec<GraphEdge>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, caller_symbol_id, callee_symbol_id, unresolved_name, confidence, source_line
            FROM call_edges
            WHERE repository_id = ?1
            "#,
        )?;
        let results = statement
            .query_map([repository_id], |row| {
                Ok(GraphEdge {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    target: row.get(2)?,
                    unresolved_name: row.get(3)?,
                    confidence: row.get(4)?,
                    source_line: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>();
        results
    }

    fn symbols_by_ids(
        &self,
        repository_id: &str,
        symbol_ids: &HashSet<String>,
    ) -> rusqlite::Result<Vec<IndexedSymbol>> {
        if symbol_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat_n("?", symbol_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT id, language, kind, fqn, signature, relative_path, start_line, end_line, ast_fingerprint
            FROM symbols
            WHERE repository_id = ? AND id IN ({placeholders})
            ORDER BY fqn COLLATE NOCASE
            "#,
        );
        let mut values = vec![repository_id.to_owned()];
        values.extend(symbol_ids.iter().cloned());
        let mut statement = self.connection.prepare(&sql)?;
        let results = statement
            .query_map(rusqlite::params_from_iter(values), row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>();
        results
    }
}

fn validate_workspace_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    request: &WorkspaceSnapshotRequest,
) -> rusqlite::Result<()> {
    let supported_versions = request.schema_version == WORKSPACE_SNAPSHOT_SCHEMA_VERSION
        && request.database_format_version == WORKSPACE_DATABASE_FORMAT_VERSION;
    let valid_json_object = serde_json::from_str::<serde_json::Value>(&request.state_json)
        .ok()
        .is_some_and(|value| value.is_object());
    let repository_exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM repositories WHERE id = ?1)",
        [&request.repository_id],
        |row| row.get::<_, bool>(0),
    )?;
    if supported_versions
        && !request.app_version.trim().is_empty()
        && !request.repository_id.trim().is_empty()
        && valid_json_object
        && repository_exists
    {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}

fn workspace_snapshot_by_id(
    transaction: &rusqlite::Transaction<'_>,
    snapshot_id: i64,
) -> rusqlite::Result<Option<WorkspaceSnapshot>> {
    transaction
        .query_row(
            r#"
            SELECT snapshot_id, schema_version, app_version, database_format_version,
                   repository_id, state_json, status, created_at
            FROM workspace_snapshots
            WHERE snapshot_id = ?1
            "#,
            [snapshot_id],
            row_to_workspace_snapshot,
        )
        .optional()
}

fn insert_symbol(
    transaction: &rusqlite::Transaction<'_>,
    repository_id: &str,
    symbol: &IndexedSymbol,
) -> rusqlite::Result<()> {
    transaction.execute(
        r#"
        INSERT INTO symbols (
          id, repository_id, language, kind, fqn, signature, relative_path,
          start_line, end_line, ast_fingerprint
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            symbol.id,
            repository_id,
            symbol.language.as_str(),
            symbol.kind,
            symbol.fqn,
            symbol.signature,
            symbol.relative_path,
            symbol.start_line,
            symbol.end_line,
            symbol.ast_fingerprint,
        ],
    )?;
    transaction.execute(
        r#"
        INSERT INTO search_index (repository_id, entity_type, entity_id, title, content)
        VALUES (?1, 'symbol', ?2, ?3, ?4)
        "#,
        params![
            repository_id,
            symbol.id,
            symbol.fqn,
            format!("{} {}", symbol.signature, symbol.relative_path),
        ],
    )?;

    Ok(())
}

fn insert_edge(
    transaction: &rusqlite::Transaction<'_>,
    repository_id: &str,
    edge: &IndexedEdge,
) -> rusqlite::Result<()> {
    transaction.execute(
        r#"
        INSERT INTO call_edges (
          repository_id, caller_symbol_id, callee_symbol_id, unresolved_name, confidence, source_line
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            repository_id,
            edge.caller_symbol_id,
            edge.callee_symbol_id,
            edge.unresolved_name,
            confidence_label(&edge.confidence),
            edge.source_line,
        ],
    )?;
    Ok(())
}

fn confidence_label(confidence: &EdgeConfidence) -> &'static str {
    confidence.as_str()
}

fn row_to_repository(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepositoryRecord> {
    Ok(RepositoryRecord {
        id: row.get(0)?,
        root_path: row.get(1)?,
        display_name: row.get(2)?,
        branch: row.get(3)?,
        head: row.get(4)?,
        is_dirty: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedSymbol> {
    let language = match row.get::<_, String>(1)?.as_str() {
        "java" => crate::analysis::SourceLanguage::Java,
        "php" => crate::analysis::SourceLanguage::Php,
        "python" => crate::analysis::SourceLanguage::Python,
        "typescript" => crate::analysis::SourceLanguage::TypeScript,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(IndexedSymbol {
        id: row.get(0)?,
        language,
        kind: row.get(2)?,
        fqn: row.get(3)?,
        signature: row.get(4)?,
        relative_path: row.get(5)?,
        start_line: row.get(6)?,
        end_line: row.get(7)?,
        ast_fingerprint: row.get(8)?,
    })
}

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRecord> {
    let tags_json: String = row.get(4)?;
    let tags = serde_json::from_str(&tags_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(NoteRecord {
        id: row.get(0)?,
        symbol_id: row.get(1)?,
        title: row.get(2)?,
        body_markdown: row.get(3)?,
        tags,
        updated_at: row.get(5)?,
        status: row.get(6)?,
    })
}

fn row_to_workspace_snapshot(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSnapshot> {
    Ok(WorkspaceSnapshot {
        snapshot_id: row.get(0)?,
        schema_version: row.get(1)?,
        app_version: row.get(2)?,
        database_format_version: row.get(3)?,
        repository_id: row.get(4)?,
        state_json: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn ensure_symbols_language_schema(connection: &mut Connection) -> rusqlite::Result<()> {
    let table_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'symbols'",
        [],
        |row| row.get(0),
    )?;
    let normalized_sql = table_sql.to_lowercase();
    if normalized_sql.contains("'typescript'") && normalized_sql.contains("'php'") {
        return Ok(());
    }

    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let migration = (|| -> rusqlite::Result<()> {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
            CREATE TABLE symbols_v2 (
              id TEXT PRIMARY KEY NOT NULL,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              language TEXT NOT NULL CHECK (language IN ('java', 'php', 'python', 'typescript')),
              kind TEXT NOT NULL,
              fqn TEXT NOT NULL,
              signature TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL,
              ast_fingerprint TEXT NOT NULL,
              UNIQUE(repository_id, language, fqn, signature, relative_path)
            );

            INSERT INTO symbols_v2 (
              id, repository_id, language, kind, fqn, signature, relative_path,
              start_line, end_line, ast_fingerprint
            )
            SELECT id, repository_id, language, kind, fqn, signature, relative_path,
                   start_line, end_line, ast_fingerprint
            FROM symbols;

            DROP TABLE symbols;
            ALTER TABLE symbols_v2 RENAME TO symbols;
            "#,
        )?;
        transaction.commit()
    })();
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    migration?;

    let has_violation = connection
        .query_row("PRAGMA foreign_key_check", [], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if has_violation {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

fn ensure_notes_schema(connection: &mut Connection) -> rusqlite::Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(notes)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?;
    drop(statement);
    if !columns.contains("symbol_fqn") {
        connection.execute(
            "ALTER TABLE notes ADD COLUMN symbol_fqn TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !columns.contains("symbol_signature") {
        connection.execute(
            "ALTER TABLE notes ADD COLUMN symbol_signature TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !columns.contains("status") {
        connection.execute(
            "ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'linked'",
            [],
        )?;
    }
    connection.execute_batch(
        r#"
        UPDATE notes
        SET symbol_fqn = COALESCE(NULLIF(symbol_fqn, ''), (
              SELECT fqn FROM symbols WHERE symbols.id = notes.symbol_id
            ), 'unknown'),
            symbol_signature = COALESCE(NULLIF(symbol_signature, ''), (
              SELECT signature FROM symbols WHERE symbols.id = notes.symbol_id
            ), '');
        "#,
    )?;

    let table_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
        [],
        |row| row.get(0),
    )?;
    let normalized_sql = table_sql
        .split_whitespace()
        .collect::<String>()
        .to_lowercase();
    let requires_rebuild =
        !columns.contains("title") || normalized_sql.contains("unique(repository_id,symbol_id)");
    if requires_rebuild {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
            CREATE TABLE notes_v2 (
              id INTEGER PRIMARY KEY,
              repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
              symbol_id TEXT NOT NULL,
              symbol_fqn TEXT NOT NULL DEFAULT '',
              symbol_signature TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL DEFAULT '기본 분석',
              body_markdown TEXT NOT NULL DEFAULT '',
              tags_json TEXT NOT NULL DEFAULT '[]',
              status TEXT NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'orphan')),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO notes_v2 (
              id, repository_id, symbol_id, symbol_fqn, symbol_signature, title,
              body_markdown, tags_json, status, created_at, updated_at
            )
            SELECT id, repository_id, symbol_id, symbol_fqn, symbol_signature, '기본 분석',
                   body_markdown, tags_json, status, created_at, updated_at
            FROM notes;

            DELETE FROM search_index WHERE entity_type = 'note';
            DROP TABLE notes;
            ALTER TABLE notes_v2 RENAME TO notes;
            CREATE INDEX notes_symbol_lookup
              ON notes(repository_id, symbol_id, status, updated_at DESC);

            INSERT INTO search_index (repository_id, entity_type, entity_id, title, content)
            SELECT repository_id, 'note', CAST(id AS TEXT), symbol_fqn || ' ' || title, body_markdown
            FROM notes;
            "#,
        )?;
        transaction.commit()?;
    } else {
        connection.execute(
            r#"
            CREATE INDEX IF NOT EXISTS notes_symbol_lookup
              ON notes(repository_id, symbol_id, status, updated_at DESC)
            "#,
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{
        analysis::{analyze_file, resolve_calls, SourceLanguage},
        indexer::RepositoryAnalysis,
    };

    use super::*;

    static NEXT_TEMP_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn temporary_database_path(test_name: &str) -> std::path::PathBuf {
        let safe_test_name = test_name
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let sequence = NEXT_TEMP_DATABASE_ID.fetch_add(1, Ordering::Relaxed);
        env::temp_dir().join(format!(
            "code-graph-notebook-{safe_test_name}-{}-{timestamp}-{sequence}.sqlite3",
            std::process::id(),
        ))
    }

    #[test]
    fn temporary_database_paths_are_windows_safe_and_unique() {
        let first = temporary_database_path("database::tests\\windows?fixture*");
        let second = temporary_database_path("database::tests\\windows?fixture*");
        let filename = first
            .file_name()
            .and_then(|name| name.to_str())
            .expect("UTF-8 temporary filename");

        assert_ne!(first, second);
        assert!(!filename.chars().any(|character| matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )));
        assert!(filename.ends_with(".sqlite3"));
    }

    fn registered_database(test_name: &str) -> (std::path::PathBuf, Database) {
        let path = temporary_database_path(test_name);
        let database = Database::open(&path).expect("database opens");
        database
            .upsert_repository(
                "repo_workspace",
                &RepositorySnapshot {
                    root_path: format!("/tmp/{test_name}"),
                    display_name: test_name.into(),
                    branch: "main".into(),
                    head: "abc123".into(),
                    is_dirty: false,
                },
            )
            .expect("repository inserts");
        (path, database)
    }

    fn workspace_request(state_json: &str) -> WorkspaceSnapshotRequest {
        WorkspaceSnapshotRequest {
            schema_version: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
            app_version: "0.1.0".into(),
            database_format_version: WORKSPACE_DATABASE_FORMAT_VERSION,
            repository_id: "repo_workspace".into(),
            state_json: state_json.into(),
        }
    }

    #[test]
    fn workspace_snapshot_save_is_atomic_and_keeps_the_preceding_valid_snapshot() {
        let (path, mut database) = registered_database("workspace-snapshot-atomic");
        let first = database
            .save_workspace_snapshot(&workspace_request(r#"{"activeWorkspace":"find"}"#))
            .expect("first snapshot saves");
        let second = database
            .save_workspace_snapshot(&workspace_request(r#"{"activeWorkspace":"record"}"#))
            .expect("second snapshot saves");

        assert!(second.snapshot_id > first.snapshot_id);
        assert_eq!(second.status, "current");
        assert!(!second.created_at.is_empty());
        let states = database
            .connection
            .prepare(
                "SELECT snapshot_id, status FROM workspace_snapshots WHERE repository_id = 'repo_workspace' ORDER BY snapshot_id",
            )
            .expect("snapshot query prepares")
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .expect("snapshots query")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("snapshot rows load");
        assert_eq!(
            states,
            vec![
                (first.snapshot_id, "previous_valid".into()),
                (second.snapshot_id, "current".into())
            ]
        );

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn workspace_snapshot_failed_save_leaves_current_readable_and_retry_is_idempotent() {
        let (path, mut database) = registered_database("workspace-snapshot-interruption");
        let saved = database
            .save_workspace_snapshot(&workspace_request(r#"{"activeWorkspace":"understand"}"#))
            .expect("valid snapshot saves");
        {
            let transaction = database
                .connection
                .transaction()
                .expect("interrupted transaction starts");
            transaction
                .execute(
                    r#"
                    INSERT INTO workspace_snapshots (
                      schema_version, app_version, database_format_version, repository_id, state_json, status
                    ) VALUES (1, '0.1.0', 1, 'repo_workspace', '{"activeWorkspace":"record"}', 'pending')
                    "#,
                    [],
                )
                .expect("pending snapshot inserts before interruption");
            let pending_snapshot_id = transaction.last_insert_rowid();
            transaction
                .execute(
                    "UPDATE workspace_snapshots SET status = 'previous_valid' WHERE repository_id = ?1 AND status = 'current'",
                    ["repo_workspace"],
                )
                .expect("current snapshot demotes before interruption");
            transaction
                .execute(
                    "UPDATE workspace_snapshots SET status = 'current' WHERE snapshot_id = ?1 AND status = 'pending'",
                    [pending_snapshot_id],
                )
                .expect("pending snapshot promotes before interruption");
            // Dropping the uncommitted transaction models interruption after promotion but before commit.
        }
        assert_eq!(
            database
                .current_workspace_snapshot("repo_workspace")
                .expect("current snapshot reads after interruption")
                .expect("current snapshot remains after interruption"),
            saved
        );
        let invalid = WorkspaceSnapshotRequest {
            app_version: " ".into(),
            ..workspace_request(r#"{"activeWorkspace":"record"}"#)
        };

        assert!(database.save_workspace_snapshot(&invalid).is_err());
        assert_eq!(
            database
                .current_workspace_snapshot("repo_workspace")
                .expect("current snapshot reads")
                .expect("current snapshot exists"),
            saved
        );
        assert!(database.save_workspace_snapshot(&invalid).is_err());
        let snapshot_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM workspace_snapshots", [], |row| {
                row.get(0)
            })
            .expect("snapshot count reads");
        assert_eq!(
            snapshot_count, 1,
            "failed retries must roll back pending rows"
        );

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn workspace_snapshot_rejects_unknown_repository_without_changing_current() {
        let (path, mut database) = registered_database("workspace-snapshot-reference");
        let saved = database
            .save_workspace_snapshot(&workspace_request(r#"{"activeWorkspace":"find"}"#))
            .expect("valid snapshot saves");
        let unknown_repository = WorkspaceSnapshotRequest {
            repository_id: "missing_repository".into(),
            ..workspace_request(r#"{"activeWorkspace":"record"}"#)
        };

        assert!(database
            .save_workspace_snapshot(&unknown_repository)
            .is_err());
        assert_eq!(
            database
                .current_workspace_snapshot("repo_workspace")
                .expect("current snapshot reads")
                .expect("current snapshot remains"),
            saved
        );

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn persists_and_updates_a_registered_repository() {
        let path = temporary_database_path("repository");
        let database = Database::open(&path).expect("database opens");
        let first = RepositorySnapshot {
            root_path: "/tmp/example".into(),
            display_name: "example".into(),
            branch: "main".into(),
            head: "abc123".into(),
            is_dirty: false,
        };
        database
            .upsert_repository("repo_example", &first)
            .expect("repository inserts");

        let second = RepositorySnapshot {
            head: "def456".into(),
            is_dirty: true,
            ..first
        };
        let repository = database
            .upsert_repository("repo_example", &second)
            .expect("repository updates");

        assert_eq!(repository.id, "repo_example");
        assert_eq!(repository.head, "def456");
        assert!(repository.is_dirty);
        assert_eq!(database.list_repositories().unwrap().len(), 1);

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn lists_every_symbol_when_browsing_without_a_search_query() {
        let (path, database) = registered_database("unbounded-symbol-browse");
        for index in 0..81 {
            database
                .connection
                .execute(
                    r#"
                    INSERT INTO symbols (
                      id, repository_id, language, kind, fqn, signature, relative_path,
                      start_line, end_line, ast_fingerprint
                    ) VALUES (?1, 'repo_workspace', 'java', 'method', ?2, '()', ?3, 1, 2, ?4)
                    "#,
                    params![
                        format!("symbol_{index}"),
                        format!("example.Class{index}.method"),
                        format!("src/Class{index}.java"),
                        format!("fingerprint_{index}"),
                    ],
                )
                .expect("symbol inserts");
        }

        assert_eq!(
            database
                .search_symbols("repo_workspace", "")
                .expect("all symbols load")
                .len(),
            81,
        );

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn migrates_a_legacy_note_to_a_titled_document_once() {
        let path = temporary_database_path("legacy-note-migration");
        let connection = Connection::open(&path).expect("legacy database opens");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE repositories (
                  id TEXT PRIMARY KEY NOT NULL,
                  root_path TEXT UNIQUE NOT NULL,
                  display_name TEXT NOT NULL,
                  branch TEXT NOT NULL,
                  head TEXT NOT NULL,
                  is_dirty INTEGER NOT NULL CHECK (is_dirty IN (0, 1)),
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE notes (
                  id INTEGER PRIMARY KEY,
                  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                  symbol_id TEXT NOT NULL,
                  symbol_fqn TEXT NOT NULL DEFAULT '',
                  symbol_signature TEXT NOT NULL DEFAULT '',
                  body_markdown TEXT NOT NULL DEFAULT '',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  status TEXT NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'orphan')),
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(repository_id, symbol_id)
                );
                INSERT INTO repositories (id, root_path, display_name, branch, head, is_dirty)
                VALUES ('repo_legacy', '/tmp/legacy', 'legacy', 'main', 'abc123', 0);
                INSERT INTO notes (
                  id, repository_id, symbol_id, symbol_fqn, symbol_signature,
                  body_markdown, tags_json, status, created_at, updated_at
                ) VALUES (
                  7, 'repo_legacy', 'symbol_legacy', 'example.Legacy.start', '()',
                  '기존 분석 본문', '["기존"]', 'linked',
                  '2026-01-01 10:00:00', '2026-01-02 11:00:00'
                );
                "#,
            )
            .expect("legacy schema is created");
        drop(connection);

        let database = Database::open(&path).expect("legacy database migrates");
        let notes = database
            .list_notes("repo_legacy", "symbol_legacy")
            .expect("migrated note loads");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, 7);
        assert_eq!(notes[0].title, "기본 분석");
        assert_eq!(notes[0].body_markdown, "기존 분석 본문");
        assert_eq!(notes[0].tags, ["기존"]);
        assert_eq!(notes[0].updated_at, "2026-01-02 11:00:00");
        let indexed_notes: u32 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE entity_type = 'note' AND entity_id = '7'",
                [],
                |row| row.get(0),
            )
            .expect("migrated note is indexed");
        assert_eq!(indexed_notes, 1);
        drop(database);

        let reopened = Database::open(&path).expect("migrated database reopens");
        assert_eq!(
            reopened
                .list_notes("repo_legacy", "symbol_legacy")
                .expect("reopened notes load")
                .len(),
            1,
            "reopening must not duplicate the migrated document"
        );
        drop(reopened);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn migrates_pre_php_symbol_language_constraint() {
        let path = temporary_database_path("pre-php-symbol-language-migration");
        let connection = Connection::open(&path).expect("legacy database opens");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE repositories (
                  id TEXT PRIMARY KEY NOT NULL,
                  root_path TEXT UNIQUE NOT NULL,
                  display_name TEXT NOT NULL,
                  branch TEXT NOT NULL,
                  head TEXT NOT NULL,
                  is_dirty INTEGER NOT NULL CHECK (is_dirty IN (0, 1)),
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE symbols (
                  id TEXT PRIMARY KEY NOT NULL,
                  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                  language TEXT NOT NULL CHECK (language IN ('java', 'python', 'typescript')),
                  kind TEXT NOT NULL,
                  fqn TEXT NOT NULL,
                  signature TEXT NOT NULL,
                  relative_path TEXT NOT NULL,
                  start_line INTEGER NOT NULL,
                  end_line INTEGER NOT NULL,
                  ast_fingerprint TEXT NOT NULL,
                  UNIQUE(repository_id, language, fqn, signature, relative_path)
                );
                INSERT INTO repositories (id, root_path, display_name, branch, head, is_dirty)
                VALUES ('repo_legacy', '/tmp/legacy-typescript', 'legacy-typescript', 'main', 'abc123', 0);
                INSERT INTO symbols (
                  id, repository_id, language, kind, fqn, signature, relative_path,
                  start_line, end_line, ast_fingerprint
                ) VALUES (
                  'symbol_java', 'repo_legacy', 'java', 'method', 'Legacy.start', '()',
                  'Legacy.java', 1, 1, 'fingerprint'
                );
                "#,
            )
            .expect("legacy schema is created");
        drop(connection);

        let mut database = Database::open(&path).expect("symbol language schema migrates");
        assert_eq!(
            database
                .symbol_by_id("repo_legacy", "symbol_java")
                .expect("legacy symbol query succeeds")
                .expect("legacy symbol remains")
                .language,
            SourceLanguage::Java
        );

        let file = analyze_file(
            SourceLanguage::Php,
            "src/start.php",
            "<?php function start(): void {}",
        )
        .expect("PHP source analyzes");
        let analysis = RepositoryAnalysis {
            source_file_count: 1,
            edges: resolve_calls(&file.symbols, &file.calls),
            symbols: file.symbols,
            diagnostics: file.diagnostics,
        };
        database
            .replace_analysis("repo_legacy", "def456", &analysis)
            .expect("PHP analysis persists after migration");
        let stored_language: String = database
            .connection
            .query_row(
                "SELECT language FROM symbols WHERE repository_id = 'repo_legacy'",
                [],
                |row| row.get(0),
            )
            .expect("PHP symbol is stored");
        assert_eq!(stored_language, "php");

        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn replaces_a_repository_analysis_atomically() {
        let path = temporary_database_path("analysis");
        let mut database = Database::open(&path).expect("database opens");
        let repository = RepositorySnapshot {
            root_path: "/tmp/analysis-example".into(),
            display_name: "analysis-example".into(),
            branch: "main".into(),
            head: "abc123".into(),
            is_dirty: false,
        };
        database
            .upsert_repository("repo_analysis", &repository)
            .expect("repository inserts");
        let file = analyze_file(
            SourceLanguage::Python,
            "sample.py",
            "def start():\n    finish()\n\ndef finish():\n    return None\n",
        )
        .expect("source analyzes");
        let start_symbol_id = file
            .symbols
            .iter()
            .find(|symbol| symbol.fqn == "sample.start")
            .expect("start symbol")
            .id
            .clone();
        let analysis = RepositoryAnalysis {
            source_file_count: 1,
            edges: resolve_calls(&file.symbols, &file.calls),
            symbols: file.symbols,
            diagnostics: file.diagnostics,
        };

        let summary = database
            .replace_analysis("repo_analysis", "abc123", &analysis)
            .expect("analysis persists");

        assert_eq!(summary.source_file_count, 1);
        assert_eq!(summary.symbol_count, 2);
        assert_eq!(summary.edge_count, 1);
        let symbol_count: u32 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM symbols WHERE repository_id = 'repo_analysis'",
                [],
                |row| row.get(0),
            )
            .expect("symbol count");
        let edge_count: u32 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM call_edges WHERE repository_id = 'repo_analysis'",
                [],
                |row| row.get(0),
            )
            .expect("edge count");
        assert_eq!(symbol_count, 2);
        assert_eq!(edge_count, 1);
        let graph = database
            .graph_for_symbol("repo_analysis", &start_symbol_id, 1)
            .expect("one-hop graph");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);

        let first_note = database
            .create_note("repo_analysis", &start_symbol_id, "회원가입 흐름")
            .expect("first note creates");
        let saved_note = database
            .update_note(
                "repo_analysis",
                &start_symbol_id,
                first_note.id,
                "회원가입 흐름",
                "이 함수는 분석을 시작합니다.",
                &["핵심".into(), "테스트".into()],
            )
            .expect("note saves");
        assert_eq!(saved_note.tags, ["핵심", "테스트"]);
        let second_note = database
            .create_note("repo_analysis", &start_symbol_id, "재시도 흐름")
            .expect("second note creates");
        database
            .update_note(
                "repo_analysis",
                &start_symbol_id,
                second_note.id,
                "재시도 흐름",
                "실패 뒤 재시도할 때의 분석입니다.",
                &[],
            )
            .expect("second note saves");
        let notes = database
            .list_notes("repo_analysis", &start_symbol_id)
            .expect("notes load");
        assert_eq!(notes.len(), 2);
        assert!(notes.iter().any(|note| {
            note.title == "회원가입 흐름" && note.body_markdown == "이 함수는 분석을 시작합니다."
        }));
        assert!(notes.iter().any(|note| {
            note.title == "재시도 흐름" && note.body_markdown == "실패 뒤 재시도할 때의 분석입니다."
        }));

        let deleted_analysis = RepositoryAnalysis {
            source_file_count: 0,
            symbols: Vec::new(),
            edges: Vec::new(),
            diagnostics: Vec::new(),
        };
        database
            .replace_analysis("repo_analysis", "def456", &deleted_analysis)
            .expect("empty analysis persists");
        assert_eq!(
            database
                .list_orphan_notes("repo_analysis")
                .expect("orphan notes load")
                .len(),
            2
        );

        let moved_file = analyze_file(
            SourceLanguage::Python,
            "moved/sample.py",
            "def start():\n    finish()\n\ndef finish():\n    return None\n",
        )
        .expect("moved source analyzes");
        let moved_start_symbol_id = moved_file
            .symbols
            .iter()
            .find(|symbol| symbol.fqn == "moved.sample.start")
            .expect("moved start symbol")
            .id
            .clone();
        let moved_analysis = RepositoryAnalysis {
            source_file_count: 1,
            edges: resolve_calls(&moved_file.symbols, &moved_file.calls),
            symbols: moved_file.symbols,
            diagnostics: moved_file.diagnostics,
        };
        database
            .replace_analysis("repo_analysis", "ghi789", &moved_analysis)
            .expect("moved analysis persists");
        assert_eq!(
            database
                .list_orphan_notes("repo_analysis")
                .expect("orphan notes load")
                .len(),
            2,
            "a renamed FQN remains safely orphaned instead of silently reconnecting"
        );
        assert!(database
            .list_notes("repo_analysis", &moved_start_symbol_id)
            .expect("note lookup")
            .is_empty());

        let java_file = analyze_file(
            SourceLanguage::Java,
            "src/Checkout.java",
            "package example; class Checkout { void start() {} }",
        )
        .expect("java source analyzes");
        let java_start_symbol_id = java_file
            .symbols
            .iter()
            .find(|symbol| symbol.fqn == "example.Checkout.start")
            .expect("java start symbol")
            .id
            .clone();
        let java_analysis = RepositoryAnalysis {
            source_file_count: 1,
            edges: resolve_calls(&java_file.symbols, &java_file.calls),
            symbols: java_file.symbols,
            diagnostics: java_file.diagnostics,
        };
        database
            .replace_analysis("repo_analysis", "jkl012", &java_analysis)
            .expect("java analysis persists");
        let java_note = database
            .create_note("repo_analysis", &java_start_symbol_id, "결제 시작")
            .expect("java note creates");
        database
            .update_note(
                "repo_analysis",
                &java_start_symbol_id,
                java_note.id,
                "결제 시작",
                "파일 이동 뒤에도 보존할 노트입니다.",
                &[],
            )
            .expect("java note saves");

        let moved_java_file = analyze_file(
            SourceLanguage::Java,
            "src/core/Checkout.java",
            "package example; class Checkout { void start() {} }",
        )
        .expect("moved java source analyzes");
        let moved_java_start_symbol_id = moved_java_file
            .symbols
            .iter()
            .find(|symbol| symbol.fqn == "example.Checkout.start")
            .expect("moved java start symbol")
            .id
            .clone();
        let moved_java_analysis = RepositoryAnalysis {
            source_file_count: 1,
            edges: resolve_calls(&moved_java_file.symbols, &moved_java_file.calls),
            symbols: moved_java_file.symbols,
            diagnostics: moved_java_file.diagnostics,
        };
        database
            .replace_analysis("repo_analysis", "mno345", &moved_java_analysis)
            .expect("moved java analysis persists");
        assert_eq!(
            database
                .list_notes("repo_analysis", &moved_java_start_symbol_id)
                .expect("relinked note lookup")[0]
                .body_markdown,
            "파일 이동 뒤에도 보존할 노트입니다."
        );

        drop(database);
        let _ = fs::remove_file(path);
    }
}
