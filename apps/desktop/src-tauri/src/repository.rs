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

    use super::{inspect, stable_repository_id};

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
}
