import { Language, Parser, type Node } from "web-tree-sitter";
import { languageFromPath, moduleNameForPath } from "./language";
import { stableHash, stableId } from "./hash";
import type {
  BrowserSourceFile,
  EdgeConfidence,
  GraphEdge,
  RawCall,
  SourceLanguage,
  SymbolRecord,
} from "./types";

export interface AnalyzeFilesResult {
  symbols: SymbolRecord[];
  edges: GraphEdge[];
  diagnostics: string[];
}

type LoadedLanguages = Partial<Record<SourceLanguage | "tsx", Language>>;

const LANGUAGE_WASM_FILES: Record<SourceLanguage | "tsx", string> = {
  java: "tree-sitter-java.wasm",
  php: "tree-sitter-php.wasm",
  python: "tree-sitter-python.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
};

let initPromise: Promise<void> | null = null;
const languages: LoadedLanguages = {};

export async function analyzeBrowserFiles(
  files: BrowserSourceFile[],
  wasmBaseUrl = `${import.meta.env.BASE_URL}wasm`,
): Promise<AnalyzeFilesResult> {
  await ensureParserReady(wasmBaseUrl);
  const symbols: SymbolRecord[] = [];
  const calls: RawCall[] = [];
  const diagnostics: string[] = [];

  for (const file of files) {
    try {
      const result = analyzeOneFile(file, wasmBaseUrl);
      symbols.push(...result.symbols);
      calls.push(...result.calls);
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      diagnostics.push(`${file.relativePath}: ${(error as Error).message}`);
    }
  }

  return { symbols, edges: resolveCalls(symbols, calls), diagnostics };
}

async function ensureParserReady(wasmBaseUrl: string): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (scriptName: string) => `${wasmBaseUrl.replace(/\/$/, "")}/${scriptName}`,
    });
  }
  await initPromise;
  await Promise.all(
    (Object.keys(LANGUAGE_WASM_FILES) as Array<SourceLanguage | "tsx">).map(async (language) => {
      if (languages[language]) return;
      languages[language] = await Language.load(
        `${wasmBaseUrl.replace(/\/$/, "")}/${LANGUAGE_WASM_FILES[language]}`,
      );
    }),
  );
}

interface FileAnalysis {
  symbols: SymbolRecord[];
  calls: RawCall[];
  diagnostics: string[];
}

function analyzeOneFile(file: BrowserSourceFile, wasmBaseUrl: string): FileAnalysis {
  const language = languageFromPath(file.relativePath) ?? file.language;
  const parser = new Parser();
  const grammarKey = language === "typescript" && file.relativePath.endsWith(".tsx") ? "tsx" : language;
  const grammar = languages[grammarKey];
  if (!grammar) throw new Error(`Tree-sitter grammar is not loaded from ${wasmBaseUrl}.`);
  parser.setLanguage(grammar);
  const tree = parser.parse(file.source);
  if (!tree) throw new Error("소스 파일을 파싱할 수 없습니다.");

  const analysis: FileAnalysis = { symbols: [], calls: [], diagnostics: [] };
  if (tree.rootNode.hasError) {
    analysis.diagnostics.push(`${file.relativePath}: 구문 오류가 있어 일부 결과가 부정확할 수 있습니다.`);
  }

  if (language === "java") {
    collectJavaDeclarations(tree.rootNode, file.source, file.relativePath, findJavaPackage(tree.rootNode), [], analysis);
  } else if (language === "python") {
    collectPythonDeclarations(
      tree.rootNode,
      file.source,
      file.relativePath,
      moduleNameForPath(file.relativePath, language),
      [],
      analysis,
    );
  } else if (language === "php") {
    collectPhpDeclarations(tree.rootNode, file.source, file.relativePath, phpNamespace(tree.rootNode, file), [], analysis);
  } else {
    collectTypeScriptDeclarations(
      tree.rootNode,
      file.source,
      file.relativePath,
      moduleNameForPath(file.relativePath, language),
      [],
      analysis,
    );
  }

  tree.delete();
  parser.delete();
  return analysis;
}

