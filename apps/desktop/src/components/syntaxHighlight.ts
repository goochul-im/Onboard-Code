import type { SourceLanguage } from "../types";

export type SyntaxTokenKind = "plain" | "annotation" | "comment" | "function" | "keyword" | "number" | "string" | "type";

export interface SyntaxToken {
  text: string;
  kind: SyntaxTokenKind;
}

interface HighlightState {
  inBlockComment: boolean;
  tripleQuote: "'''" | "\"\"\"" | null;
}

const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "break", "case", "catch", "class", "continue", "default", "do", "else", "enum", "extends",
  "final", "finally", "for", "if", "implements", "import", "instanceof", "interface", "new", "package", "private",
  "protected", "public", "record", "return", "sealed", "static", "super", "switch", "synchronized", "this", "throw",
  "throws", "try", "var", "while", "yield",
]);

const JAVA_TYPES = new Set([
  "boolean", "byte", "char", "double", "float", "int", "long", "short", "void", "Boolean", "Byte", "Character",
  "Double", "Float", "Integer", "Long", "Object", "String", "Void",
]);

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del", "elif", "else",
  "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "match", "None",
  "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield",
]);

const PYTHON_TYPES = new Set([
  "bool", "bytes", "dict", "float", "int", "list", "object", "set", "str", "tuple", "type",
]);

export function detectSourceLanguage(relativePath: string): SourceLanguage {
  return relativePath.endsWith(".py") ? "python" : "java";
}

export function tokenizeSource(source: string, language: SourceLanguage): SyntaxToken[][] {
  const state: HighlightState = { inBlockComment: false, tripleQuote: null };
  return source.split("\n").map((line) => tokenizeLine(line, language, state));
}

function tokenizeLine(line: string, language: SourceLanguage, state: HighlightState): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < line.length) {
    if (state.inBlockComment) {
      const end = line.indexOf("*/", index);
      if (end < 0) {
        pushToken(tokens, line.slice(index), "comment");
        return tokens;
      }
      pushToken(tokens, line.slice(index, end + 2), "comment");
      state.inBlockComment = false;
      index = end + 2;
      continue;
    }

    if (state.tripleQuote) {
      const end = line.indexOf(state.tripleQuote, index);
      if (end < 0) {
        pushToken(tokens, line.slice(index), "string");
        return tokens;
      }
      pushToken(tokens, line.slice(index, end + state.tripleQuote.length), "string");
      index = end + state.tripleQuote.length;
      state.tripleQuote = null;
      continue;
    }

    const remaining = line.slice(index);
    if (language === "java" && remaining.startsWith("//")) {
      pushToken(tokens, remaining, "comment");
      return tokens;
    }
    if (language === "java" && remaining.startsWith("/*")) {
      const end = line.indexOf("*/", index + 2);
      if (end < 0) {
        pushToken(tokens, remaining, "comment");
        state.inBlockComment = true;
        return tokens;
      }
      pushToken(tokens, line.slice(index, end + 2), "comment");
      index = end + 2;
      continue;
    }
    if (language === "python" && remaining.startsWith("#")) {
      pushToken(tokens, remaining, "comment");
      return tokens;
    }

    const pythonPrefix = language === "python"
      ? /^[rRuUbBfF]{0,2}(?:'''|\"\"\"|'|\")/.exec(remaining)
      : null;
    const quote = pythonPrefix?.[0]?.at(-1) ?? (remaining.startsWith("\"") || remaining.startsWith("'") ? remaining[0] : null);
    if (quote) {
      const prefixLength = pythonPrefix?.[0].length ?? 0;
      const isTripleQuote = remaining.slice(Math.max(0, prefixLength - 3), prefixLength) === quote.repeat(3)
        || remaining.startsWith(quote.repeat(3));
      const start = index;
      const contentStart = pythonPrefix ? index + pythonPrefix[0].length : index + (isTripleQuote ? 3 : 1);
      const delimiter = isTripleQuote ? quote.repeat(3) as "'''" | "\"\"\"" : quote;
      const end = findStringEnd(line, contentStart, delimiter);
      if (end < 0) {
        pushToken(tokens, line.slice(start), "string");
        if (isTripleQuote) {
          state.tripleQuote = delimiter as "'''" | "\"\"\"";
        }
        return tokens;
      }
      pushToken(tokens, line.slice(start, end + delimiter.length), "string");
      index = end + delimiter.length;
      continue;
    }

    if (remaining.startsWith("@")) {
      const annotation = /^@[A-Za-z_$][\w$.]*/.exec(remaining)?.[0];
      if (annotation) {
        pushToken(tokens, annotation, "annotation");
        index += annotation.length;
        continue;
      }
    }

    const number = /^(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFdDlL]?/.exec(remaining)?.[0];
    if (number) {
      pushToken(tokens, number, "number");
      index += number.length;
      continue;
    }

    const word = /^[A-Za-z_$][\w$]*/.exec(remaining)?.[0];
    if (word) {
      pushToken(tokens, word, classifyWord(word, line, index, language));
      index += word.length;
      continue;
    }

    pushToken(tokens, line[index]);
    index += 1;
  }

  return tokens;
}

function findStringEnd(line: string, index: number, delimiter: string): number {
  for (let cursor = index; cursor < line.length; cursor += 1) {
    if (line[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (line.startsWith(delimiter, cursor)) {
      return cursor;
    }
  }
  return -1;
}

function classifyWord(word: string, line: string, index: number, language: SourceLanguage): SyntaxTokenKind {
  const keywords = language === "java" ? JAVA_KEYWORDS : PYTHON_KEYWORDS;
  const types = language === "java" ? JAVA_TYPES : PYTHON_TYPES;
  if (keywords.has(word)) {
    return "keyword";
  }
  if (types.has(word) || /^[A-Z]/.test(word)) {
    return "type";
  }
  return /\s*\(/.test(line.slice(index + word.length)) ? "function" : "plain";
}

function pushToken(tokens: SyntaxToken[], text: string, kind: SyntaxTokenKind = "plain") {
  if (!text) {
    return;
  }
  const previous = tokens.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  tokens.push({ text, kind });
}
