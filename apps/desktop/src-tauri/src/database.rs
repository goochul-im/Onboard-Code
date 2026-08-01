use std::{fs, path::Path};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

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

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }

        let connection = Connection::open(path)?;
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
              language TEXT NOT NULL CHECK (language IN ('java', 'python')),
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
              body_markdown TEXT NOT NULL DEFAULT '',
              tags_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(repository_id, symbol_id)
            );

            CREATE TABLE IF NOT EXISTS graph_preferences (
              repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
              layout_json TEXT NOT NULL DEFAULT '{}',
              filters_json TEXT NOT NULL DEFAULT '{}',
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
              repository_id UNINDEXED,
              entity_type UNINDEXED,
              entity_id UNINDEXED,
              title,
              content
            );
            "#,
        )?;

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

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use crate::{
        analysis::{analyze_file, resolve_calls, SourceLanguage},
        indexer::RepositoryAnalysis,
    };

    use super::*;

    fn temporary_database_path(test_name: &str) -> std::path::PathBuf {
        env::temp_dir().join(format!(
            "code-graph-notebook-{test_name}-{}-{}.sqlite3",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ))
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

        drop(database);
        let _ = fs::remove_file(path);
    }
}