function collectJavaDeclarations(
  node: Node,
  source: string,
  relativePath: string,
  packageName: string,
  scopes: string[],
  analysis: FileAnalysis,
): void {
  if (isKind(node, ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"])) {
    const name = declarationName(node);
    if (name) {
      withScope(scopes, name, () => walk(node, (child) => collectJavaDeclarations(child, source, relativePath, packageName, scopes, analysis)));
      return;
    }
  }

  if (isKind(node, ["method_declaration", "constructor_declaration"])) {
    const name = declarationName(node);
    if (!name) {
      analysis.diagnostics.push(`${relativePath}: Java 메서드 이름을 읽을 수 없습니다.`);
      return;
    }
    const symbol = buildSymbol("java", "method", qualifiedName(packageName, scopes, name), declarationSignature(node), relativePath, node);
    collectCalls(node.childForFieldName("body") ?? node, "java", symbol, analysis.calls, true);
    analysis.symbols.push(symbol);
    return;
  }

  walk(node, (child) => collectJavaDeclarations(child, source, relativePath, packageName, scopes, analysis));
}

function collectPythonDeclarations(
  node: Node,
  source: string,
  relativePath: string,
  moduleName: string,
  scopes: string[],
  analysis: FileAnalysis,
): void {
  if (node.type === "class_definition") {
    const name = declarationName(node);
    if (name) {
      withScope(scopes, name, () => walk(node, (child) => collectPythonDeclarations(child, source, relativePath, moduleName, scopes, analysis)));
      return;
    }
  }

  if (node.type === "function_definition") {
    const name = declarationName(node);
    if (!name) {
      analysis.diagnostics.push(`${relativePath}: Python 함수 이름을 읽을 수 없습니다.`);
      return;
    }
    const symbol = buildSymbol("python", "function", qualifiedName(moduleName, scopes, name), declarationSignature(node), relativePath, node);
    collectCalls(node.childForFieldName("body") ?? node, "python", symbol, analysis.calls, true);
    analysis.symbols.push(symbol);
    withScope(scopes, name, () => walk(node, (child) => collectPythonDeclarations(child, source, relativePath, moduleName, scopes, analysis)));
    return;
  }

  walk(node, (child) => collectPythonDeclarations(child, source, relativePath, moduleName, scopes, analysis));
}

function collectPhpDeclarations(
  node: Node,
  source: string,
  relativePath: string,
  namespace: string,
  scopes: string[],
  analysis: FileAnalysis,
): void {
  if (isKind(node, ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])) {
    const name = declarationName(node);
    if (name) {
      withScope(scopes, name, () => walk(node, (child) => collectPhpDeclarations(child, source, relativePath, namespace, scopes, analysis)));
      return;
    }
  }

  if (isKind(node, ["function_definition", "method_declaration"])) {
    const name = declarationName(node);
    if (!name) {
      analysis.diagnostics.push(`${relativePath}: PHP 함수 이름을 읽을 수 없습니다.`);
      return;
    }
    const symbol = buildSymbol(
      "php",
      node.type === "method_declaration" ? "method" : "function",
      qualifiedName(namespace, scopes, name, "\\"),
      declarationSignature(node),
      relativePath,
      node,
    );
    collectCalls(node.childForFieldName("body") ?? node, "php", symbol, analysis.calls, true);
    analysis.symbols.push(symbol);
    withScope(scopes, name, () => walk(node, (child) => collectPhpDeclarations(child, source, relativePath, namespace, scopes, analysis)));
    return;
  }

  walk(node, (child) => collectPhpDeclarations(child, source, relativePath, namespace, scopes, analysis));
}

function collectTypeScriptDeclarations(
  node: Node,
  source: string,
  relativePath: string,
  moduleName: string,
  scopes: string[],
  analysis: FileAnalysis,
): void {
  if (isKind(node, ["class_declaration", "class"])) {
    const name = declarationName(node);
    if (name) {
      withScope(scopes, name, () => walk(node, (child) => collectTypeScriptDeclarations(child, source, relativePath, moduleName, scopes, analysis)));
      return;
    }
  }

  if (isKind(node, ["function_declaration", "generator_function_declaration", "method_definition"])) {
    const name = declarationName(node);
    if (!name) {
      analysis.diagnostics.push(`${relativePath}: TypeScript 함수 이름을 읽을 수 없습니다.`);
      return;
    }
    recordTypeScriptFunction(node, name, relativePath, moduleName, scopes, analysis);
    withScope(scopes, name, () => walk(node.childForFieldName("body") ?? node, (child) => collectTypeScriptDeclarations(child, source, relativePath, moduleName, scopes, analysis)));
    return;
  }

  if (isKind(node, ["variable_declarator", "public_field_definition"])) {
    const value = node.childForFieldName("value");
    if (value && isKind(value, ["arrow_function", "function_expression"])) {
      const name = declarationName(node);
      if (name) recordTypeScriptFunction(node, name, relativePath, moduleName, scopes, analysis);
      return;
    }
  }

  walk(node, (child) => collectTypeScriptDeclarations(child, source, relativePath, moduleName, scopes, analysis));
}

