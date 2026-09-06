import type { BrowserPersistedState } from "./types";

export const BROWSER_STATE_VERSION = 2;
const STATE_FILE_NAME = "onboardcode-browser-state.json";

export interface BrowserStateEnvelope {
  kind: "onboardcode.browser.workspace";
  version: number;
  savedAt: string;
  data: BrowserPersistedState;
}

export const emptyPersistedState: BrowserPersistedState = {
  index: null,
  notes: [],
  collections: [],
  collectionItems: [],
  workspace: {
    selectedSymbolId: null,
    graphDepth: 2,
    selectedCollectionId: null,
  },
  counters: {
    noteId: 1,
    collectionId: 1,
    collectionItemId: 1,
  },
};

export function serializeBrowserState(state: BrowserPersistedState): string {
  return JSON.stringify(
    {
      kind: "onboardcode.browser.workspace",
      version: BROWSER_STATE_VERSION,
      savedAt: new Date().toISOString(),
      data: stripSourceText(state),
    } satisfies BrowserStateEnvelope,
    null,
    2,
  );
}

export function parseBrowserState(serialized: string): BrowserPersistedState {
  const raw = JSON.parse(serialized) as Partial<BrowserStateEnvelope> | BrowserPersistedState;
  if ("kind" in raw && raw.kind === "onboardcode.browser.workspace") {
    return migrateState(raw.version ?? 1, raw.data);
  }
  return migrateState(1, raw as Partial<BrowserPersistedState>);
}

export class OpfsBrowserPersistence {
  async isAvailable(): Promise<boolean> {
    return typeof navigator !== "undefined" && Boolean(navigator.storage && "getDirectory" in navigator.storage);
  }

  async load(): Promise<BrowserPersistedState> {
    if (!(await this.isAvailable())) return structuredClone(emptyPersistedState);
    const root = await getOpfsRoot();
    try {
      const fileHandle = await root.getFileHandle(STATE_FILE_NAME);
      const file = await fileHandle.getFile();
      return parseBrowserState(await file.text());
    } catch (error) {
      if ((error as DOMException).name === "NotFoundError") return structuredClone(emptyPersistedState);
      throw error;
    }
  }

  async save(state: BrowserPersistedState): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error("이 브라우저는 OPFS 저장소를 지원하지 않습니다.");
    }
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(STATE_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(serializeBrowserState(state));
    await writable.close();
  }
}

function migrateState(version: number, data: Partial<BrowserPersistedState> | undefined): BrowserPersistedState {
  const next = structuredClone(emptyPersistedState);
  if (!data) return next;
  next.index = data.index ?? null;
  next.notes = data.notes ?? [];
  next.collections = data.collections ?? [];
  next.collectionItems = data.collectionItems ?? [];
  next.workspace = { ...next.workspace, ...(data.workspace ?? {}) };
  next.counters = { ...next.counters, ...(data.counters ?? {}) };
  if (version < 2) {
    next.collectionItems = next.collectionItems.map((item, index) => ({ ...item, sortOrder: item.sortOrder ?? index }));
  }
  return stripSourceText(next);
}

function stripSourceText(state: BrowserPersistedState): BrowserPersistedState {
  return JSON.parse(
    JSON.stringify(state, (key, value) => {
      if (key === "source" || key === "files") return undefined;
      return value;
    }),
  ) as BrowserPersistedState;
}

type OpfsDirectoryHandle = FileSystemDirectoryHandle & {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
};

async function getOpfsRoot(): Promise<OpfsDirectoryHandle> {
  const storage = navigator.storage as StorageManager & {
    getDirectory(): Promise<OpfsDirectoryHandle>;
  };
  return storage.getDirectory();
}

