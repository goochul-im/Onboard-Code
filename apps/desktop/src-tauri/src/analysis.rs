use std::collections::HashMap;

use serde::Serialize;
use tree_sitter::{Language, Node, Parser};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceLanguage {
    Java,
    Python,
}

impl SourceLanguage {
    pub fn from_relative_path(path: &str) -> Option<Self> {
        if path.ends_with(".java") {
            Some(Self::Java)
        } else if path.ends_with(".py") {
            Some(Self::Python)
        } else {
            None
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Java => "java",
            Self::Python => "python",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeConfidence {
    Resolved,
    Ambiguous,
    Unresolved,
}

impl EdgeConfidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::Ambiguous => "ambiguous",
            Self::Unresolved => "unresolved",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedSymbol {
    pub id: String,
    pub language: SourceLanguage,
    pub kind: String,
    pub fqn: String,
    pub signature: String,
    pub relative_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub ast_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawCall {
    pub caller_symbol_id: String,
    pub caller_fqn: String,
    pub language: SourceLanguage,
    pub target_name: String,
    pub display_target: String,
    pub is_qualified: bool,
    pub source_line: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEdge {
    pub caller_symbol_id: String,
    pub callee_symbol_id: Option<String>,
    pub unresolved_name: Option<String>,
    pub confidence: EdgeConfidence,
    pub source_line: u32,
}

#[derive(Clone, Debug, Default)]
pub struct FileAnalysis {
    pub symbols: Vec<IndexedSymbol>,
    pub calls: Vec<RawCall>,
    pub diagnostics: Vec<String>,
}

pub fn analyze_file(
    language: SourceLanguage,
    relative_path: &str,
    source: &str,
) -> Result<FileAnalysis, String> {
    let mut parser = Parser::new();
    let grammar: Language = match language {
        SourceLanguage::Java => tree_sitter_java::LANGUAGE.into(),
        SourceLanguage::Python => tree_sitter_python::LANGUAGE.into(),
    };
    parser
        .set_language(&grammar)
        .map_err(|error| format!("파서를 초기화할 수 없습니다: {error}"))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "소스 파일을 파싱할 수 없습니다.".to_owned())?;
    let mut analysis = FileAnalysis::default();
    let root = tree.root_node();

    if root.has_error() {
        analysis.diagnostics.push(format!(
            "{relative_path}: 구문 오류가 있어 일부 결과가 부정확할 수 있습니다."
        ));
    }

    match language {
        SourceLanguage::Java => {
            let package_name = find_java_package(root, source);
            collect_java_declarations(
                root,
                source,
                relative_path,
                &package_name,
                &mut Vec::new(),
                &mut analysis,
            );
        }
        SourceLanguage::Python => collect_python_declarations(
            root,
            source,
            relative_path,
            &python_module_name(relative_path),
            &mut Vec::new(),
            &mut analysis,
        ),
    }

    Ok(analysis)
}

pub fn resolve_calls(symbols: &[IndexedSymbol], calls: &[RawCall]) -> Vec<IndexedEdge> {
    let mut by_name: HashMap<(&SourceLanguage, &str), Vec<&IndexedSymbol>> = HashMap::new();
    let mut by_file_and_name: HashMap<(&SourceLanguage, &str, &str), Vec<&IndexedSymbol>> =
        HashMap::new();
    let mut by_id: HashMap<&str, &IndexedSymbol> = HashMap::new();

    for symbol in symbols {
        by_name
            .entry((&symbol.language, simple_name(&symbol.fqn)))
            .or_default()
            .push(symbol);
        by_file_and_name
            .entry((
                &symbol.language,
                &symbol.relative_path,
                simple_name(&symbol.fqn),
            ))
            .or_default()
            .push(symbol);
        by_id.insert(&symbol.id, symbol);
    }

    calls
        .iter()
        .map(|call| {
            let same_scope = by_id
                .get(call.caller_symbol_id.as_str())
                .map(|caller| parent_scope(&caller.fqn))
                .map(|scope| {
                    symbols
                        .iter()
                        .filter(|symbol| {
                            symbol.language == call.language
                                && simple_name(&symbol.fqn) == call.target_name
                                && parent_scope(&symbol.fqn) == scope
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let same_file = by_id
                .get(call.caller_symbol_id.as_str())
                .and_then(|caller| {
                    by_file_and_name
                        .get(&(
                            &call.language,
                            caller.relative_path.as_str(),
                            call.target_name.as_str(),
                        ))
                        .cloned()
                })
                .unwrap_or_default();
            let global = by_name
                .get(&(&call.language, call.target_name.as_str()))
                .cloned()
                .unwrap_or_default();

            let candidates = if !same_scope.is_empty() {
                same_scope
            } else if !call.is_qualified && !same_file.is_empty() {
                same_file
            } else {
                global
            };

            if candidates.len() == 1
                && (!call.is_qualified || is_self_reference(&call.display_target))
            {
                IndexedEdge {
                    caller_symbol_id: call.caller_symbol_id.clone(),
                    callee_symbol_id: Some(candidates[0].id.clone()),
                    unresolved_name: None,
                    confidence: EdgeConfidence::Resolved,
                    source_line: call.source_line,
                }
            } else if candidates.is_empty() {
                IndexedEdge {
                    caller_symbol_id: call.caller_symbol_id.clone(),
                    callee_symbol_id: None,
                    unresolved_name: Some(call.display_target.clone()),
                    confidence: EdgeConfidence::Unresolved,
                    source_line: call.source_line,
                }
            } else {
                IndexedEdge {
                    caller_symbol_id: call.caller_symbol_id.clone(),
                    callee_symbol_id: None,
                    unresolved_name: Some(call.display_target.clone()),
                    confidence: EdgeConfidence::Ambiguous,
                    source_line: call.source_line,
                }
            }
        })
        .collect()
}

fn collect_java_declarations(
    node: Node<'_>,
    source: &str,
    relative_path: &str,
    package_name: &str,
    scopes: &mut Vec<String>,
    analysis: &mut FileAnalysis,
) {
    match node.kind() {
        "class_declaration"
        | "interface_declaration"
        | "enum_declaration"
        | "annotation_type_declaration" => {
            if let Some(name) = declaration_name(node, source) {
                scopes.push(name);
                walk_children(node, |child| {
                    collect_java_declarations(
                        child,
                        source,
                        relative_path,
                        package_name,
                        scopes,
                        analysis,
                    )
                });
                scopes.pop();
            }
        }
        "method_declaration" | "constructor_declaration" => {
            let Some(name) = declaration_name(node, source) else {
                analysis.diagnostics.push(format!(
                    "{relative_path}: Java 메서드 이름을 읽을 수 없습니다."
                ));
                return;
            };
            let signature = declaration_signature(node, source, "parameters");
            let fqn = qualified_name(package_name, scopes, &name);
            let symbol = build_symbol(
                SourceLanguage::Java,
                "method",
                fqn,
                signature,
                relative_path,
                node,
                source,
            );
            collect_java_calls(
                node.child_by_field_name("body").unwrap_or(node),
                source,
                &symbol,
                &mut analysis.calls,
            );
            analysis.symbols.push(symbol);
        }
        _ => walk_children(node, |child| {
            collect_java_declarations(child, source, relative_path, package_name, scopes, analysis)
        }),
    }
}

fn collect_python_declarations(
    node: Node<'_>,
    source: &str,
    relative_path: &str,
    module_name: &str,
    scopes: &mut Vec<String>,
    analysis: &mut FileAnalysis,
) {
    match node.kind() {
        "class_definition" => {
            if let Some(name) = declaration_name(node, source) {
                scopes.push(name);
                walk_children(node, |child| {
                    collect_python_declarations(
                        child,
                        source,
                        relative_path,
                        module_name,
                        scopes,
                        analysis,
                    )
                });
                scopes.pop();
            }
        }
        "function_definition" => {
            let Some(name) = declaration_name(node, source) else {
                analysis.diagnostics.push(format!(
                    "{relative_path}: Python 함수 이름을 읽을 수 없습니다."
                ));
                return;
            };
            let signature = declaration_signature(node, source, "parameters");
            let fqn = qualified_name(module_name, scopes, &name);
            let symbol = build_symbol(
                SourceLanguage::Python,
                "function",
                fqn,
                signature,
                relative_path,
                node,
                source,
            );
            collect_python_calls(
                node.child_by_field_name("body").unwrap_or(node),
                source,
                &symbol,
                &mut analysis.calls,
                true,
            );
            analysis.symbols.push(symbol);

            scopes.push(name);
            walk_children(node, |child| {
                collect_python_declarations(
                    child,
                    source,
                    relative_path,
                    module_name,
                    scopes,
                    analysis,
                )
            });
            scopes.pop();
        }
        _ => walk_children(node, |child| {
            collect_python_declarations(child, source, relative_path, module_name, scopes, analysis)
        }),
    }
}

fn collect_java_calls(
    node: Node<'_>,
    source: &str,
    caller: &IndexedSymbol,
    calls: &mut Vec<RawCall>,
) {
    if node.kind() == "method_invocation" {
        if let Some(name_node) = node.child_by_field_name("name") {
            let target_name = node_text(name_node, source).to_owned();
            let display_target = node_text(node, source)
                .split('(')
                .next()
                .unwrap_or(&target_name)
                .trim()
                .to_owned();
            calls.push(RawCall {
                caller_symbol_id: caller.id.clone(),
                caller_fqn: caller.fqn.clone(),
                language: SourceLanguage::Java,
                target_name,
                is_qualified: node.child_by_field_name("object").is_some(),
                display_target,
                source_line: node.start_position().row as u32 + 1,
            });
        }
    }

    walk_children(node, |child| {
        collect_java_calls(child, source, caller, calls)
    });
}

fn collect_python_calls(
    node: Node<'_>,
    source: &str,
    caller: &IndexedSymbol,
    calls: &mut Vec<RawCall>,
    is_root: bool,
) {
    if !is_root && node.kind() == "function_definition" {
        return;
    }

    if node.kind() == "call" {
        if let Some(target_node) = node.child_by_field_name("function") {
            let display_target = node_text(target_node, source).trim().to_owned();
            let target_name = display_target
                .rsplit('.')
                .next()
                .unwrap_or(&display_target)
                .to_owned();
            calls.push(RawCall {
                caller_symbol_id: caller.id.clone(),
                caller_fqn: caller.fqn.clone(),
                language: SourceLanguage::Python,
                is_qualified: target_node.kind() != "identifier",
                target_name,
                display_target,
                source_line: node.start_position().row as u32 + 1,
            });
        }
    }

    walk_children(node, |child| {
        collect_python_calls(child, source, caller, calls, false)
    });
}

fn find_java_package(root: Node<'_>, source: &str) -> String {
    let mut package = String::new();
    walk_children(root, |node| {
        if package.is_empty() && node.kind() == "package_declaration" {
            package = node_text(node, source)
                .trim_start_matches("package")
                .trim_end_matches(';')
                .trim()
                .to_owned();
        }
    });
    package
}

fn declaration_name(node: Node<'_>, source: &str) -> Option<String> {
    node.child_by_field_name("name")
        .map(|name| node_text(name, source).to_owned())
}

fn declaration_signature(node: Node<'_>, source: &str, field: &str) -> String {
    node.child_by_field_name(field)
        .map(|parameters| normalize_signature(node_text(parameters, source)))
        .unwrap_or_else(|| "()".into())
}

fn build_symbol(
    language: SourceLanguage,
    kind: &str,
    fqn: String,
    signature: String,
    relative_path: &str,
    node: Node<'_>,
    source: &str,
) -> IndexedSymbol {
    let declaration = node_text(node, source);
    let id_seed = format!("{}:{relative_path}:{fqn}:{signature}", language.as_str());

    IndexedSymbol {
        id: format!("symbol_{:016x}", stable_hash(&id_seed)),
        language,
        kind: kind.into(),
        fqn,
        signature,
        relative_path: relative_path.into(),
        start_line: node.start_position().row as u32 + 1,
        end_line: node.end_position().row as u32 + 1,
        ast_fingerprint: format!("{:016x}", stable_hash(&normalize_signature(declaration))),
    }
}

fn python_module_name(relative_path: &str) -> String {
    let without_extension = relative_path.strip_suffix(".py").unwrap_or(relative_path);
    let without_initializer = without_extension
        .strip_suffix("/__init__")
        .unwrap_or(without_extension)
        .strip_suffix("\\__init__")
        .unwrap_or(without_extension);
    without_initializer.replace(['/', '\\'], ".")
}

fn qualified_name(root: &str, scopes: &[String], name: &str) -> String {
    std::iter::once(root)
        .chain(scopes.iter().map(String::as_str))
        .chain(std::iter::once(name))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn parent_scope(fqn: &str) -> &str {
    fqn.rsplit_once('.').map(|(parent, _)| parent).unwrap_or("")
}

fn simple_name(fqn: &str) -> &str {
    fqn.rsplit('.').next().unwrap_or(fqn)
}

fn is_self_reference(target: &str) -> bool {
    target.starts_with("self.") || target.starts_with("cls.")
}

fn normalize_signature(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn node_text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    node.utf8_text(source.as_bytes()).unwrap_or_default()
}

fn walk_children(node: Node<'_>, mut visit: impl FnMut(Node<'_>)) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child);
    }
}

#[cfg(test)]
mod tests {
    use super::{analyze_file, resolve_calls, EdgeConfidence, SourceLanguage};

    #[test]
    fn extracts_and_resolves_java_methods_in_the_same_class() {
        let source = r#"
            package example;
            class Checkout {
                void execute() { validate(); service.persist(); }
                void validate() { }
            }
        "#;

        let analysis = analyze_file(SourceLanguage::Java, "src/Checkout.java", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert_eq!(analysis.symbols.len(), 2);
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "example.Checkout.execute"));
        assert_eq!(edges.len(), 2);
        assert!(edges
            .iter()
            .any(|edge| edge.confidence == EdgeConfidence::Resolved));
        assert!(edges
            .iter()
            .any(|edge| edge.confidence == EdgeConfidence::Unresolved));
    }

    #[test]
    fn extracts_nested_python_functions_without_double_counting_calls() {
        let source = r#"
class Parser:
    def parse(self):
        helper()
        self.finish()

    def finish(self):
        return None

def helper():
    def nested():
        return None
    return nested()
        "#;

        let analysis = analyze_file(SourceLanguage::Python, "parser.py", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "parser.Parser.parse"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "parser.helper.nested"));
        assert_eq!(analysis.calls.len(), 3);
        assert!(edges
            .iter()
            .any(|edge| edge.confidence == EdgeConfidence::Resolved));
    }

    #[test]
    fn marks_duplicate_targets_as_ambiguous() {
        let source = r#"
def first(receiver):
    receiver.shared()

def shared():
    return None

class Other:
    def shared(self):
        return None
        "#;
        let analysis = analyze_file(SourceLanguage::Python, "duplicate.py", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert!(edges
            .iter()
            .any(|edge| edge.confidence == EdgeConfidence::Ambiguous));
    }
}
