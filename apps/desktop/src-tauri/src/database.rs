use std::{fs, path::Path};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::repository::RepositorySnapshot;

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
}
