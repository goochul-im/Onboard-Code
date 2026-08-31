use std::{fs, path::Path};

use crate::{
    analysis::{analyze_file, resolve_calls, IndexedEdge, IndexedSymbol, SourceLanguage},
    repository,
};

#[derive(Clone, Debug)]
pub struct RepositoryAnalysis {
    pub source_file_count: usize,
    pub symbols: Vec<IndexedSymbol>,
    pub edges: Vec<IndexedEdge>,
    pub diagnostics: Vec<String>,
}

pub fn analyze_repository(root_path: &str) -> Result<RepositoryAnalysis, String> {
    let root = Path::new(root_path)
        .canonicalize()
        .map_err(|error| format!("저장소 경로를 확인할 수 없습니다: {error}"))?;
    let relative_paths = repository::source_files(&root)?;
    let mut source_file_count = 0;
    let mut symbols = Vec::new();
    let mut raw_calls = Vec::new();
    let mut diagnostics = Vec::new();

    for relative_path in relative_paths {
        let relative_path_text = relative_path.to_string_lossy().replace('\\', "/");
        let Some(language) = SourceLanguage::from_relative_path(&relative_path_text) else {
            continue;
        };
        let source_path = root.join(&relative_path);
        let canonical_source = match source_path.canonicalize() {
            Ok(path) if path.starts_with(&root) => path,
            Ok(_) => {
                diagnostics.push(format!(
                    "{relative_path_text}: 저장소 밖을 가리키는 심볼릭 링크를 건너뜁니다."
                ));
                continue;
            }
            Err(error) => {
                diagnostics.push(format!(
                    "{relative_path_text}: 파일을 확인할 수 없습니다: {error}"
                ));
                continue;
            }
        };
        let metadata = match fs::metadata(&canonical_source) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(format!(
                    "{relative_path_text}: 파일 정보를 읽을 수 없습니다: {error}"
                ));
                continue;
            }
        };
        if metadata.len() > 2 * 1024 * 1024 {
            diagnostics.push(format!(
                "{relative_path_text}: 2MB를 초과해 v1 분석에서 건너뜁니다."
            ));
            continue;
        }
        let source = match fs::read_to_string(&canonical_source) {
            Ok(source) => source,
            Err(error) => {
                diagnostics.push(format!(
                    "{relative_path_text}: 텍스트 파일을 읽을 수 없습니다: {error}"
                ));
                continue;
            }
        };
        source_file_count += 1;

        match analyze_file(language, &relative_path_text, &source) {
            Ok(file_analysis) => {
                symbols.extend(file_analysis.symbols);
                raw_calls.extend(file_analysis.calls);
                diagnostics.extend(file_analysis.diagnostics);
            }
            Err(error) => diagnostics.push(format!("{relative_path_text}: {error}")),
        }
    }

    let edges = resolve_calls(&symbols, &raw_calls);
    Ok(RepositoryAnalysis {
        source_file_count,
        symbols,
        edges,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::analyze_repository;

    fn temporary_repository() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "code-graph-notebook-indexer-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("temporary repository directory");
        let output = Command::new("git")
            .arg("-C")
            .arg(&directory)
            .args(["init", "--initial-branch", "main"])
            .output()
            .expect("git is available");
        assert!(output.status.success());
        directory
    }

    #[test]
    fn indexes_supported_files_and_respects_gitignore() {
        let repository = temporary_repository();
        fs::write(repository.join(".gitignore"), "ignored.py\n").expect("ignore fixture");
        fs::write(
            repository.join("Checkout.java"),
            "class Checkout { void execute() { validate(); } void validate() {} }",
        )
        .expect("java fixture");
        fs::write(
            repository.join("helper.py"),
            "def helper():\n    return None\n",
        )
        .expect("python fixture");
        fs::write(
            repository.join("Payment.php"),
            "<?php class Payment { public function charge(): void {} }\n",
        )
        .expect("PHP fixture");
        fs::write(
            repository.join("service.ts"),
            "export function load(): void { finish(); }\nfunction finish(): void {}\n",
        )
        .expect("typescript fixture");
        fs::write(
            repository.join("Widget.tsx"),
            "export function Widget() { return <div />; }\n",
        )
        .expect("tsx fixture");
        fs::write(
            repository.join("ignored.py"),
            "def should_not_appear():\n    return None\n",
        )
        .expect("ignored fixture");
        fs::write(repository.join("README.md"), "not source").expect("other fixture");

        let analysis = analyze_repository(repository.to_str().expect("UTF-8 repository path"))
            .expect("repository analysis");

        assert_eq!(analysis.source_file_count, 5);
        assert!(analysis
            .symbols
            .iter()
            .all(|symbol| symbol.relative_path != "ignored.py"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "Checkout.execute"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "helper.helper"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "Payment.Payment.charge"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "service.load"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "Widget.Widget"));

        fs::remove_dir_all(repository).expect("temporary repository cleanup");
    }
}
