import { buildGraph, buildRestrictedGraph } from "./graph";
import { stableHash } from "./hash";
import { BROWSER_LIMITATIONS, unsupportedChangeImpact } from "./limitations";
import { emptyPersistedState, OpfsBrowserPersistence, type BrowserStateEnvelope } from "./persistence";
import type {
  AnalysisSummary,
  BrowserAnalysisIndex,
  BrowserLimitation,
  BrowserPersistedState,
  BrowserRepositoryInput,
  BrowserRepositoryRecord,
  BrowserSourceFile,
  BrowserCollectionDetail,
  BrowserCollectionItem,
  BrowserCollectionSummary,
  GraphData,
  NoteRecord,
  SourceFile,
  SymbolRecord,
  UnsupportedBrowserFeature,
} from "./types";

export interface BrowserAnalyzer {
  analyze(files: BrowserSourceFile[]): Promise<{
    symbols: SymbolRecord[];
    edges: GraphData["edges"];
    diagnostics: string[];
  }>;
}

export class WorkerBrowserAnalyzer implements BrowserAnalyzer {
  constructor(private readonly workerFactory = () => new Worker(new URL("../analysis.worker.ts", import.meta.url), { type: "module" })) {}

  analyze(files: BrowserSourceFile[]): Promise<{ symbols: SymbolRecord[]; edges: GraphData["edges"]; diagnostics: string[] }> {
    const worker = this.workerFactory();
    const id = `analysis:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; result?: Awaited<ReturnType<BrowserAnalyzer["analyze"]>>; error?: string }>) => {
        if (event.data.id !== id) return;
        worker.terminate();
        if (event.data.ok && event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error ?? "브라우저 분석 워커가 실패했습니다."));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({ id, type: "analyze", files });
    });
  }
}

export class BrowserWorkspace {
  private state: BrowserPersistedState = structuredClone(emptyPersistedState);
  private sourceFiles = new Map<string, BrowserSourceFile>();

  constructor(
    private readonly analyzer: BrowserAnalyzer = new WorkerBrowserAnalyzer(),
    private readonly persistence = new OpfsBrowserPersistence(),
  ) {}

  async load(): Promise<BrowserPersistedState> {
    this.state = await this.persistence.load();
    return this.snapshot();
  }

  async save(): Promise<void> {
    await this.persistence.save(this.state);
  }

  snapshot(): BrowserPersistedState {
    return structuredClone(this.state);
  }

  limitations(): BrowserLimitation[] {
    return [...BROWSER_LIMITATIONS];
  }

  async analyzeRepository(input: BrowserRepositoryInput): Promise<AnalysisSummary> {
    this.sourceFiles = new Map(input.files.map((file) => [file.relativePath, file]));
    const repository = this.repositoryRecord(input);
    const result = await this.analyzer.analyze(input.files);
    const summary: AnalysisSummary = {
      workspaceName: repository.displayName,
      repositoryId: repository.id,
      sourceFileCount: input.files.length,
      symbolCount: result.symbols.length,
      edgeCount: result.edges.length,
      diagnosticCount: result.diagnostics.length,
      analyzedAt: new Date().toISOString(),
      status: result.diagnostics.length > 0 ? "partial" : "completed",
    };
    this.state.index = {
      repository,
      summary,
      symbols: result.symbols,
      edges: result.edges,
      diagnostics: result.diagnostics,
      analyzedAt: new Date().toISOString(),
    };
    this.relinkStoredItems();
    await this.saveIfAvailable();
    return summary;
  }

  currentIndex(): BrowserAnalysisIndex | null {
    return this.state.index ? structuredClone(this.state.index) : null;
  }

  searchSymbols(query: string): SymbolRecord[] {
    const normalized = query.trim().toLowerCase();
    const symbols = this.state.index?.symbols ?? [];
    if (!normalized) return symbols.slice(0, 100);
    return symbols
      .filter((symbol) =>
        [symbol.fqn, symbol.signature, symbol.relativePath, symbol.kind, symbol.language]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 100);
  }

  getGraph(rootSymbolId: string, depth: number): GraphData {
    const index = this.requireIndex();
    return buildGraph(index.symbols, index.edges, rootSymbolId, depth);
  }

  readSource(symbolId: string): SourceFile {
    const symbol = this.findSymbol(symbolId);
    const file = this.sourceFiles.get(symbol.relativePath);
    if (!file) {
      throw new Error("원본 소스는 브라우저 저장소에 보관하지 않습니다. 같은 폴더를 다시 열어 주세요.");
    }
    return {
      relativePath: file.relativePath,
      source: file.source,
      startLine: 1,
      endLine: file.source.split(/\r?\n/).length,
    };
  }

  listNotes(symbolId: string): NoteRecord[] {
    return this.state.notes.filter((note) => note.symbolId === symbolId).map((note) => ({ ...note, status: this.findSymbolOrNull(note.symbolId) ? "linked" : "orphan" }));
  }

  createNote(symbolId: string, title: string): NoteRecord {
    this.findSymbol(symbolId);
    const now = new Date().toISOString();
    const note: NoteRecord = {
      id: this.state.counters.noteId++,
      symbolId,
      title,
      bodyMarkdown: "",
      tags: [],
      updatedAt: now,
      status: "linked",
    };
    this.state.notes.push(note);
    void this.saveIfAvailable();
    return structuredClone(note);
  }

  updateNote(noteId: number, patch: { title: string; bodyMarkdown: string; tags: string[] }): NoteRecord {
    const note = this.state.notes.find((item) => item.id === noteId);
    if (!note) throw new Error("노트를 찾을 수 없습니다.");
    note.title = patch.title;
    note.bodyMarkdown = patch.bodyMarkdown;
    note.tags = patch.tags;
    note.updatedAt = new Date().toISOString();
    void this.saveIfAvailable();
    return structuredClone(note);
  }

  createCollection(title: string, overviewMarkdown = "", tags: string[] = []): BrowserCollectionDetail {
    const repositoryId = this.requireIndex().repository.id;
    const now = new Date().toISOString();
    const collection: BrowserCollectionSummary = {
      id: this.state.counters.collectionId++,
      repositoryId,
      title,
      overviewMarkdown,
      tags,
      createdRevision: this.revision(),
      itemCount: 0,
      orphanCount: 0,
      changedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.collections.push(collection);
    void this.saveIfAvailable();
    return { collection: structuredClone(collection), items: [] };
  }

  listCollections(): BrowserCollectionSummary[] {
    return this.state.collections.map((collection) => this.refreshCollectionSummary(collection.id));
  }

  deleteCollection(collectionId: number): void {
    this.state.collections = this.state.collections.filter((item) => item.id !== collectionId);
    this.state.collectionItems = this.state.collectionItems.filter((item) => item.collectionId !== collectionId);
    if (this.state.workspace.selectedCollectionId === collectionId) this.state.workspace.selectedCollectionId = null;
    void this.saveIfAvailable();
  }

  getCollection(collectionId: number): BrowserCollectionDetail | null {
    const collection = this.state.collections.find((item) => item.id === collectionId);
    if (!collection) return null;
    return {
      collection: this.refreshCollectionSummary(collection.id),
      items: this.state.collectionItems
        .filter((item) => item.collectionId === collectionId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((item) => this.relinkedItem(item)),
    };
  }

  addCollectionItem(collectionId: number, symbolId: string, role = "other", memo = ""): BrowserCollectionDetail {
    const collection = this.state.collections.find((item) => item.id === collectionId);
    if (!collection) throw new Error("컬렉션을 찾을 수 없습니다.");
    const symbol = this.findSymbol(symbolId);
    const now = new Date().toISOString();
    const item: BrowserCollectionItem = {
      id: this.state.counters.collectionItemId++,
      collectionId,
      repositoryId: collection.repositoryId,
      symbolId: symbol.id,
      symbolFqn: symbol.fqn,
      symbolSignature: symbol.signature,
      relativePath: symbol.relativePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      astFingerprint: symbol.astFingerprint,
      role,
      memo,
      status: "linked",
      sortOrder: this.state.collectionItems.filter((candidate) => candidate.collectionId === collectionId).length,
      addedRevision: this.revision(),
      reviewedAt: null,
      updatedAt: now,
      symbol,
      isChanged: false,
    };
    this.state.collectionItems.push(item);
    void this.saveIfAvailable();
    return this.getCollection(collectionId) as BrowserCollectionDetail;
  }

  updateCollectionItem(collectionId: number, itemId: number, patch: { role?: string; memo?: string }): BrowserCollectionItem {
    const item = this.state.collectionItems.find((candidate) => candidate.collectionId === collectionId && candidate.id === itemId);
    if (!item) throw new Error("컬렉션 항목을 찾을 수 없습니다.");
    if (patch.role) item.role = patch.role;
    if (patch.memo !== undefined) item.memo = patch.memo;
    item.updatedAt = new Date().toISOString();
    void this.saveIfAvailable();
    return this.relinkedItem(item);
  }

  reorderCollectionItems(collectionId: number, itemIds: number[]): BrowserCollectionDetail {
    const requested = new Map(itemIds.map((id, index) => [id, index]));
    for (const item of this.state.collectionItems.filter((item) => item.collectionId === collectionId)) {
      const nextOrder = requested.get(item.id);
      if (nextOrder !== undefined) item.sortOrder = nextOrder;
    }
    void this.saveIfAvailable();
    return this.getCollection(collectionId) as BrowserCollectionDetail;
  }

  relinkCollectionItem(collectionId: number, itemId: number, symbolId: string): BrowserCollectionItem {
    const item = this.state.collectionItems.find((candidate) => candidate.collectionId === collectionId && candidate.id === itemId);
    if (!item) throw new Error("컬렉션 항목을 찾을 수 없습니다.");
    const symbol = this.findSymbol(symbolId);
    Object.assign(item, {
      symbolId: symbol.id,
      symbolFqn: symbol.fqn,
      symbolSignature: symbol.signature,
      relativePath: symbol.relativePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      astFingerprint: symbol.astFingerprint,
      status: "linked",
      symbol,
      isChanged: false,
      updatedAt: new Date().toISOString(),
    });
    void this.saveIfAvailable();
    return this.relinkedItem(item);
  }

  markCollectionItemReviewed(collectionId: number, itemId: number): BrowserCollectionItem {
    const item = this.state.collectionItems.find((candidate) => candidate.collectionId === collectionId && candidate.id === itemId);
    if (!item) throw new Error("컬렉션 항목을 찾을 수 없습니다.");
    item.reviewedAt = new Date().toISOString();
    item.astFingerprint = item.symbol?.astFingerprint ?? item.astFingerprint;
    item.isChanged = false;
    void this.saveIfAvailable();
    return this.relinkedItem(item);
  }

  getCollectionGraph(collectionId: number): GraphData {
    const index = this.requireIndex();
    const detail = this.getCollection(collectionId);
    if (!detail) return { nodes: [], edges: [] };
    return buildRestrictedGraph(
      index.symbols,
      index.edges,
      detail.items.map((item) => item.symbolId).filter(Boolean) as string[],
    );
  }

  getChangeImpact(): UnsupportedBrowserFeature {
    return unsupportedChangeImpact();
  }

  private repositoryRecord(input: BrowserRepositoryInput): BrowserRepositoryRecord {
    const now = new Date().toISOString();
    const contentFingerprint = stableHash(input.files.map((file) => `${file.relativePath}:${stableHash(file.source)}`).join("|"));
    return {
      id: input.id ?? `browser:${stableHash(input.displayName)}`,
      rootPath: input.rootPath ?? input.displayName,
      displayName: input.displayName,
      branch: "browser",
      head: contentFingerprint,
      isDirty: false,
      createdAt: this.state.index?.repository.createdAt ?? now,
      updatedAt: now,
      runtime: "browser",
    };
  }

  private revision(): string {
    return this.state.index?.repository.head ?? "browser";
  }

  private requireIndex(): BrowserAnalysisIndex {
    if (!this.state.index) throw new Error("먼저 폴더를 열고 코드 분석을 실행해 주세요.");
    return this.state.index;
  }

  private findSymbol(symbolId: string): SymbolRecord {
    const symbol = this.findSymbolOrNull(symbolId);
    if (!symbol) throw new Error("심볼을 찾을 수 없습니다.");
    return symbol;
  }

  private findSymbolOrNull(symbolId: string): SymbolRecord | null {
    return this.state.index?.symbols.find((symbol) => symbol.id === symbolId) ?? null;
  }

  private relinkStoredItems(): void {
    this.state.collectionItems = this.state.collectionItems.map((item) => this.relinkedItem(item));
  }

  private relinkedItem(item: BrowserCollectionItem): BrowserCollectionItem {
    const symbol = item.symbolId ? this.findSymbolOrNull(item.symbolId) : null;
    return {
      ...item,
      symbol,
      status: symbol ? "linked" : "orphan",
      isChanged: Boolean(symbol && symbol.astFingerprint !== item.astFingerprint),
    };
  }

  private refreshCollectionSummary(collectionId: number): BrowserCollectionSummary {
    const collection = this.state.collections.find((candidate) => candidate.id === collectionId);
    if (!collection) throw new Error("컬렉션을 찾을 수 없습니다.");
    const items = this.state.collectionItems.filter((item) => item.collectionId === collectionId).map((item) => this.relinkedItem(item));
    return {
      ...collection,
      itemCount: items.length,
      orphanCount: items.filter((item) => item.status === "orphan").length,
      changedCount: items.filter((item) => item.isChanged).length,
    };
  }

  private async saveIfAvailable(): Promise<void> {
    if (await this.persistence.isAvailable()) await this.persistence.save(this.state);
  }
}

export type { BrowserStateEnvelope };
