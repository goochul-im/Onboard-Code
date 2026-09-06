import type { SourceLanguage } from "./types";

const SUPPORTED_EXTENSIONS = new Map<string, SourceLanguage>([
  [".java", "java"],
  [".php", "php"],
  [".py", "python"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
]);

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
]);

export function languageFromPath(relativePath: string): SourceLanguage | null {
  const lowerPath = relativePath.toLowerCase();
  for (const [extension, language] of SUPPORTED_EXTENSIONS) {
    if (lowerPath.endsWith(extension)) return language;
  }
  return null;
}

export function isSupportedSourcePath(relativePath: string): boolean {
  return languageFromPath(relativePath) !== null && !isExcludedPath(relativePath);
}

export function isExcludedPath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .split("/")
    .some((part) => EXCLUDED_DIRECTORY_NAMES.has(part));
}

export function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function moduleNameForPath(relativePath: string, language: SourceLanguage): string {
  const withoutExtension = normalizeRelativePath(relativePath).replace(/\.[^.]+$/, "");
  if (language === "python") return withoutExtension.replace(/\/__init__$/, "").replaceAll("/", ".");
  if (language === "typescript") return withoutExtension.replaceAll("/", ".");
  if (language === "php") return withoutExtension.replaceAll("/", "\\");
  return withoutExtension.replaceAll("/", ".");
}

