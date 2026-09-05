use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::Path,
    process::Command,
};

use serde::Serialize;

use crate::{
    analysis::IndexedSymbol,
    database::{Database, GraphEdge},
    indexer::{self, AnalyzedSourceFile, RepositoryAnalysis},
    repository,
};

const MAX_CALLER_DISTANCE: u8 = 3;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeImpactReport {
    pub status: ChangeImpactStatus,
    pub repository_id: String,
    pub base_revision: Option<String>,
    pub current_revision: String,
    pub branch: String,
    pub is_dirty: bool,
    pub changed_files: Vec<String>,
    pub changes: Vec<ImpactChange>,
    pub affected_callers: Vec<ImpactCaller>,
    pub diagnostic_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeImpactStatus {
    NoBaseline,
    Unchanged,
    Changed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactChange {
    pub kind: ImpactChangeKind,
    pub symbol: Option<IndexedSymbol>,
    pub previous_symbol: Option<IndexedSymbol>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImpactChangeKind {
    Added,
    Modified,
    Deleted,
    Moved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactCaller {
    pub symbol: IndexedSymbol,
    pub distance: u8,
    pub changed_symbols: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct SymbolKey {
    language: &'static str,
    fqn: String,
    signature: String,
}

#[derive(Clone, Debug)]
struct EdgeLink {
    caller_symbol_id: String,
    callee_symbol_id: Option<String>,
}

pub fn analyze_change_impact(
    database: &Database,
    repository_id: &str,
) -> Result<ChangeImpactReport, String> {
    let repository = database
        .repository_by_id(repository_id)
        .map_err(|error| format!("저장소 정보를 읽을 수 없습니다: {error}"))?
        .ok_or_else(|| "등록되지 않은 저장소입니다.".to_owned())?;
    let snapshot = repository::inspect(&repository.root_path)?;
    let base_revision = database
        .latest_completed_analysis_revision(repository_id)
        .map_err(|error| format!("기준 분석 정보를 읽을 수 없습니다: {error}"))?;

    let Some(base_revision) = base_revision else {
        return Ok(ChangeImpactReport {
            status: ChangeImpactStatus::NoBaseline,
            repository_id: repository_id.to_owned(),
            base_revision: None,
            current_revision: snapshot.head,
            branch: snapshot.branch,
            is_dirty: snapshot.is_dirty,
            changed_files: Vec::new(),
            changes: Vec::new(),
            affected_callers: Vec::new(),
            diagnostic_count: 0,
        });
    };

    let base_symbols = database
        .all_symbols(repository_id)
        .map_err(|error| format!("기준 심볼을 읽을 수 없습니다: {error}"))?;
    let base_edges = database
        .all_call_edges(repository_id)
        .map_err(|error| format!("기준 호출 그래프를 읽을 수 없습니다: {error}"))?;
    let base_source_files = database
        .latest_analysis_source_files(repository_id)
        .map_err(|error| format!("기준 파일 목록을 읽을 수 없습니다: {error}"))?;
    let current_analysis = indexer::analyze_repository(&snapshot.root_path)?;
    let changed_files = match base_source_files {
        Some(source_files) if !source_files.is_empty() => {
            changed_source_files_from_fingerprints(&source_files, &current_analysis.source_files)
        }
        _ => changed_source_files_from_git(Path::new(&snapshot.root_path), &base_revision)?,
    };
    let changes = diff_symbols(&base_symbols, &current_analysis.symbols);
    let affected_callers =
        impacted_callers(&changes, &base_symbols, &base_edges, &current_analysis);
    let status = if !changed_files.is_empty() || !changes.is_empty() {
        ChangeImpactStatus::Changed
    } else {
        ChangeImpactStatus::Unchanged
    };

    Ok(ChangeImpactReport {
        status,
        repository_id: repository_id.to_owned(),
        base_revision: Some(base_revision),
        current_revision: snapshot.head,
        branch: snapshot.branch,
        is_dirty: snapshot.is_dirty,
        changed_files,
        changes,
        affected_callers,
        diagnostic_count: current_analysis.diagnostics.len(),
    })
}

fn diff_symbols(
    base_symbols: &[IndexedSymbol],
    current_symbols: &[IndexedSymbol],
) -> Vec<ImpactChange> {
    let base_by_key = symbols_by_key(base_symbols);
    let current_by_key = symbols_by_key(current_symbols);
    let mut keys = BTreeSet::new();
    keys.extend(base_by_key.keys().cloned());
    keys.extend(current_by_key.keys().cloned());

    let mut changes = keys
        .into_iter()
        .filter_map(
            |key| match (base_by_key.get(&key), current_by_key.get(&key)) {
                (None, Some(current)) => Some(ImpactChange {
                    kind: ImpactChangeKind::Added,
                    symbol: Some((*current).clone()),
                    previous_symbol: None,
                }),
                (Some(previous), None) => Some(ImpactChange {
                    kind: ImpactChangeKind::Deleted,
                    symbol: None,
                    previous_symbol: Some((*previous).clone()),
                }),
                (Some(previous), Some(current))
                    if previous.relative_path != current.relative_path =>
                {
                    Some(ImpactChange {
                        kind: ImpactChangeKind::Moved,
                        symbol: Some((*current).clone()),
                        previous_symbol: Some((*previous).clone()),
                    })
                }
                (Some(previous), Some(current))
                    if previous.ast_fingerprint != current.ast_fingerprint =>
                {
                    Some(ImpactChange {
                        kind: ImpactChangeKind::Modified,
                        symbol: Some((*current).clone()),
                        previous_symbol: Some((*previous).clone()),
                    })
                }
                _ => None,
            },
        )
        .collect::<Vec<_>>();
    changes.sort_by(|left, right| {
        change_sort_key(left)
            .cmp(&change_sort_key(right))
            .then_with(|| change_kind_rank(&left.kind).cmp(&change_kind_rank(&right.kind)))
    });
    changes
}

fn impacted_callers(
    changes: &[ImpactChange],
    base_symbols: &[IndexedSymbol],
    base_edges: &[GraphEdge],
    current_analysis: &RepositoryAnalysis,
) -> Vec<ImpactCaller> {
    let mut affected: BTreeMap<String, (IndexedSymbol, u8, BTreeSet<String>)> = BTreeMap::new();
    let directly_changed_keys = directly_changed_symbol_keys(changes);

    let current_edges = current_analysis
        .edges
        .iter()
        .map(|edge| EdgeLink {
            caller_symbol_id: edge.caller_symbol_id.clone(),
            callee_symbol_id: edge.callee_symbol_id.clone(),
        })
        .collect::<Vec<_>>();
    let base_edge_links = base_edges
        .iter()
        .map(|edge| EdgeLink {
            caller_symbol_id: edge.source.clone(),
            callee_symbol_id: edge.target.clone(),
        })
        .collect::<Vec<_>>();

    let current_symbols_by_id = symbols_by_id(&current_analysis.symbols);
    let base_symbols_by_id = symbols_by_id(base_symbols);
    let current_symbols_by_key = symbols_by_key(&current_analysis.symbols);

    for change in changes {
        let (seed_id, symbols, edges) = match change.kind {
            ImpactChangeKind::Deleted => (
                change
                    .previous_symbol
                    .as_ref()
                    .map(|symbol| symbol.id.clone()),
                &base_symbols_by_id,
                &base_edge_links,
            ),
            ImpactChangeKind::Added | ImpactChangeKind::Modified | ImpactChangeKind::Moved => (
                change.symbol.as_ref().map(|symbol| symbol.id.clone()),
                &current_symbols_by_id,
                &current_edges,
            ),
        };
        let Some(seed_id) = seed_id else {
            continue;
        };
        let reverse_edges = reverse_edges(edges);
        let mut queue = VecDeque::from([(seed_id.clone(), 0_u8)]);
        let mut visited = BTreeSet::from([seed_id.clone()]);

        while let Some((callee_id, distance)) = queue.pop_front() {
            if distance >= MAX_CALLER_DISTANCE {
                continue;
            }
            let next_distance = distance + 1;
            for caller_id in reverse_edges.get(&callee_id).into_iter().flatten() {
                if !visited.insert(caller_id.clone()) {
                    continue;
                }
                if let Some(caller) = current_unchanged_caller(
                    symbols.get(caller_id.as_str()).copied(),
                    &current_symbols_by_key,
                    &directly_changed_keys,
                ) {
                    let entry = affected
                        .entry(caller.id.clone())
                        .or_insert_with(|| (caller.clone(), next_distance, BTreeSet::new()));
                    entry.1 = entry.1.min(next_distance);
                    entry.2.insert(seed_id.clone());
                }
                queue.push_back((caller_id.clone(), next_distance));
            }
        }
    }

    let mut callers = affected
        .into_values()
        .map(|(symbol, distance, changed_symbols)| ImpactCaller {
            symbol,
            distance,
            changed_symbols: changed_symbols.into_iter().collect(),
        })
        .collect::<Vec<_>>();
    callers.sort_by(|left, right| {
        left.distance
            .cmp(&right.distance)
            .then_with(|| left.symbol.fqn.cmp(&right.symbol.fqn))
            .then_with(|| left.symbol.relative_path.cmp(&right.symbol.relative_path))
    });
    callers
}

fn current_unchanged_caller(
    caller: Option<&IndexedSymbol>,
    current_symbols_by_key: &BTreeMap<SymbolKey, &IndexedSymbol>,
    directly_changed_keys: &BTreeSet<SymbolKey>,
) -> Option<IndexedSymbol> {
    let caller = caller?;
    let key = symbol_key(caller);
    if directly_changed_keys.contains(&key) {
        return None;
    }
    let current = current_symbols_by_key.get(&key).copied()?;
    if current.relative_path == caller.relative_path
        && current.ast_fingerprint == caller.ast_fingerprint
    {
        Some(current.clone())
    } else {
        None
    }
}

fn directly_changed_symbol_keys(changes: &[ImpactChange]) -> BTreeSet<SymbolKey> {
    let mut keys = BTreeSet::new();
    for change in changes {
        if let Some(symbol) = &change.symbol {
            keys.insert(symbol_key(symbol));
        }
        if let Some(symbol) = &change.previous_symbol {
            keys.insert(symbol_key(symbol));
        }
    }
    keys
}

fn changed_source_files_from_fingerprints(
    base_source_files: &[AnalyzedSourceFile],
    current_source_files: &[AnalyzedSourceFile],
) -> Vec<String> {
    let base_by_path = source_files_by_path(base_source_files);
    let current_by_path = source_files_by_path(current_source_files);
    let mut paths = BTreeSet::new();
    paths.extend(base_by_path.keys().copied());
    paths.extend(current_by_path.keys().copied());
    paths
        .into_iter()
        .filter(|path| base_by_path.get(path) != current_by_path.get(path))
        .map(str::to_owned)
        .collect()
}

fn changed_source_files_from_git(
    repository_root: &Path,
    base_revision: &str,
) -> Result<Vec<String>, String> {
    let mut paths = BTreeSet::new();
    paths.extend(git_paths(
        repository_root,
        &["diff", "--name-only", "-z", base_revision, "--"],
    )?);
    paths.extend(git_paths(
        repository_root,
        &["ls-files", "-z", "--others", "--exclude-standard"],
    )?);
    Ok(paths
        .into_iter()
        .filter(|path| is_supported_source(path))
        .collect())
}

fn source_files_by_path(source_files: &[AnalyzedSourceFile]) -> BTreeMap<&str, &str> {
    source_files
        .iter()
        .map(|source_file| {
            (
                source_file.relative_path.as_str(),
                source_file.content_fingerprint.as_str(),
            )
        })
        .collect()
}

fn git_paths(repository_root: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository_root)
        .args(args)
        .output()
        .map_err(|error| format!("Git 변경 파일을 읽을 수 없습니다: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git 변경 파일을 읽을 수 없습니다: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .map(|path| path.replace('\\', "/"))
        .collect())
}

fn symbols_by_key(symbols: &[IndexedSymbol]) -> BTreeMap<SymbolKey, &IndexedSymbol> {
    symbols
        .iter()
        .map(|symbol| (symbol_key(symbol), symbol))
        .collect()
}

fn symbols_by_id(symbols: &[IndexedSymbol]) -> BTreeMap<&str, &IndexedSymbol> {
    symbols
        .iter()
        .map(|symbol| (symbol.id.as_str(), symbol))
        .collect()
}

fn reverse_edges(edges: &[EdgeLink]) -> BTreeMap<String, Vec<String>> {
    let mut reverse = BTreeMap::<String, Vec<String>>::new();
    for edge in edges {
        if let Some(callee_id) = &edge.callee_symbol_id {
            reverse
                .entry(callee_id.clone())
                .or_default()
                .push(edge.caller_symbol_id.clone());
        }
    }
    reverse
}

fn symbol_key(symbol: &IndexedSymbol) -> SymbolKey {
    SymbolKey {
        language: symbol.language.as_str(),
        fqn: symbol.fqn.clone(),
        signature: symbol.signature.clone(),
    }
}

fn change_sort_key(change: &ImpactChange) -> (String, String) {
    let symbol = change.symbol.as_ref().or(change.previous_symbol.as_ref());
    symbol
        .map(|symbol| (symbol.fqn.clone(), symbol.relative_path.clone()))
        .unwrap_or_default()
}

fn change_kind_rank(kind: &ImpactChangeKind) -> u8 {
    match kind {
        ImpactChangeKind::Added => 0,
        ImpactChangeKind::Modified => 1,
        ImpactChangeKind::Deleted => 2,
        ImpactChangeKind::Moved => 3,
    }
}

fn is_supported_source(path: &str) -> bool {
    path.ends_with(".java")
        || path.ends_with(".php")
        || path.ends_with(".py")
        || path.ends_with(".ts")
        || path.ends_with(".tsx")
        || path.ends_with(".mts")
        || path.ends_with(".cts")
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::atomic::{AtomicUsize, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{database::Database, indexer, repository};

    use super::{analyze_change_impact, ChangeImpactStatus, ImpactChangeKind};

    static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    fn temporary_repository(test_name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "code-graph-notebook-impact-{}-{}-{}",
            test_name,
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).expect("temporary repository directory");
        run_git(&directory, &["init", "--initial-branch", "main"]);
        run_git(&directory, &["config", "user.name", "Test User"]);
        run_git(&directory, &["config", "user.email", "test@example.com"]);
        directory
    }

    fn temporary_database_path(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "code-graph-notebook-impact-{test_name}-{}-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ))
    }

    fn run_git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git is available");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn save_current_analysis(database: &mut Database, repository: &Path, repository_id: &str) {
        let snapshot = repository::inspect(repository.to_str().expect("UTF-8 repository path"))
            .expect("repository snapshot");
        database
            .upsert_repository(repository_id, &snapshot)
            .expect("repository stored");
        let analysis =
            indexer::analyze_repository(&snapshot.root_path).expect("repository analyzes");
        database
            .replace_analysis(repository_id, &snapshot.head, &analysis)
            .expect("analysis stored");
    }

    #[test]
    fn reports_no_baseline_when_repository_has_not_been_analyzed() {
        let repository = temporary_repository("no-baseline");
        fs::write(repository.join("sample.py"), "def start():\n    return 1\n").expect("source");
        run_git(&repository, &["add", "sample.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let snapshot =
            repository::inspect(repository.to_str().expect("UTF-8 repository path")).unwrap();
        let database_path = temporary_database_path("no-baseline");
        let database = Database::open(&database_path).expect("database opens");
        database
            .upsert_repository("repo_impact", &snapshot)
            .expect("repository stored");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::NoBaseline);
        assert_eq!(report.base_revision, None);
        assert!(report.changes.is_empty());

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn reports_unchanged_when_head_and_working_tree_match_the_last_analysis() {
        let repository = temporary_repository("unchanged");
        fs::write(
            repository.join("flow.py"),
            "def caller():\n    callee()\n\ndef callee():\n    return 1\n",
        )
        .expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("unchanged");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Unchanged);
        assert!(report.changed_files.is_empty());
        assert!(report.changes.is_empty());
        assert!(report.affected_callers.is_empty());

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn reports_modified_callee_and_reverse_caller_chain() {
        let repository = temporary_repository("modified-callee");
        fs::write(
            repository.join("flow.py"),
            "def entry():\n    middle()\n\ndef middle():\n    callee()\n\ndef callee():\n    return 1\n",
        )
        .expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("modified-callee");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(
            repository.join("flow.py"),
            "def entry():\n    middle()\n\ndef middle():\n    callee()\n\ndef callee():\n    return 2\n",
        )
        .expect("modified source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Changed);
        assert_eq!(report.changed_files, ["flow.py"]);
        assert_eq!(report.changes.len(), 1);
        assert_eq!(report.changes[0].kind, ImpactChangeKind::Modified);
        assert_eq!(
            report.changes[0]
                .symbol
                .as_ref()
                .map(|symbol| symbol.fqn.as_str()),
            Some("flow.callee")
        );
        assert!(report.affected_callers.iter().any(|caller| {
            caller.symbol.fqn == "flow.middle"
                && caller.distance == 1
                && caller.changed_symbols == [report.changes[0].symbol.as_ref().unwrap().id.clone()]
        }));
        assert!(report
            .affected_callers
            .iter()
            .any(|caller| { caller.symbol.fqn == "flow.entry" && caller.distance == 2 }));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn treats_dirty_worktree_content_as_the_baseline_when_it_was_analyzed() {
        let repository = temporary_repository("dirty-baseline");
        fs::write(repository.join("flow.py"), "def changed():\n    return 1\n").expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        fs::write(repository.join("flow.py"), "def changed():\n    return 2\n").expect("source");
        let database_path = temporary_database_path("dirty-baseline");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");

        let unchanged_report =
            analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(unchanged_report.status, ChangeImpactStatus::Unchanged);
        assert!(unchanged_report.is_dirty);
        assert!(unchanged_report.changed_files.is_empty());
        assert!(unchanged_report.changes.is_empty());

        fs::write(repository.join("flow.py"), "def changed():\n    return 3\n").expect("source");

        let changed_report =
            analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(changed_report.status, ChangeImpactStatus::Changed);
        assert_eq!(changed_report.changed_files, ["flow.py"]);
        assert!(changed_report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Modified
                && change
                    .symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "flow.changed")
        }));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn reports_surviving_current_caller_for_deleted_callee() {
        let repository = temporary_repository("deleted-callee");
        fs::write(
            repository.join("flow.py"),
            "def caller():\n    callee()\n\ndef callee():\n    return 1\n",
        )
        .expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("deleted-callee");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(repository.join("flow.py"), "def caller():\n    callee()\n").expect("source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Deleted
                && change
                    .previous_symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "flow.callee")
        }));
        assert_eq!(report.affected_callers.len(), 1);
        assert_eq!(report.affected_callers[0].symbol.fqn, "flow.caller");
        assert_eq!(report.affected_callers[0].symbol.ast_fingerprint, {
            let current_symbols = indexer::analyze_repository(repository.to_str().unwrap())
                .expect("current analysis")
                .symbols;
            current_symbols
                .iter()
                .find(|symbol| symbol.fqn == "flow.caller")
                .expect("current caller")
                .ast_fingerprint
                .clone()
        });

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn excludes_directly_changed_callers_from_affected_callers() {
        let repository = temporary_repository("changed-caller");
        fs::write(
            repository.join("flow.py"),
            "def entry():\n    middle()\n\ndef middle():\n    callee()\n\ndef callee():\n    return 1\n",
        )
        .expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("changed-caller");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(
            repository.join("flow.py"),
            "def entry():\n    middle()\n\ndef middle():\n    return 2\n",
        )
        .expect("source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Modified
                && change
                    .symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "flow.middle")
        }));
        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Deleted
                && change
                    .previous_symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "flow.callee")
        }));
        assert!(!report
            .affected_callers
            .iter()
            .any(|caller| caller.symbol.fqn == "flow.middle"));
        assert!(report
            .affected_callers
            .iter()
            .any(|caller| caller.symbol.fqn == "flow.entry"));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn classifies_same_java_symbol_in_a_new_path_as_moved() {
        let repository = temporary_repository("moved-java");
        fs::create_dir_all(repository.join("src")).expect("source directory");
        fs::create_dir_all(repository.join("src/core")).expect("source directory");
        fs::write(
            repository.join("src/Checkout.java"),
            "package example; class Checkout { void start() {} }\n",
        )
        .expect("source");
        run_git(&repository, &["add", "src/Checkout.java"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("moved-java");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::rename(
            repository.join("src/Checkout.java"),
            repository.join("src/core/Checkout.java"),
        )
        .expect("move source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Moved
                && change
                    .symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.relative_path == "src/core/Checkout.java")
                && change
                    .previous_symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.relative_path == "src/Checkout.java")
        }));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn change_impact_analysis_does_not_replace_the_stored_baseline() {
        let repository = temporary_repository("read-only-impact");
        fs::write(repository.join("flow.py"), "def changed():\n    return 1\n").expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("read-only-impact");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        let baseline_revision = database
            .latest_completed_analysis_revision("repo_impact")
            .expect("baseline revision")
            .expect("baseline exists");
        let baseline_symbols = database
            .all_symbols("repo_impact")
            .expect("baseline symbols load");
        fs::write(repository.join("flow.py"), "def changed():\n    return 2\n").expect("source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Changed);
        assert_eq!(
            database
                .latest_completed_analysis_revision("repo_impact")
                .expect("baseline revision"),
            Some(baseline_revision)
        );
        assert_eq!(
            database
                .all_symbols("repo_impact")
                .expect("baseline symbols reload"),
            baseline_symbols
        );

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn reports_added_untracked_source_file() {
        let repository = temporary_repository("untracked");
        fs::write(
            repository.join("flow.py"),
            "def existing():\n    return 1\n",
        )
        .expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("untracked");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(
            repository.join("new_flow.py"),
            "def added():\n    return 2\n",
        )
        .expect("source");

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Changed);
        assert!(report.is_dirty);
        assert_eq!(report.changed_files, ["new_flow.py"]);
        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Added
                && change
                    .symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "new_flow.added")
        }));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn reports_staged_only_source_changes() {
        let repository = temporary_repository("staged-only");
        fs::write(repository.join("flow.py"), "def changed():\n    return 1\n").expect("source");
        run_git(&repository, &["add", "flow.py"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("staged-only");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(repository.join("flow.py"), "def changed():\n    return 2\n").expect("source");
        run_git(&repository, &["add", "flow.py"]);

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Changed);
        assert_eq!(report.changed_files, ["flow.py"]);
        assert!(report.changes.iter().any(|change| {
            change.kind == ImpactChangeKind::Modified
                && change
                    .symbol
                    .as_ref()
                    .is_some_and(|symbol| symbol.fqn == "flow.changed")
        }));

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }

    #[test]
    fn ignores_non_source_revision_changes_for_impact_status() {
        let repository = temporary_repository("non-source");
        fs::write(repository.join("flow.py"), "def stable():\n    return 1\n").expect("source");
        fs::write(repository.join("README.md"), "first\n").expect("readme");
        run_git(&repository, &["add", "flow.py", "README.md"]);
        run_git(&repository, &["commit", "-m", "fixture"]);
        let database_path = temporary_database_path("non-source");
        let mut database = Database::open(&database_path).expect("database opens");
        save_current_analysis(&mut database, &repository, "repo_impact");
        fs::write(repository.join("README.md"), "second\n").expect("readme");
        run_git(&repository, &["add", "README.md"]);
        run_git(&repository, &["commit", "-m", "docs"]);

        let report = analyze_change_impact(&database, "repo_impact").expect("impact report");

        assert_eq!(report.status, ChangeImpactStatus::Unchanged);
        assert_ne!(
            report.base_revision.as_deref(),
            Some(report.current_revision.as_str())
        );
        assert!(report.changed_files.is_empty());
        assert!(report.changes.is_empty());

        drop(database);
        let _ = fs::remove_dir_all(repository);
        let _ = fs::remove_file(database_path);
    }
}
