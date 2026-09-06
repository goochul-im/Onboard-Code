export type SourceLanguage = "java" | "php" | "python" | "typescript";

export type EdgeConfidence = "resolved" | "ambiguous" | "unresolved";

export interface WorkspaceFile {
  relativePath: string;
  source: string;
}

export type BrowserCapability = "available" | "limited" | "unsupported";

export interface BrowserSourceFile extends WorkspaceFile {
  language: SourceLanguage;
}

export interface SymbolRecord {
  id: string;
  language: SourceLanguage;
  kind: string;
  fqn: string;
  signature: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  astFingerprint: string;
}

export interface GraphEdge {
  id: number;
  source: string;
  target: string | null;
  unresolvedName: string | null;
  confidence: EdgeConfidence;
  sourceLine: number;
}

export interface GraphData {
  nodes: SymbolRecord[];
  edges: GraphEdge[];
}

export interface AnalysisSummary {
  workspaceName: string;
  repositoryId?: string;
  sourceFileCount: number;
  symbolCount: number;
  edgeCount: number;
  diagnosticCount: number;
  analyzedAt: string;
  status?: "completed" | "partial";
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  files: WorkspaceFile[];
  symbols: SymbolRecord[];
  edges: GraphEdge[];
  diagnostics: string[];
}

export interface BrowserRepositoryRecord {
  id: string;
  rootPath: string;
  displayName: string;
  branch: string;
  head: string;
  isDirty: boolean;
  createdAt: string;
  updatedAt: string;
  runtime: "browser";
}

export interface BrowserAnalysisIndex {
  repository: BrowserRepositoryRecord;
  summary: AnalysisSummary;
  symbols: SymbolRecord[];
  edges: GraphEdge[];
  diagnostics: string[];
  analyzedAt: string;
}

export interface NoteRecord {
  id?: number;
  symbolId: string;
  title: string;
  bodyMarkdown: string;
  tags: string[];
  updatedAt: string;
  status?: "linked" | "orphan";
}

export type CollectionItemRole = "entry" | "core" | "data" | "external" | "error" | "other";
export type CollectionItemStatus = "linked" | "orphan" | "changed";

export interface CollectionItem {
  id: string;
  collectionId?: string;
  repositoryId?: string;
  symbolId: string | null;
  symbolFqn: string;
  symbolSignature: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  astFingerprint: string;
  role: CollectionItemRole;
  memo: string;
  status: CollectionItemStatus;
  sortOrder: number;
  addedRevision?: string;
  reviewedAt?: string | null;
  addedAt: string;
  updatedAt: string;
  symbol?: SymbolRecord | null;
  isChanged?: boolean;
}

export interface CollectionDetail {
  id: string;
  repositoryId?: string;
  title: string;
  overviewMarkdown: string;
  tags: string[];
  createdRevision?: string;
  itemCount?: number;
  orphanCount?: number;
  changedCount?: number;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
}

export type CollectionSummary = CollectionDetail;

export interface BrowserCollectionSummary {
  id: number;
  repositoryId: string;
  title: string;
  overviewMarkdown: string;
  tags: string[];
  createdRevision: string;
  itemCount: number;
  orphanCount: number;
  changedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserCollectionItem {
  id: number;
  collectionId: number;
  repositoryId: string;
  symbolId: string | null;
  symbolFqn: string;
  symbolSignature: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  astFingerprint: string;
  role: CollectionItemRole | string;
  memo: string;
  status: "linked" | "orphan";
  sortOrder: number;
  addedRevision: string;
  reviewedAt: string | null;
  updatedAt: string;
  symbol: SymbolRecord | null;
  isChanged: boolean;
}

export interface BrowserCollectionDetail {
  collection: BrowserCollectionSummary;
  items: BrowserCollectionItem[];
}

export interface AppSnapshot {
  notes: NoteRecord[];
  collections: CollectionDetail[];
}

export interface SourceFile {
  relativePath: string;
  source: string;
  startLine: number;
  endLine: number;
}

export interface RawCall {
  callerSymbolId: string;
  callerFqn: string;
  language: SourceLanguage;
  targetName: string;
  displayTarget: string;
  isQualified: boolean;
  receiverType: string | null;
  receiverModule: string | null;
  sourceLine: number;
}

export interface BrowserLimitation {
  feature: string;
  status: BrowserCapability;
  summary: string;
  detail: string;
}

export interface BrowserWorkspaceState {
  selectedSymbolId: string | null;
  graphDepth: number;
  selectedCollectionId: number | null;
}

export interface BrowserPersistedState {
  index: BrowserAnalysisIndex | null;
  notes: NoteRecord[];
  collections: BrowserCollectionSummary[];
  collectionItems: BrowserCollectionItem[];
  workspace: BrowserWorkspaceState;
  counters: {
    noteId: number;
    collectionId: number;
    collectionItemId: number;
  };
}

export interface BrowserRepositoryInput {
  id?: string;
  displayName: string;
  rootPath?: string;
  files: BrowserSourceFile[];
}

export interface UnsupportedBrowserFeature {
  supported: false;
  reason: string;
}

declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