function recordTypeScriptFunction(
  node: Node,
  name: string,
  relativePath: string,
  moduleName: string,
  scopes: string[],
  analysis: FileAnalysis,
): void {
  const functionNode = node.childForFieldName("value") ?? node;
  const symbol = buildSymbol(
    "typescript",
    isKind(node, ["method_definition", "public_field_definition"]) ? "method" : "function",
    qualifiedName(moduleName, scopes, name),
    declarationSignature(functionNode),
    relativePath,
    node,
  );
  collectCalls(functionNode.childForFieldName("body") ?? functionNode, "typescript", symbol, analysis.calls, true);
  analysis.symbols.push(symbol);
}

function collectCalls(node: Node, language: SourceLanguage, caller: SymbolRecord, calls: RawCall[], isRoot: boolean): void {
  if (!isRoot && isDeclarationNode(node)) return;

  const call = callTarget(node, language);
  if (call) {
    calls.push({
      callerSymbolId: caller.id,
      callerFqn: caller.fqn,
      language,
      targetName: call.targetName,
      displayTarget: call.displayTarget,
      isQualified: call.isQualified,
      receiverType: null,
      receiverModule: null,
      sourceLine: node.startPosition.row + 1,
    });
  }

  walk(node, (child) => collectCalls(child, language, caller, calls, false));
}

function callTarget(
  node: Node,
  language: SourceLanguage,
): { targetName: string; displayTarget: string; isQualified: boolean } | null {
  if (language === "java" && node.type === "method_invocation") {
    const name = node.childForFieldName("name")?.text.trim();
    if (!name) return null;
    return { targetName: name, displayTarget: node.text.split("(")[0]?.trim() || name, isQualified: Boolean(node.childForFieldName("object")) };
  }

  if (language === "python" && node.type === "call") {
    const target = node.childForFieldName("function") ?? node.firstNamedChild;
    return target ? targetFromExpression(target) : null;
  }

  if (language === "php" && isKind(node, ["function_call_expression", "member_call_expression", "scoped_call_expression"])) {
    const name = node.childForFieldName("name") ?? node.childForFieldName("member") ?? node.firstNamedChild;
    if (!name) return null;
    return { targetName: simpleExpressionName(name.text), displayTarget: node.text.split("(")[0]?.trim() || name.text, isQualified: node.type !== "function_call_expression" };
  }

  if (language === "typescript" && isKind(node, ["call_expression", "new_expression"])) {
    const target = node.childForFieldName("function") ?? node.childForFieldName("constructor") ?? node.firstNamedChild;
    return target ? targetFromExpression(target) : null;
  }

  return null;
}

function targetFromExpression(target: Node): { targetName: string; displayTarget: string; isQualified: boolean } {
  if (isKind(target, ["member_expression", "attribute"])) {
    const property = target.childForFieldName("property") ?? target.lastNamedChild ?? target;
    return {
      targetName: simpleExpressionName(property.text),
      displayTarget: target.text.trim(),
      isQualified: true,
    };
  }
  return {
    targetName: simpleExpressionName(target.text),
    displayTarget: target.text.trim(),
    isQualified: false,
  };
}

