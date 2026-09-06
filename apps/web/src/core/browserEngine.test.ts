import { describe, expect, it } from "vitest";
import {
  BrowserWorkspace,
  filesFromFileList,
  parseBrowserState,
  serializeBrowserState,
  unsupportedChangeImpact,
  type BrowserAnalyzer,
  type BrowserPersistedState,
  type BrowserSourceFile,
  type SymbolRecord,
} from ".";

const alpha = makeSymbol("alpha", "Feature.alpha", "hash-a", "src/feature.ts");
const beta = makeSymbol("beta", "Feature.beta", "hash-b", "src/feature.ts");

class MemoryPersistence {
  saved = "";

  async isAvailable() {
    return true;
  }

  async load(): Promise<BrowserPersistedState> {
    return this.saved ? parseBrowserState(this.saved) : parseBrowserState("{}");
  }

  async save(state: BrowserPersistedState): Promise<void> {
    this.saved = serializeBrowserState(state);
  }
}

class RejectingPersistence extends MemoryPersistence {
  private saves = 0;

  override async save(state: BrowserPersistedState): Promise<void> {
    this.saves += 1;
    if (this.saves > 1) throw new Error("quota exceeded");
    return super.save(state);
  }
}

const analyzer: BrowserAnalyzer = {
  async analyze(_files: BrowserSourceFile[]) {
    return {
      symbols: [alpha, beta],
      edges: [{ id: 1, source: "alpha", target: "beta", unresolvedName: null, confidence: "resolved", sourceLine: 2 }],
      diagnostics: [],
    };
  },
};

describe("browser engine store", () => {
  it("analyzes injected files, exposes search and graph, and reads source from memory", async () => {
    const workspace = new BrowserWorkspace(analyzer, new MemoryPersistence());
    const summary = await workspace.analyzeRepository({
      displayName: "demo",
      files: [{ relativePath: "src/feature.ts", language: "typescript", source: "export function alpha(){ beta() }\nfunction beta(){}" }],
    });

    expect(summary.symbolCount).toBe(2);
    expect(workspace.searchSymbols("beta")[0].id).toBe("beta");
    expect(workspace.getGraph("alpha", 1).edges).toHaveLength(1);
    expect(workspace.readSource("alpha").source).toContain("beta()");
  });

  it("keeps source text out of persisted OPFS payloads", async () => {
    const persistence = new MemoryPersistence();
    const workspace = new BrowserWorkspace(analyzer, persistence);
    await workspace.analyzeRepository({
      displayName: "private",
      files: [{ relativePath: "src/secret.ts", language: "typescript", source: "const token = 'do-not-persist';" }],
    });

    expect(persistence.saved).not.toContain("do-not-persist");
    expect(persistence.saved).not.toContain("\"files\"");
    expect(persistence.saved).toContain("\"symbols\"");
    expect(parseBrowserState(persistence.saved).index?.edges[0].source).toBe("alpha");

    const restored = new BrowserWorkspace(analyzer, persistence);
    await restored.load();
    expect(restored.getGraph("alpha", 1).edges).toHaveLength(1);
  });

  it("rejects future state versions without rewriting them", () => {
    expect(() => parseBrowserState(JSON.stringify({
      kind: "onboardcode.browser.workspace",
      version: 999,
      data: {},
    }))).toThrow("더 새로운 OnboardCode Web 형식");
  });

  it("creates collections and marks relinked symbols as changed after re-analysis", async () => {
    let nextSymbols = [alpha];
    const changingAnalyzer: BrowserAnalyzer = {
      async analyze() {
        return { symbols: nextSymbols, edges: [], diagnostics: [] };
      },
    };
    const workspace = new BrowserWorkspace(changingAnalyzer, new MemoryPersistence());
    await workspace.analyzeRepository({ displayName: "demo", files: [] });
    const collection = (await workspace.createCollection("로그인")).collection;
    await workspace.addCollectionItem(collection.id, "alpha", "entry", "진입점");

    nextSymbols = [makeSymbol("alpha", "Feature.alpha", "hash-new")];
    await workspace.analyzeRepository({ displayName: "demo", files: [] });

    expect(workspace.getCollection(collection.id)?.items[0].isChanged).toBe(true);
  });

  it("keeps collections isolated from a different active repository", async () => {
    const workspace = new BrowserWorkspace(analyzer, new MemoryPersistence());
    await workspace.analyzeRepository({ id: "repo-a", displayName: "A", files: [] });
    const collection = (await workspace.createCollection("A의 흐름")).collection;
    await workspace.addCollectionItem(collection.id, "alpha");

    await workspace.analyzeRepository({ id: "repo-b", displayName: "B", files: [] });

    expect(workspace.listCollections()).toEqual([]);
    expect(workspace.getCollection(collection.id)).toBeNull();
    await expect(workspace.addCollectionItem(collection.id, "alpha")).rejects.toThrow("현재 저장소");
  });

  it("surfaces note persistence failures to the caller", async () => {
    const workspace = new BrowserWorkspace(analyzer, new RejectingPersistence());
    await workspace.analyzeRepository({ displayName: "demo", files: [] });
    await expect(workspace.createNote("alpha", "note")).rejects.toThrow("quota exceeded");
  });

  it("keeps one web note per function", async () => {
    const workspace = new BrowserWorkspace(analyzer, new MemoryPersistence());
    await workspace.analyzeRepository({ displayName: "demo", files: [] });
    await workspace.createNote("alpha", "first", "body", ["tag"]);

    await expect(workspace.createNote("alpha", "second")).rejects.toThrow("이미 웹 노트");
    expect(workspace.listNotes("alpha")[0]).toEqual(expect.objectContaining({
      title: "first",
      bodyMarkdown: "body",
      tags: ["tag"],
    }));
  });
});

describe("browser file access helpers", () => {
  it("filters generated directories and unsupported files from file input", async () => {
    const files = [
      makeFile("src/index.ts", "export function ok() {}"),
      makeFile("node_modules/pkg/index.ts", "export function skip() {}"),
      makeFile("README.md", "# skip"),
    ];

    await expect(filesFromFileList(files)).resolves.toEqual([
      { relativePath: "src/index.ts", language: "typescript", source: "export function ok() {}" },
    ]);
  });

  it("skips source files larger than the documented browser limit", async () => {
    const oversized = makeFile("src/huge.ts", "x".repeat(2 * 1024 * 1024 + 1));
    await expect(filesFromFileList([oversized])).resolves.toEqual([]);
  });
});

describe("browser limitations", () => {
  it("reports Git change impact as unsupported in the web runtime", () => {
    expect(unsupportedChangeImpact()).toEqual({
      supported: false,
      reason: expect.stringContaining("로컬 Git 커밋"),
    });
  });
});

function makeSymbol(id: string, fqn: string, hash: string, relativePath = `src/${id}.ts`): SymbolRecord {
  return {
    id,
    language: "typescript",
    kind: "function",
    fqn,
    signature: `${fqn}()`,
    relativePath,
    startLine: 1,
    endLine: 3,
    astFingerprint: hash,
  };
}

function makeFile(relativePath: string, source: string): File {
  const file = new File([source], relativePath.split("/").at(-1) ?? relativePath, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}
