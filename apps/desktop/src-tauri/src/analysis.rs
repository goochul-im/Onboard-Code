use std::collections::HashMap;

use serde::Serialize;
use tree_sitter::{Language, Node, Parser};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceLanguage {
    Java,
    Php,
    Python,
    TypeScript,
}

impl SourceLanguage {
    pub fn from_relative_path(path: &str) -> Option<Self> {
        if path.ends_with(".java") {
            Some(Self::Java)
        } else if path.ends_with(".php") {
            Some(Self::Php)
        } else if path.ends_with(".py") {
            Some(Self::Python)
        } else if path.ends_with(".ts")
            || path.ends_with(".tsx")
            || path.ends_with(".mts")
            || path.ends_with(".cts")
        {
            Some(Self::TypeScript)
        } else {
            None
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Java => "java",
            Self::Php => "php",
            Self::Python => "python",
            Self::TypeScript => "typescript",
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
    pub receiver_type: Option<String>,
    pub receiver_module: Option<String>,
    pub source_line: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TypeScriptTypeBinding {
    type_name: String,
    module_specifier: Option<String>,
}

struct TypeScriptAnalysisContext<'a> {
    source: &'a str,
    relative_path: &'a str,
    module_name: &'a str,
    imports: &'a HashMap<String, TypeScriptTypeBinding>,
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
        SourceLanguage::Php => tree_sitter_php::LANGUAGE_PHP.into(),
        SourceLanguage::Python => tree_sitter_python::LANGUAGE.into(),
        SourceLanguage::TypeScript if relative_path.ends_with(".tsx") => {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        }
        SourceLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
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
        SourceLanguage::Php => collect_php_declarations(
            root,
            source,
            relative_path,
            &php_namespace_or_module(root, source, relative_path),
            &mut Vec::new(),
            &mut analysis,
        ),
        SourceLanguage::Python => collect_python_declarations(
            root,
            source,
            relative_path,
            &python_module_name(relative_path),
            &mut Vec::new(),
            &mut analysis,
        ),
        SourceLanguage::TypeScript => {
            let imports = collect_typescript_imports(root, source);
            let module_name = typescript_module_name(relative_path);
            let context = TypeScriptAnalysisContext {
                source,
                relative_path,
                module_name: &module_name,
                imports: &imports,
            };
            collect_typescript_declarations(
                root,
                &context,
                &mut Vec::new(),
                &HashMap::new(),
                &mut analysis,
            );
        }
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
            let caller = by_id.get(call.caller_symbol_id.as_str()).copied();
            let same_scope = caller
                .map(|caller| parent_scope(&caller.fqn))
                .map(|scope| {
                    symbols
                        .iter()
                        .filter(|symbol| {
                            symbol.language == call.language
                                && symbol_name_matches(
                                    &call.language,
                                    simple_name(&symbol.fqn),
                                    &call.target_name,
                                )
                                && parent_scope(&symbol.fqn) == scope
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let same_file = if call.language == SourceLanguage::Php {
                caller
                    .map(|caller| {
                        symbols
                            .iter()
                            .filter(|symbol| {
                                symbol.language == call.language
                                    && symbol.relative_path == caller.relative_path
                                    && symbol_name_matches(
                                        &call.language,
                                        simple_name(&symbol.fqn),
                                        &call.target_name,
                                    )
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            } else {
                caller
                    .and_then(|caller| {
                        by_file_and_name
                            .get(&(
                                &call.language,
                                caller.relative_path.as_str(),
                                call.target_name.as_str(),
                            ))
                            .cloned()
                    })
                    .unwrap_or_default()
            };
            let global = if call.language == SourceLanguage::Php {
                symbols
                    .iter()
                    .filter(|symbol| {
                        symbol.language == call.language
                            && symbol_name_matches(
                                &call.language,
                                simple_name(&symbol.fqn),
                                &call.target_name,
                            )
                    })
                    .collect::<Vec<_>>()
            } else {
                by_name
                    .get(&(&call.language, call.target_name.as_str()))
                    .cloned()
                    .unwrap_or_default()
            };

            let typed_receiver_candidates = call.receiver_type.as_deref().map(|receiver_type| {
                let by_type = global
                    .iter()
                    .copied()
                    .filter(|symbol| {
                        symbol_name_matches(
                            &call.language,
                            symbol_owner_name(&symbol.fqn),
                            receiver_type,
                        )
                    })
                    .collect::<Vec<_>>();
                let by_import = call
                    .receiver_module
                    .as_deref()
                    .zip(caller)
                    .map(|(module_specifier, caller)| {
                        by_type
                            .iter()
                            .copied()
                            .filter(|symbol| {
                                typescript_import_matches(
                                    &caller.relative_path,
                                    &symbol.relative_path,
                                    module_specifier,
                                )
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if by_import.is_empty() {
                    by_type
                } else {
                    by_import
                }
            });

            let candidates = if let Some(candidates) = typed_receiver_candidates {
                candidates
            } else if !same_scope.is_empty() {
                same_scope
            } else if !call.is_qualified && !same_file.is_empty() {
                same_file
            } else {
                global
            };

            if candidates.len() == 1
                && (call.receiver_type.is_some()
                    || !call.is_qualified
                    || is_self_reference(&call.display_target))
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
        | "record_declaration"
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

fn collect_php_declarations(
    node: Node<'_>,
    source: &str,
    relative_path: &str,
    namespace: &str,
    scopes: &mut Vec<String>,
    analysis: &mut FileAnalysis,
) {
    match node.kind() {
        "class_declaration"
        | "interface_declaration"
        | "trait_declaration"
        | "enum_declaration" => {
            if let Some(name) = declaration_name(node, source) {
                scopes.push(name);
                walk_children(node, |child| {
                    collect_php_declarations(
                        child,
                        source,
                        relative_path,
                        namespace,
                        scopes,
                        analysis,
                    )
                });
                scopes.pop();
            }
        }
        "function_definition" | "method_declaration" => {
            let Some(name) = declaration_name(node, source) else {
                analysis.diagnostics.push(format!(
                    "{relative_path}: PHP 함수 이름을 읽을 수 없습니다."
                ));
                return;
            };
            let signature = declaration_signature(node, source, "parameters");
            let fqn = qualified_name(namespace, scopes, &name);
            let symbol = build_symbol(
                SourceLanguage::Php,
                if node.kind() == "method_declaration" {
                    "method"
                } else {
                    "function"
                },
                fqn,
                signature,
                relative_path,
                node,
                source,
            );
            if let Some(body) = node.child_by_field_name("body") {
                collect_php_calls(body, source, &symbol, &mut analysis.calls, true);
            }
            analysis.symbols.push(symbol);

            scopes.push(name);
            if let Some(body) = node.child_by_field_name("body") {
                walk_children(body, |child| {
                    collect_php_declarations(
                        child,
                        source,
                        relative_path,
                        namespace,
                        scopes,
                        analysis,
                    )
                });
            }
            scopes.pop();
        }
        _ => walk_children(node, |child| {
            collect_php_declarations(child, source, relative_path, namespace, scopes, analysis)
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

fn collect_typescript_imports(
    root: Node<'_>,
    source: &str,
) -> HashMap<String, TypeScriptTypeBinding> {
    let mut imports = HashMap::new();
    collect_typescript_imports_from_node(root, source, &mut imports);
    imports
}

fn collect_typescript_imports_from_node(
    node: Node<'_>,
    source: &str,
    imports: &mut HashMap<String, TypeScriptTypeBinding>,
) {
    if node.kind() == "import_statement" {
        let Some(source_node) = node.child_by_field_name("source") else {
            return;
        };
        let module_specifier = node_text(source_node, source)
            .trim_matches(['\'', '"'])
            .to_owned();
        walk_children(node, |child| {
            if child.kind() == "import_clause" {
                collect_typescript_import_clause(child, source, &module_specifier, imports);
            }
        });
        return;
    }
    walk_children(node, |child| {
        collect_typescript_imports_from_node(child, source, imports)
    });
}

fn collect_typescript_import_clause(
    clause: Node<'_>,
    source: &str,
    module_specifier: &str,
    imports: &mut HashMap<String, TypeScriptTypeBinding>,
) {
    walk_children(clause, |child| match child.kind() {
        "identifier" => {
            let local_name = node_text(child, source).to_owned();
            imports.insert(
                local_name.clone(),
                TypeScriptTypeBinding {
                    type_name: local_name,
                    module_specifier: Some(module_specifier.to_owned()),
                },
            );
        }
        "named_imports" => walk_children(child, |specifier| {
            if specifier.kind() != "import_specifier" {
                return;
            }
            let Some(name_node) = specifier.child_by_field_name("name") else {
                return;
            };
            let imported_name = node_text(name_node, source)
                .trim_matches(['\'', '"'])
                .to_owned();
            let local_name = specifier
                .child_by_field_name("alias")
                .map(|alias| node_text(alias, source).to_owned())
                .unwrap_or_else(|| imported_name.clone());
            imports.insert(
                local_name,
                TypeScriptTypeBinding {
                    type_name: imported_name,
                    module_specifier: Some(module_specifier.to_owned()),
                },
            );
        }),
        _ => {}
    });
}

fn collect_typescript_member_types(
    class_node: Node<'_>,
    source: &str,
    imports: &HashMap<String, TypeScriptTypeBinding>,
) -> HashMap<String, TypeScriptTypeBinding> {
    let mut member_types = HashMap::new();
    collect_typescript_member_types_from_node(
        class_node,
        class_node.id(),
        source,
        imports,
        &mut member_types,
    );
    member_types
}

fn collect_typescript_member_types_from_node(
    node: Node<'_>,
    root_class_id: usize,
    source: &str,
    imports: &HashMap<String, TypeScriptTypeBinding>,
    member_types: &mut HashMap<String, TypeScriptTypeBinding>,
) {
    if node.id() != root_class_id && matches!(node.kind(), "class_declaration" | "class") {
        return;
    }
    if node.kind() == "public_field_definition" {
        collect_typescript_typed_binding(node, source, imports, member_types);
    } else if node.kind() == "method_definition"
        && declaration_name(node, source).as_deref() == Some("constructor")
    {
        if let Some(parameters) = node.child_by_field_name("parameters") {
            walk_children(parameters, |parameter| {
                if matches!(
                    parameter.kind(),
                    "required_parameter" | "optional_parameter"
                ) && is_typescript_parameter_property(parameter, source)
                {
                    collect_typescript_typed_binding(parameter, source, imports, member_types);
                }
            });
        }
        return;
    }
    walk_children(node, |child| {
        collect_typescript_member_types_from_node(
            child,
            root_class_id,
            source,
            imports,
            member_types,
        )
    });
}

fn collect_typescript_typed_binding(
    node: Node<'_>,
    source: &str,
    imports: &HashMap<String, TypeScriptTypeBinding>,
    member_types: &mut HashMap<String, TypeScriptTypeBinding>,
) {
    let Some(name_node) = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("pattern"))
    else {
        return;
    };
    let Some(type_node) = node.child_by_field_name("type") else {
        return;
    };
    let Some(local_type_name) = find_typescript_type_identifier(type_node, source) else {
        return;
    };
    let binding = imports
        .get(&local_type_name)
        .cloned()
        .unwrap_or(TypeScriptTypeBinding {
            type_name: local_type_name,
            module_specifier: None,
        });
    member_types.insert(node_text(name_node, source).to_owned(), binding);
}

fn find_typescript_type_identifier(node: Node<'_>, source: &str) -> Option<String> {
    if matches!(node.kind(), "type_identifier" | "identifier") {
        return Some(node_text(node, source).to_owned());
    }
    let mut result = None;
    walk_children(node, |child| {
        if result.is_none() {
            result = find_typescript_type_identifier(child, source);
        }
    });
    result
}

fn is_typescript_parameter_property(node: Node<'_>, source: &str) -> bool {
    let mut has_accessibility_modifier = false;
    walk_children(node, |child| {
        if child.kind() == "accessibility_modifier" {
            has_accessibility_modifier = true;
        }
    });
    has_accessibility_modifier
        || node_text(node, source)
            .split_whitespace()
            .any(|part| part == "readonly")
}

fn typescript_receiver_binding(
    target_node: Node<'_>,
    source: &str,
    member_types: &HashMap<String, TypeScriptTypeBinding>,
) -> Option<TypeScriptTypeBinding> {
    if target_node.kind() != "member_expression" {
        return None;
    }
    let receiver = target_node.child_by_field_name("object")?;
    if receiver.kind() != "member_expression" {
        return None;
    }
    let receiver_root = receiver.child_by_field_name("object")?;
    if node_text(receiver_root, source).trim() != "this" {
        return None;
    }
    let property = receiver.child_by_field_name("property")?;
    member_types
        .get(node_text(property, source).trim())
        .cloned()
}

fn collect_typescript_declarations(
    node: Node<'_>,
    context: &TypeScriptAnalysisContext<'_>,
    scopes: &mut Vec<String>,
    member_types: &HashMap<String, TypeScriptTypeBinding>,
    analysis: &mut FileAnalysis,
) {
    match node.kind() {
        "class_declaration" | "class" => {
            let class_member_types =
                collect_typescript_member_types(node, context.source, context.imports);
            if let Some(name) = declaration_name(node, context.source) {
                scopes.push(name);
                walk_children(node, |child| {
                    collect_typescript_declarations(
                        child,
                        context,
                        scopes,
                        &class_member_types,
                        analysis,
                    )
                });
                scopes.pop();
            } else {
                walk_children(node, |child| {
                    collect_typescript_declarations(
                        child,
                        context,
                        scopes,
                        &class_member_types,
                        analysis,
                    )
                });
            }
        }
        "function_declaration" | "generator_function_declaration" | "method_definition" => {
            let Some(name) = declaration_name(node, context.source) else {
                analysis.diagnostics.push(format!(
                    "{}: TypeScript 함수 이름을 읽을 수 없습니다.",
                    context.relative_path
                ));
                return;
            };
            record_typescript_function(node, &name, context, scopes, member_types, analysis);

            scopes.push(name);
            if let Some(body) = node.child_by_field_name("body") {
                walk_children(body, |child| {
                    collect_typescript_declarations(child, context, scopes, member_types, analysis)
                });
            }
            scopes.pop();
        }
        "variable_declarator" | "public_field_definition" => {
            let value = node.child_by_field_name("value");
            let is_function = value.is_some_and(|value| {
                matches!(value.kind(), "arrow_function" | "function_expression")
            });
            if is_function {
                if let Some(name) = declaration_name(node, context.source) {
                    record_typescript_function(
                        node,
                        &name,
                        context,
                        scopes,
                        member_types,
                        analysis,
                    );
                    scopes.push(name);
                    if let Some(body) = value.and_then(|value| value.child_by_field_name("body")) {
                        walk_children(body, |child| {
                            collect_typescript_declarations(
                                child,
                                context,
                                scopes,
                                member_types,
                                analysis,
                            )
                        });
                    }
                    scopes.pop();
                }
            } else {
                walk_children(node, |child| {
                    collect_typescript_declarations(child, context, scopes, member_types, analysis)
                });
            }
        }
        _ => walk_children(node, |child| {
            collect_typescript_declarations(child, context, scopes, member_types, analysis)
        }),
    }
}

fn record_typescript_function(
    node: Node<'_>,
    name: &str,
    context: &TypeScriptAnalysisContext<'_>,
    scopes: &[String],
    member_types: &HashMap<String, TypeScriptTypeBinding>,
    analysis: &mut FileAnalysis,
) {
    let function_node = node
        .child_by_field_name("value")
        .filter(|value| matches!(value.kind(), "arrow_function" | "function_expression"))
        .unwrap_or(node);
    let signature = function_node
        .child_by_field_name("parameters")
        .map(|parameters| normalize_signature(node_text(parameters, context.source)))
        .or_else(|| {
            function_node
                .child_by_field_name("parameter")
                .map(|parameter| {
                    format!(
                        "({})",
                        normalize_signature(node_text(parameter, context.source))
                    )
                })
        })
        .unwrap_or_else(|| "()".into());
    let fqn = qualified_name(context.module_name, scopes, name);
    let symbol = build_symbol(
        SourceLanguage::TypeScript,
        if node.kind() == "method_definition" || node.kind() == "public_field_definition" {
            "method"
        } else {
            "function"
        },
        fqn,
        signature,
        context.relative_path,
        node,
        context.source,
    );
    collect_typescript_calls(
        function_node
            .child_by_field_name("body")
            .unwrap_or(function_node),
        context.source,
        &symbol,
        &mut analysis.calls,
        member_types,
        true,
    );
    analysis.symbols.push(symbol);
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
                receiver_type: None,
                receiver_module: None,
                source_line: node.start_position().row as u32 + 1,
            });
        }
    }

    walk_children(node, |child| {
        collect_java_calls(child, source, caller, calls)
    });
}

fn collect_php_calls(
    node: Node<'_>,
    source: &str,
    caller: &IndexedSymbol,
    calls: &mut Vec<RawCall>,
    is_root: bool,
) {
    if !is_root
        && matches!(
            node.kind(),
            "function_definition"
                | "method_declaration"
                | "anonymous_function_creation_expression"
                | "arrow_function"
        )
    {
        return;
    }

    let call_target = match node.kind() {
        "function_call_expression" => node.child_by_field_name("function").map(|target| {
            let display_target = node_text(target, source).trim().to_owned();
            let target_name = php_simple_name(&display_target).to_owned();
            (target_name, display_target, target.kind() != "name", None)
        }),
        "member_call_expression" | "nullsafe_member_call_expression" => {
            node.child_by_field_name("name").map(|name| {
                let target_name = node_text(name, source).trim().to_owned();
                let object = node
                    .child_by_field_name("object")
                    .map(|object| node_text(object, source).trim())
                    .unwrap_or_default();
                (
                    target_name.clone(),
                    format!("{object}->{target_name}"),
                    true,
                    None,
                )
            })
        }
        "scoped_call_expression" => node.child_by_field_name("name").map(|name| {
            let target_name = node_text(name, source).trim().to_owned();
            let scope = node
                .child_by_field_name("scope")
                .map(|scope| node_text(scope, source).trim())
                .unwrap_or_default();
            let receiver_type = if matches!(
                scope.to_ascii_lowercase().as_str(),
                "self" | "static" | "parent"
            ) {
                None
            } else {
                Some(php_simple_name(scope).to_owned())
            };
            (
                target_name.clone(),
                format!("{scope}::{target_name}"),
                true,
                receiver_type,
            )
        }),
        _ => None,
    };

    if let Some((target_name, display_target, is_qualified, receiver_type)) = call_target {
        calls.push(RawCall {
            caller_symbol_id: caller.id.clone(),
            caller_fqn: caller.fqn.clone(),
            language: SourceLanguage::Php,
            target_name,
            display_target,
            is_qualified,
            receiver_type,
            receiver_module: None,
            source_line: node.start_position().row as u32 + 1,
        });
    }

    walk_children(node, |child| {
        collect_php_calls(child, source, caller, calls, false)
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
                receiver_type: None,
                receiver_module: None,
                source_line: node.start_position().row as u32 + 1,
            });
        }
    }

    walk_children(node, |child| {
        collect_python_calls(child, source, caller, calls, false)
    });
}

fn collect_typescript_calls(
    node: Node<'_>,
    source: &str,
    caller: &IndexedSymbol,
    calls: &mut Vec<RawCall>,
    member_types: &HashMap<String, TypeScriptTypeBinding>,
    is_root: bool,
) {
    let separately_indexed_function =
        matches!(
            node.kind(),
            "function_declaration" | "generator_function_declaration" | "method_definition"
        ) || matches!(node.kind(), "function_expression" | "arrow_function")
            && node.parent().is_some_and(|parent| {
                matches!(
                    parent.kind(),
                    "variable_declarator" | "public_field_definition"
                )
            });
    if !is_root && separately_indexed_function {
        return;
    }

    if node.kind() == "call_expression" {
        if let Some(target_node) = node.child_by_field_name("function") {
            let display_target = node_text(target_node, source).trim().to_owned();
            let target_name = display_target
                .rsplit(['.', '?'])
                .find(|part| !part.is_empty())
                .unwrap_or(&display_target)
                .to_owned();
            let receiver = typescript_receiver_binding(target_node, source, member_types);
            calls.push(RawCall {
                caller_symbol_id: caller.id.clone(),
                caller_fqn: caller.fqn.clone(),
                language: SourceLanguage::TypeScript,
                is_qualified: target_node.kind() != "identifier",
                target_name,
                display_target,
                receiver_type: receiver.as_ref().map(|binding| binding.type_name.clone()),
                receiver_module: receiver.and_then(|binding| binding.module_specifier),
                source_line: node.start_position().row as u32 + 1,
            });
        }
    }

    walk_children(node, |child| {
        collect_typescript_calls(child, source, caller, calls, member_types, false)
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

fn php_namespace_or_module(root: Node<'_>, source: &str, relative_path: &str) -> String {
    let mut namespace = None;
    walk_children(root, |node| {
        if namespace.is_none() && node.kind() == "namespace_definition" {
            namespace = node
                .child_by_field_name("name")
                .map(|name| node_text(name, source).replace('\\', "."));
        }
    });
    namespace.unwrap_or_else(|| php_module_name(relative_path))
}

fn php_module_name(relative_path: &str) -> String {
    relative_path
        .strip_suffix(".php")
        .unwrap_or(relative_path)
        .replace(['/', '\\'], ".")
}

fn php_simple_name(value: &str) -> &str {
    value
        .trim_start_matches('\\')
        .rsplit('\\')
        .next()
        .unwrap_or(value)
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
        .or_else(|| without_extension.strip_suffix("\\__init__"))
        .unwrap_or(without_extension);
    without_initializer.replace(['/', '\\'], ".")
}

fn typescript_module_name(relative_path: &str) -> String {
    let without_extension = relative_path
        .strip_suffix(".tsx")
        .or_else(|| relative_path.strip_suffix(".mts"))
        .or_else(|| relative_path.strip_suffix(".cts"))
        .or_else(|| relative_path.strip_suffix(".ts"))
        .unwrap_or(relative_path);
    let without_index = without_extension
        .strip_suffix("/index")
        .or_else(|| without_extension.strip_suffix("\\index"))
        .unwrap_or(without_extension);
    without_index.replace(['/', '\\'], ".")
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

fn symbol_owner_name(fqn: &str) -> &str {
    simple_name(parent_scope(fqn))
}

fn symbol_name_matches(language: &SourceLanguage, symbol_name: &str, target_name: &str) -> bool {
    if *language == SourceLanguage::Php {
        symbol_name.eq_ignore_ascii_case(target_name)
    } else {
        symbol_name == target_name
    }
}

fn typescript_import_matches(
    caller_path: &str,
    candidate_path: &str,
    module_specifier: &str,
) -> bool {
    if !module_specifier.starts_with('.') {
        return true;
    }
    let mut parts = caller_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.pop();
    for part in module_specifier.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }
    let expected = strip_typescript_module_extension(&parts.join("/"));
    let candidate = strip_typescript_module_extension(candidate_path);
    candidate == expected || candidate == format!("{expected}/index")
}

fn strip_typescript_module_extension(path: &str) -> String {
    [
        ".d.ts", ".d.tsx", ".d.mts", ".d.cts", ".tsx", ".mts", ".cts", ".ts", ".jsx", ".mjs",
        ".cjs", ".js",
    ]
    .iter()
    .find_map(|extension| path.strip_suffix(extension))
    .unwrap_or(path)
    .to_owned()
}

fn is_self_reference(target: &str) -> bool {
    target.starts_with("self.")
        || target.starts_with("cls.")
        || target.starts_with("this.")
        || target.starts_with("this?.")
        || target.starts_with("super.")
        || target.starts_with("$this->")
        || target.starts_with("self::")
        || target.starts_with("static::")
        || target.starts_with("parent::")
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
    use super::{
        analyze_file, python_module_name, resolve_calls, typescript_module_name, EdgeConfidence,
        SourceLanguage,
    };

    #[test]
    fn omits_python_initializer_from_module_name() {
        assert_eq!(python_module_name("package/__init__.py"), "package");
        assert_eq!(python_module_name("package/module.py"), "package.module");
    }

    #[test]
    fn normalizes_typescript_module_names() {
        assert_eq!(
            typescript_module_name("src/services/user.ts"),
            "src.services.user"
        );
        assert_eq!(
            typescript_module_name("src/components/index.tsx"),
            "src.components"
        );
    }

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
    fn extracts_and_resolves_php_functions_and_methods() {
        let source = r#"<?php
namespace App\Service;

class OrderService {
    public function execute(int $id): void {
        $this->validate($id);
        Helper::notify();
    }

    private function validate(int $id): void {}
}

class Helper {
    public static function notify(): void {}
}

function boot(): void {
    HELPER_FN();
}

function helper_fn(): void {}
"#;
        let analysis = analyze_file(SourceLanguage::Php, "src/OrderService.php", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert!(analysis.diagnostics.is_empty());
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "App.Service.OrderService.execute"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "App.Service.helper_fn"));
        assert_eq!(analysis.calls.len(), 3);
        assert!(edges
            .iter()
            .all(|edge| edge.confidence == EdgeConfidence::Resolved));
        assert!(edges.iter().any(|edge| {
            analysis.symbols.iter().any(|symbol| {
                edge.callee_symbol_id.as_deref() == Some(symbol.id.as_str())
                    && symbol.fqn == "App.Service.Helper.notify"
            })
        }));
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

    #[test]
    fn extracts_typescript_functions_methods_and_arrow_functions() {
        let source = r#"
export function bootstrap(name: string): void {
    const prepare = (value: string) => normalize(value);
    prepare(name);
}

function normalize(value: string): string {
    return value.trim();
}

class UserService {
    load(id: number): string {
        return this.find(id);
    }

    find(id: number): string {
        return String(id);
    }
}
        "#;
        let analysis =
            analyze_file(SourceLanguage::TypeScript, "src/user-service.ts", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "src.user-service.bootstrap"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "src.user-service.bootstrap.prepare"));
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "src.user-service.UserService.load"));
        assert!(edges.iter().any(|edge| {
            edge.confidence == EdgeConfidence::Resolved
                && analysis.symbols.iter().any(|symbol| {
                    edge.callee_symbol_id.as_deref() == Some(symbol.id.as_str())
                        && symbol.fqn == "src.user-service.UserService.find"
                })
        }));
    }

    #[test]
    fn resolves_typescript_constructor_injected_receiver_through_its_import() {
        let controller = analyze_file(
            SourceLanguage::TypeScript,
            "src/achievement-cluster/achievement-cluster.controller.ts",
            r#"
import { AchievementClusterService } from './achievement-cluster.service';

export class AchievementClusterController {
    constructor(private readonly service: AchievementClusterService) {}

    deleteAll() {
        return this.service.deleteAllVector();
    }
}
            "#,
        )
        .unwrap();
        let service = analyze_file(
            SourceLanguage::TypeScript,
            "src/achievement-cluster/achievement-cluster.service.ts",
            r#"
export class AchievementClusterService {
    async deleteAllVector() {}
}
            "#,
        )
        .unwrap();
        let duplicate = analyze_file(
            SourceLanguage::TypeScript,
            "src/legacy/achievement-cluster.service.ts",
            r#"
export class AchievementClusterService {
    async deleteAllVector() {}
}
            "#,
        )
        .unwrap();

        let symbols = controller
            .symbols
            .iter()
            .chain(service.symbols.iter())
            .chain(duplicate.symbols.iter())
            .cloned()
            .collect::<Vec<_>>();
        let call = controller
            .calls
            .iter()
            .find(|call| call.target_name == "deleteAllVector")
            .expect("controller call is collected");
        assert_eq!(
            call.receiver_type.as_deref(),
            Some("AchievementClusterService")
        );
        assert_eq!(
            call.receiver_module.as_deref(),
            Some("./achievement-cluster.service")
        );

        let edge = resolve_calls(&symbols, &controller.calls)
            .into_iter()
            .find(|edge| edge.caller_symbol_id == call.caller_symbol_id)
            .expect("controller edge is resolved");
        let target = symbols
            .iter()
            .find(|symbol| edge.callee_symbol_id.as_deref() == Some(symbol.id.as_str()))
            .expect("resolved target exists");

        assert_eq!(edge.confidence, EdgeConfidence::Resolved);
        assert_eq!(
            target.fqn,
            "src.achievement-cluster.achievement-cluster.service.AchievementClusterService.deleteAllVector"
        );
    }

    #[test]
    fn parses_tsx_with_the_tsx_grammar() {
        let source = r#"
export function Greeting({ name }: { name: string }) {
    return <section onClick={() => track(name)}>Hello {name}</section>;
}

function track(name: string): void {
    console.log(name);
}
        "#;
        let analysis = analyze_file(SourceLanguage::TypeScript, "Greeting.tsx", source).unwrap();
        let edges = resolve_calls(&analysis.symbols, &analysis.calls);

        assert!(analysis.diagnostics.is_empty());
        assert!(analysis
            .symbols
            .iter()
            .any(|symbol| symbol.fqn == "Greeting.Greeting"));
        assert!(edges
            .iter()
            .any(|edge| edge.confidence == EdgeConfidence::Resolved));
    }
}
