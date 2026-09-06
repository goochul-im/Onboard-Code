import { describe, expect, it } from "vitest";
import { BrowserWorkspace, type BrowserAnalyzer, type BrowserPersistedState, type SymbolRecord } from ".";

describe("BrowserWorkspace collections", () => {
  it("stores selected functions, reorders them, and exposes a collection graph", async () => {
    const workspace = new BrowserWorkspace(new FakeAnalyzer(), new MemoryPersistence());
    await workspace.load();
    await workspace.analyzeRepository({
      displayName: "fixture",
      files: [{ relativePath: "src/a.ts", language: "typescript", source: "" }],
    });

    const collection = workspace.createCollection("로그인 흐름");
    workspace.addCollectionItem(collection.collection.id, "alpha", "entry", "진입점");
    workspace.addCollectionItem(collection.collection.id, "beta", "core", "핵심 처리");
    workspace.reorderCollectionItems(collection.collection.id, [2, 1]);

    const detail = workspace.getCollection(collection.collection.id);
    const graph = workspace.getCollectionGraph(collection.collection.id);

    expect(detail?.items.map((item) => item.symbolId)).toEqual(["beta", "alpha"]);
    expect(detail?.items[1].memo).toBe("진입점");
    expect(graph.nodes.map((node) => node.id)).toEqual(["alpha", "beta"]);
    expect(graph.edges).toHaveLength(1);
  });
});

class FakeAnalyzer implements BrowserAnalyzer {
  async analyze() {
    return {
      symbols: [makeSymbol("alpha"), makeSymbol("beta")],
      edges: [{ id: 1, source: "alpha", target: "beta", unresolvedName: null, confidence: "resolved" as const, sourceLine: 2 }],
      diagnostics: [],
    };
  }
}

class MemoryPersistence {
  state: BrowserPersistedState | null = null;

  async isAvailable() {
    return true;
  }

  async load() {
    return this.state ?? {
      index: null,
      notes: [],
      collections: [],
      collectionItems: [],
      workspace: { selectedSymbolId: null, graphDepth: 2, selectedCollectionId: null },
      counters: { noteId: 1, collectionId: 1, collectionItemId: 1 },
    };
  }

  async save(state: BrowserPersistedState) {
    this.state = structuredClone(state);
  }
}

function makeSymbol(id: string): SymbolRecord {
  return {
    id,
    language: "typescript",
    kind: "function",
    fqn: `Feature.${id}`,
    signature: "()",
    relativePath: `src/${id}.ts`,
    startLine: 1,
    endLine: 4,
    astFingerprint: id,
  };
}
