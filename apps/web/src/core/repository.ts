import { isExcludedPath, languageFromPath, normalizeRelativePath } from "./language";
import type { BrowserRepositoryInput, BrowserSourceFile } from "./types";

type BrowserDirectoryHandle = FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>;
type DirectoryPicker = () => Promise<BrowserDirectoryHandle>;

declare global {
  interface Window {
    showDirectoryPicker?: DirectoryPicker;
  }
}

export function browserFileAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickRepositoryDirectory(): Promise<BrowserRepositoryInput> {
  if (!browserFileAccessSupported() || !window.showDirectoryPicker) {
    throw new Error("이 브라우저는 폴더 선택 API를 지원하지 않습니다. 파일/폴더 드롭 입력을 사용하세요.");
  }
  const handle = await window.showDirectoryPicker();
  const files = await enumerateDirectory(handle);
  return {
    id: `browser:${handle.name}`,
    displayName: handle.name,
    rootPath: handle.name,
    files,
  };
}

export async function filesFromFileList(fileList: File[] | FileList): Promise<BrowserSourceFile[]> {
  const files = Array.from(fileList);
  const loaded: BrowserSourceFile[] = [];
  for (const file of files) {
    const relativePath = normalizeRelativePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    const language = languageFromPath(relativePath);
    if (!language || isExcludedPath(relativePath)) continue;
    loaded.push({ relativePath, language, source: await file.text() });
  }
  return loaded.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function enumerateDirectory(handle: BrowserDirectoryHandle, prefix = ""): Promise<BrowserSourceFile[]> {
  const files: BrowserSourceFile[] = [];
  for await (const [name, child] of handle) {
    const relativePath = normalizeRelativePath(`${prefix}${name}`);
    if (child.kind === "directory") {
      if (!isExcludedPath(relativePath)) {
        files.push(...(await enumerateDirectory(child as BrowserDirectoryHandle, `${relativePath}/`)));
      }
      continue;
    }
    const language = languageFromPath(relativePath);
    if (!language || isExcludedPath(relativePath)) continue;
    const file = await (child as FileSystemFileHandle).getFile();
    files.push({ relativePath, language, source: await file.text() });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

