use serde::{Deserialize, Serialize};

use crate::{database::Database, repository};

/// References captured by a workspace snapshot. These values are echoed back even when they
/// cannot be restored, so callers can show the unresolved context without guessing a replacement.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationRequest {
    pub repository_id: String,
    pub root_path: String,
    pub branch: String,
    pub head: String,
    pub selected_symbol: Option<SelectedSymbolReference>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedSymbolReference {
    pub fqn: String,
    pub signature: String,
    pub relative_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceValidationStatus {
    Valid,
    ReconfirmationRequired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationValidation {
    pub request: RestorationRequest,
    pub repository_status: ReferenceValidationStatus,
    pub revision_status: ReferenceValidationStatus,
    pub analysis_status: ReferenceValidationStatus,
    pub symbol_status: ReferenceValidationStatus,
    pub file_status: ReferenceValidationStatus,
    pub line_span_status: ReferenceValidationStatus,
    pub current_branch: Option<String>,
    pub current_head: Option<String>,
    pub current_is_dirty: Option<bool>,
}

impl RestorationValidation {
    fn unresolved(request: RestorationRequest) -> Self {
        Self {
            request,
            repository_status: ReferenceValidationStatus::ReconfirmationRequired,
            revision_status: ReferenceValidationStatus::ReconfirmationRequired,
            analysis_status: ReferenceValidationStatus::ReconfirmationRequired,
            symbol_status: ReferenceValidationStatus::ReconfirmationRequired,
            file_status: ReferenceValidationStatus::ReconfirmationRequired,
            line_span_status: ReferenceValidationStatus::ReconfirmationRequired,
            current_branch: None,
            current_head: None,
            current_is_dirty: None,
        }
    }
}

/// Validates restoration references without changing the registered Git worktree or remapping
/// stored references. The order is deliberate: registered identity, live Git inspection,
/// committed analysis identity, then exact symbol/source identity.
pub fn validate(
    database: &Database,
    request: RestorationRequest,
) -> Result<RestorationValidation, String> {
    let Some(registered_repository) = database
        .repository_by_id(&request.repository_id)
        .map_err(|error| format!("저장소 정보를 읽을 수 없습니다: {error}"))?
    else {
        return Ok(RestorationValidation::unresolved(request));
    };

    if registered_repository.root_path != request.root_path {
        return Ok(RestorationValidation::unresolved(request));
    }

    let live_repository = match repository::inspect(&registered_repository.root_path) {
        Ok(snapshot) if snapshot.root_path == registered_repository.root_path => snapshot,
        Ok(_) | Err(_) => return Ok(RestorationValidation::unresolved(request)),
    };
    let revision_matches = live_repository.branch == request.branch
        && live_repository.head == request.head
        && !live_repository.is_dirty;
    let revision_status = status_for(revision_matches);
    let analysis_matches = revision_matches
        && database
            .has_committed_analysis_for_revision(&request.repository_id, &live_repository.head)
            .map_err(|error| format!("분석 실행 정보를 읽을 수 없습니다: {error}"))?;
    let analysis_status = status_for(analysis_matches);

    let (symbol_status, file_status, line_span_status) = match &request.selected_symbol {
        None => (
            ReferenceValidationStatus::Valid,
            ReferenceValidationStatus::Valid,
            ReferenceValidationStatus::Valid,
        ),
        Some(symbol) if analysis_matches => {
            let exact_match = database
                .symbol_matches_reference(
                    &request.repository_id,
                    &symbol.fqn,
                    &symbol.signature,
                    &symbol.relative_path,
                    symbol.start_line,
                    symbol.end_line,
                )
                .map_err(|error| format!("저장된 함수 참조를 읽을 수 없습니다: {error}"))?;
            let status = status_for(exact_match);
            (status, status, status)
        }
        Some(_) => (
            ReferenceValidationStatus::ReconfirmationRequired,
            ReferenceValidationStatus::ReconfirmationRequired,
            ReferenceValidationStatus::ReconfirmationRequired,
        ),
    };

    Ok(RestorationValidation {
        request,
        repository_status: ReferenceValidationStatus::Valid,
        revision_status,
        analysis_status,
        symbol_status,
        file_status,
        line_span_status,
        current_branch: Some(live_repository.branch),
        current_head: Some(live_repository.head),
        current_is_dirty: Some(live_repository.is_dirty),
    })
}

fn status_for(matches: bool) -> ReferenceValidationStatus {
    if matches {
        ReferenceValidationStatus::Valid
    } else {
        ReferenceValidationStatus::ReconfirmationRequired
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{database::Database, indexer, repository};

    use super::{validate, ReferenceValidationStatus, RestorationRequest, SelectedSymbolReference};

    fn temporary_directory(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "code-graph-notebook-{test_name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ))
    }

    fn run_git(path: &PathBuf, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn request_for(snapshot: &repository::RepositorySnapshot) -> RestorationRequest {
        RestorationRequest {
            repository_id: repository::stable_repository_id(&snapshot.root_path),
            root_path: snapshot.root_path.clone(),
            branch: snapshot.branch.clone(),
            head: snapshot.head.clone(),
            selected_symbol: Some(SelectedSymbolReference {
                fqn: "sample.start".into(),
                signature: "()".into(),
                relative_path: "sample.py".into(),
                start_line: 1,
                end_line: 2,
            }),
        }
    }

    #[test]
    fn restores_only_an_exact_reference_from_a_committed_matching_analysis_without_mutating_git() {
        let directory = temporary_directory("restoration-validation");
        fs::create_dir_all(&directory).expect("temporary repository");
        run_git(&directory, &["init", "--initial-branch", "main"]);
        run_git(&directory, &["config", "user.name", "Test User"]);
        run_git(&directory, &["config", "user.email", "test@example.com"]);
        fs::write(directory.join("sample.py"), "def start():\n    return 1\n")
            .expect("fixture source");
        run_git(&directory, &["add", "sample.py"]);
        run_git(&directory, &["commit", "-m", "fixture"]);

        let snapshot = repository::inspect(directory.to_str().expect("UTF-8 fixture"))
            .expect("repository inspection");
        let database_path = std::env::temp_dir().join(format!(
            "code-graph-notebook-restoration-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let mut database = Database::open(&database_path).expect("database opens");
        let repository_id = repository::stable_repository_id(&snapshot.root_path);
        database
            .upsert_repository(&repository_id, &snapshot)
            .expect("repository saves");
        let analysis = indexer::analyze_repository(&snapshot.root_path).expect("analysis succeeds");
        database
            .replace_analysis(&repository_id, &snapshot.head, &analysis)
            .expect("analysis commits");
        let request = request_for(&snapshot);
        let status_before = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .expect("status before validation");

        let restored = validate(&database, request.clone()).expect("references validate");

        let status_after = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .expect("status after validation");
        assert_eq!(status_before.stdout, status_after.stdout);
        assert_eq!(restored.repository_status, ReferenceValidationStatus::Valid);
        assert_eq!(restored.analysis_status, ReferenceValidationStatus::Valid);
        assert_eq!(restored.symbol_status, ReferenceValidationStatus::Valid);

        let wrong_symbol = RestorationRequest {
            selected_symbol: Some(SelectedSymbolReference {
                fqn: "sample.other".into(),
                ..request.selected_symbol.clone().expect("symbol reference")
            }),
            ..request.clone()
        };
        let unresolved =
            validate(&database, wrong_symbol.clone()).expect("unresolved reference validates");
        assert_eq!(
            unresolved.request.selected_symbol.unwrap().fqn,
            "sample.other"
        );
        assert_eq!(
            unresolved.symbol_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );

        // The symbols table represents only the latest committed run. A historical matching run
        // must not validate those rows after a newer run has replaced them for this repository.
        database
            .replace_analysis(&repository_id, "newer-analysis-revision", &analysis)
            .expect("newer analysis persists");
        let superseded =
            validate(&database, request.clone()).expect("superseded references validate");
        assert_eq!(
            superseded.revision_status,
            ReferenceValidationStatus::Valid,
            "the live repository still matches the stored revision"
        );
        assert_eq!(
            superseded.analysis_status,
            ReferenceValidationStatus::ReconfirmationRequired,
            "a historical matching run cannot validate current symbol rows"
        );
        assert_eq!(
            superseded.symbol_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );

        database
            .replace_analysis(&repository_id, &snapshot.head, &analysis)
            .expect("matching analysis restores");

        fs::write(directory.join("sample.py"), "def start():\n    return 2\n")
            .expect("changed fixture");
        run_git(&directory, &["add", "sample.py"]);
        run_git(&directory, &["commit", "-m", "changed revision"]);
        let stale = validate(&database, request.clone()).expect("stale references validate");
        assert_eq!(
            stale.request.head, request.head,
            "stored context must remain visible"
        );
        assert_eq!(
            stale.revision_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );
        assert_eq!(
            stale.analysis_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );
        assert_eq!(
            stale.symbol_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );

        drop(database);
        fs::remove_dir_all(directory).expect("fixture cleanup");
        let _ = fs::remove_file(database_path);
    }
}
