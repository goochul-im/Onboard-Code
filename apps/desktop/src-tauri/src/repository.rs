use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Debug)]
pub struct RepositorySnapshot {
    pub root_path: String,
    pub display_name: String,
    pub branch: String,
    pub head: String,
    pub is_dirty: bool,
}

pub fn inspect(path: &str) -> Result<RepositorySnapshot, String> {
    let requested_path = Path::new(path);
    if !requested_path.is_dir() {
        return Err("폴더만 저장소로 등록할 수 있습니다.".into());
    }

    let root_path = git_output(requested_path, ["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(root_path.trim());
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("저장소 경로를 확인할 수 없습니다: {error}"))?;

    let branch_output = git_output(&canonical_root, ["symbolic-ref", "--short", "HEAD"]);
    let branch = branch_output.unwrap_or_else(|_| "detached HEAD".into());
    let head = git_output(&canonical_root, ["rev-parse", "--short", "HEAD"])?;
    let is_dirty = !git_output(
        &canonical_root,
        ["status", "--porcelain", "--untracked-files=normal"],
    )?
    .is_empty();
    let display_name = canonical_root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("이름 없는 저장소")
        .to_owned();

    Ok(RepositorySnapshot {
        root_path: canonical_root.to_string_lossy().into_owned(),
        display_name,
        branch,
        head,
        is_dirty,
    })
}

pub fn stable_repository_id(root_path: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in root_path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("repo_{hash:016x}")
}

pub fn source_files(repository_root: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository_root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
        .map_err(|error| format!("Git 파일 목록을 읽을 수 없습니다: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git 파일 목록을 읽을 수 없습니다: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .filter(|path| path.ends_with(".java") || path.ends_with(".py"))
        .map(PathBuf::from)
        .collect())
}

/// Reads a source file only when its canonical path remains inside the registered repository.
/// This deliberately has no Git write path: registered repositories are always input-only.
pub fn read_source(repository_root: &Path, relative_path: &str) -> Result<String, String> {
    let root = repository_root
        .canonicalize()
        .map_err(|error| format!("저장소 경로를 확인할 수 없습니다: {error}"))?;
    let source_path = root.join(relative_path).canonicalize().map_err(|error| {
        format!("소스 파일이 이동했거나 읽을 수 없습니다. 다시 분석하세요: {error}")
    })?;
    if !source_path.starts_with(&root) {
        return Err("저장소 밖의 파일은 읽을 수 없습니다.".to_owned());
    }

    std::fs::read_to_string(source_path)
        .map_err(|error| format!("소스 파일을 읽을 수 없습니다: {error}"))
}

fn git_output<const N: usize>(repository_path: &Path, args: [&str; N]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository_path)
        .args(args)
        .output()
        .map_err(|error| format!("Git을 실행할 수 없습니다. Git 설치를 확인하세요: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if stderr.is_empty() {
            "선택한 폴더는 유효한 Git 저장소가 아닙니다.".into()
        } else {
            format!("Git 저장소를 읽을 수 없습니다: {stderr}")
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{
        database::{
            Database, WorkspaceSnapshotRequest, WORKSPACE_DATABASE_FORMAT_VERSION,
            WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
        },
        indexer,
        restoration::{
            self, ReferenceValidationStatus, RestorationRequest, SelectedSymbolReference,
        },
    };

    use super::{inspect, read_source, stable_repository_id};

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
            .expect("git is available");
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn repository_identifier_is_deterministic() {
        assert_eq!(
            stable_repository_id("/Users/example/project"),
            stable_repository_id("/Users/example/project")
        );
        assert_ne!(
            stable_repository_id("/Users/example/project"),
            stable_repository_id("/Users/example/other")
        );
    }

    #[test]
    fn reads_git_metadata_without_changing_the_working_tree() {
        let directory = temporary_directory("repository-inspection");
        fs::create_dir_all(&directory).expect("temporary repository directory");
        run_git(&directory, &["init", "--initial-branch", "main"]);
        run_git(&directory, &["config", "user.name", "Test User"]);
        run_git(&directory, &["config", "user.email", "test@example.com"]);
        fs::write(
            directory.join("example.py"),
            "def example():\n    return 1\n",
        )
        .expect("fixture file");
        run_git(&directory, &["add", "example.py"]);
        run_git(&directory, &["commit", "-m", "fixture"]);
        let status_before = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain"])
            .output()
            .expect("status before inspection");

        let snapshot = inspect(directory.to_str().expect("UTF-8 test path")).expect("valid repo");
        let status_after = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain"])
            .output()
            .expect("status after inspection");

        assert_eq!(snapshot.branch, "main");
        assert_eq!(
            snapshot.display_name,
            directory.file_name().unwrap().to_string_lossy()
        );
        assert!(!snapshot.is_dirty);
        assert_eq!(status_before.stdout, status_after.stdout);

        fs::remove_dir_all(directory).expect("temporary repository cleanup");
    }

    #[test]
    fn rejects_a_regular_folder() {
        let directory = temporary_directory("not-a-repository");
        fs::create_dir_all(&directory).expect("temporary directory");

        let error = inspect(directory.to_str().expect("UTF-8 test path")).expect_err("not a repo");

        assert!(error.contains("Git 저장소"));
        fs::remove_dir_all(directory).expect("temporary directory cleanup");
    }

    #[test]
    fn dirty_repository_workflow_preserves_status_across_restart_and_requires_reconfirmation() {
        let directory = temporary_directory("dirty-workflow-read-only");
        fs::create_dir_all(&directory).expect("temporary repository");
        run_git(&directory, &["init", "--initial-branch", "main"]);
        run_git(&directory, &["config", "user.name", "Test User"]);
        run_git(&directory, &["config", "user.email", "test@example.com"]);
        fs::write(directory.join("sample.py"), "def start():\n    return 1\n")
            .expect("fixture source");
        fs::write(directory.join("README.md"), "fixture documentation\n")
            .expect("fixture documentation");
        run_git(&directory, &["add", "sample.py", "README.md"]);
        run_git(&directory, &["commit", "-m", "fixture"]);

        let clean_snapshot = inspect(directory.to_str().expect("UTF-8 fixture"))
            .expect("clean repository inspection");
        let restoration_request = RestorationRequest {
            repository_id: stable_repository_id(&clean_snapshot.root_path),
            root_path: clean_snapshot.root_path.clone(),
            branch: clean_snapshot.branch.clone(),
            head: clean_snapshot.head.clone(),
            selected_symbol: Some(SelectedSymbolReference {
                fqn: "sample.start".into(),
                signature: "()".into(),
                relative_path: "sample.py".into(),
                start_line: 1,
                end_line: 2,
            }),
        };
        fs::write(
            directory.join("README.md"),
            "fixture documentation\npreserve this unrelated edit\n",
        )
        .expect("unrelated tracked edit");
        let status_before = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .expect("status before workflow");

        let database_path = temporary_directory("dirty-workflow-database").join("state.sqlite3");
        let dirty_snapshot = inspect(directory.to_str().expect("UTF-8 fixture"))
            .expect("dirty repository registration");
        assert!(dirty_snapshot.is_dirty);
        let repository_id = stable_repository_id(&dirty_snapshot.root_path);
        let mut database = Database::open(&database_path).expect("database opens");
        database
            .upsert_repository(&repository_id, &dirty_snapshot)
            .expect("repository registration persists");
        let analysis =
            indexer::analyze_repository(&dirty_snapshot.root_path).expect("analysis succeeds");
        let symbol = analysis
            .symbols
            .iter()
            .find(|symbol| symbol.fqn == "sample.start")
            .expect("fixture function")
            .clone();
        database
            .replace_analysis(&repository_id, &dirty_snapshot.head, &analysis)
            .expect("analysis persists");
        let source_location = database
            .source_for_symbol(&repository_id, &symbol.id)
            .expect("source lookup")
            .expect("source location");
        assert_eq!(
            read_source(
                std::path::Path::new(&dirty_snapshot.root_path),
                &source_location.0
            )
            .expect("source reads"),
            "def start():\n    return 1\n"
        );
        database
            .save_workspace_snapshot(&WorkspaceSnapshotRequest {
                schema_version: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
                app_version: "0.1.0".into(),
                database_format_version: WORKSPACE_DATABASE_FORMAT_VERSION,
                repository_id: repository_id.clone(),
                state_json: "{\"activeWorkspace\":\"find\"}".into(),
            })
            .expect("workspace state saves");
        drop(database);

        let restarted_database = Database::open(&database_path).expect("database reopens");
        assert!(restarted_database
            .current_workspace_snapshot(&repository_id)
            .expect("workspace state restores")
            .is_some());
        let restored = restoration::validate(&restarted_database, restoration_request)
            .expect("restoration validates");
        assert_eq!(restored.repository_status, ReferenceValidationStatus::Valid);
        assert_eq!(
            restored.revision_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );
        assert_eq!(
            restored.symbol_status,
            ReferenceValidationStatus::ReconfirmationRequired
        );

        let status_after = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .expect("status after workflow");
        assert_eq!(status_before.stdout, status_after.stdout);
        assert_eq!(
            fs::read_to_string(directory.join("README.md")).expect("unrelated edit remains"),
            "fixture documentation\npreserve this unrelated edit\n"
        );

        drop(restarted_database);
        fs::remove_dir_all(directory).expect("fixture cleanup");
        let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
    }
}
