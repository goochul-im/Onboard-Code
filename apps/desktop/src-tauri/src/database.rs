use std::{collections::HashSet, fs, path::Path};

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
    pub symbol_id: String,
    pub body_markdown: String,
    pub tags: Vec<String>,
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
                LIMIT 80
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

    pub fn load_note(
        &self,
        repository_id: &str,
        symbol_id: &str,
    ) -> rusqlite::Result<Option<NoteRecord>> {
        self.connection
            .query_row(
                r#"
                SELECT symbol_id, body_markdown, tags_json, updated_at
                FROM notes
                WHERE repository_id = ?1 AND symbol_id = ?2
                "#,
                params![repository_id, symbol_id],
                row_to_note,
            )
            .optional()
    }

    pub fn save_note(
        &mut self,
        repository_id: &str,
        symbol_id: &str,
        body_markdown: &str,
        tags: &[String],
    ) -> rusqlite::Result<NoteRecord> {
        let tags_json = serde_json::to_string(tags)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let symbol = self
            .symbol_by_id(repository_id, symbol_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            r#"
            INSERT INTO notes (repository_id, symbol_id, body_markdown, tags_json)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(repository_id, symbol_id) DO UPDATE SET
              body_markdown = excluded.body_markdown,
              tags_json = excluded.tags_json,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![repository_id, symbol_id, body_markdown, tags_json],
        )?;
        transaction.execute(
            "DELETE FROM search_index WHERE repository_id = ?1 AND entity_type = 'note' AND entity_id = ?2",
            params![repository_id, symbol_id],
        )?;
        transaction.execute(
            r#"
            INSERT INTO search_index (repository_id, entity_type, entity_id, title, content)
            VALUES (?1, 'note', ?2, ?3, ?4)
            "#,
            params![repository_id, symbol_id, symbol.fqn, body_markdown],
        )?;
        transaction.commit()?;

        self.load_note(repository_id, symbol_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
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
        "python" => crate::analysis::SourceLanguage::Python,
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
    let tags_json: String = row.get(2)?;
    let tags = serde_json::from_str(&tags_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(NoteRecord {
        symbol_id: row.get(0)?,
        body_markdown: row.get(1)?,
        tags,
        updated_at: row.get(3)?,
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

        let saved_note = database
            .save_note(
                "repo_analysis",
                &start_symbol_id,
                "이 함수는 분석을 시작합니다.",
                &["핵심".into(), "테스트".into()],
            )
            .expect("note saves");
        assert_eq!(saved_note.tags, ["핵심", "테스트"]);
        assert_eq!(
            database
                .load_note("repo_analysis", &start_symbol_id)
                .expect("note loads")
                .expect("note exists")
                .body_markdown,
            "이 함수는 분석을 시작합니다."
        );

        drop(database);
        let _ = fs::remove_file(path);
    }
}