export function resolveCalls(symbols: SymbolRecord[], calls: RawCall[]): GraphEdge[] {
  const byName = new Map<string, SymbolRecord[]>();
  const byFileAndName = new Map<string, SymbolRecord[]>();
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));

  for (const symbol of symbols) {
    pushMap(byName, `${symbol.language}:${simpleName(symbol.fqn)}`, symbol);
    pushMap(byFileAndName, `${symbol.language}:${symbol.relativePath}:${simpleName(symbol.fqn)}`, symbol);
  }

  return calls.map((call, index) => {
    const caller = byId.get(call.callerSymbolId) ?? null;
    const sameScope = caller
      ? symbols.filter(
          (symbol) =>
            symbol.language === call.language &&
            symbolNameMatches(call.language, simpleName(symbol.fqn), call.targetName) &&
            parentScope(symbol.fqn) === parentScope(caller.fqn),
        )
      : [];
    const sameFile = caller ? byFileAndName.get(`${call.language}:${caller.relativePath}:${call.targetName}`) ?? [] : [];
    const global = byName.get(`${call.language}:${call.targetName}`) ?? [];
    const candidates = sameScope.length > 0 ? sameScope : !call.isQualified && sameFile.length > 0 ? sameFile : global;
    const confidence: EdgeConfidence = candidates.length === 1 && !call.isQualified ? "resolved" : candidates.length === 0 ? "unresolved" : "ambiguous";

    return {
      id: index + 1,
      source: call.callerSymbolId,
      target: confidence === "resolved" ? candidates[0].id : null,
      unresolvedName: confidence === "resolved" ? null : call.displayTarget,
      confidence,
      sourceLine: call.sourceLine,
    };
  });
}

function buildSymbol(
  language: SourceLanguage,
  kind: string,
  fqn: string,
  signature: string,
  relativePath: string,
  node: Node,
): SymbolRecord {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  return {
    id: stableId([language, relativePath, fqn, signature, String(startLine)]),
    language,
    kind,
    fqn,
    signature,
    relativePath,
    startLine,
    endLine,
    astFingerprint: stableHash([language, kind, fqn, signature, node.type, node.text].join("\u001f")),
  };
}

function declarationName(node: Node): string | null {
  const fieldName = node.childForFieldName("name") ?? node.childForFieldName("declarator") ?? node.childForFieldName("pattern");
  if (fieldName) return simpleExpressionName(fieldName.text);
  return node.namedChildren.find((child) => isKind(child, ["identifier", "property_identifier", "type_identifier"]))?.text.trim() ?? null;
}

function declarationSignature(node: Node): string {
  const parameters = node.childForFieldName("parameters") ?? node.childForFieldName("parameter");
  return parameters ? normalizeWhitespace(parameters.text) : "()";
}

function findJavaPackage(root: Node): string {
  const packageNode = root.descendantsOfType("package_declaration")[0];
  if (!packageNode) return "";
  return packageNode.text.replace(/^package\s+/, "").replace(/;$/, "").trim();
}

function phpNamespace(root: Node, file: BrowserSourceFile): string {
  const namespaceNode = root.descendantsOfType("namespace_definition")[0] ?? root.descendantsOfType("namespace_use_declaration")[0];
  if (!namespaceNode) return moduleNameForPath(file.relativePath, "php");
  const name = namespaceNode.childForFieldName("name")?.text.trim();
  return name || moduleNameForPath(file.relativePath, "php");
}

function qualifiedName(prefix: string, scopes: string[], name: string, separator = "."): string {
  return [prefix, ...scopes, name].filter(Boolean).join(separator);
}

function walk(node: Node, visit: (node: Node) => void): void {
  for (const child of node.namedChildren) visit(child);
}

function withScope(scopes: string[], name: string, run: () => void): void {
  scopes.push(name);
  run();
  scopes.pop();
}

function isKind(node: Node, types: string[]): boolean {
  return types.includes(node.type);
}

function isDeclarationNode(node: Node): boolean {
  return isKind(node, [
    "class_declaration",
    "function_definition",
    "function_declaration",
    "generator_function_declaration",
    "method_declaration",
    "method_definition",
    "constructor_declaration",
    "variable_declarator",
  ]);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function simpleExpressionName(value: string): string {
  return value.trim().replace(/[();]/g, "").split(/[.\\:>\-\s]+/).filter(Boolean).pop() ?? value.trim();
}

function simpleName(fqn: string): string {
  return fqn.split(/[.\\]/).pop() ?? fqn;
}

function parentScope(fqn: string): string {
  return fqn.split(/[.\\]/).slice(0, -1).join(".");
}

function symbolNameMatches(language: SourceLanguage, symbolName: string, targetName: string): boolean {
  return language === "php" ? symbolName.toLowerCase() === targetName.toLowerCase() : symbolName === targetName;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}
