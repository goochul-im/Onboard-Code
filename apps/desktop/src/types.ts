export type SourceLanguage = "java" | "php" | "python" | "typescript";
export type EdgeConfidence = "resolved" | "ambiguous" | "unresolved";

export interface RepositoryRecord {
  id: string;
  rootPath: string;
  displayName: string;
  branch: string;
  head: string;
  isDirty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisSummary {
  repositoryId: string;
  sourceFileCount: number;
  symbolCount: number;
  edgeCount: number;
  diagnosticCount: number;
  status: "completed" | "partial";
}

export type ChangeImpactStatus = "noBaseline" | "unchanged" | "changed";
export type ImpactChangeKind = "added" | "modified" | "deleted" | "moved";

export interface ImpactChange {
  kind: ImpactChangeKind;
  symbol: SymbolRecord | null;
  previousSymbol: SymbolRecord | null;
}

export interface ImpactCaller {
  symbol: SymbolRecord;
  distance: number;
  changedSymbols: string[];
}

export interface ChangeImpactReport {
  status: ChangeImpactStatus;
  repositoryId: string;
  baseRevision: string | null;
  currentRevision: string;
  branch: string;
  isDirty: boolean;
  changedFiles: string[];
  changes: ImpactChange[];
  affectedCallers: ImpactCaller[];
  diagnosticCount: number;
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

export type CollectionItemRole = "entry" | "core" | "data" | "external" | "error" | "other";
export type CollectionItemStatus = "linked" | "orphan";

export interface CollectionSummary {
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

export interface CollectionItem {
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
  status: CollectionItemStatus;
  sortOrder: number;
  addedRevision: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  symbol: SymbolRecord | null;
  isChanged: boolean;
}

export interface CollectionDetail {
  collection: CollectionSummary;
  items: CollectionItem[];
}

export interface NoteRecord {
  id: number;
  symbolId: string;
  title: string;
  bodyMarkdown: string;
  tags: string[];
  updatedAt: string;
  status: "linked" | "orphan";
}

export interface OrphanNote {
  id: number;
  title: string;
  symbolFqn: string;
  symbolSignature: string;
  updatedAt: string;
}

export interface SourceFile {
  relativePath: string;
  source: string;
  startLine: number;
  endLine: number;
}

export interface WorkspaceSnapshotRequest {
  schemaVersion: number;
  appVersion: string;
  databaseFormatVersion: number;
  repositoryId: string;
  stateJson: string;
}

export interface WorkspaceSnapshot extends WorkspaceSnapshotRequest {
  snapshotId: number;
  status: "pending" | "current" | "previous_valid";
  createdAt: string;
}

export interface SelectedSymbolReference {
  fqn: string;
  signature: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}

export interface RestorationRequest {
  repositoryId: string;
  rootPath: string;
  branch: string;
  head: string;
  selectedSymbol: SelectedSymbolReference | null;
}

export type ReferenceValidationStatus = "valid" | "reconfirmation_required";

export interface RestorationValidation {
  request: RestorationRequest;
  repositoryStatus: ReferenceValidationStatus;
  revisionStatus: ReferenceValidationStatus;
  analysisStatus: ReferenceValidationStatus;
  symbolStatus: ReferenceValidationStatus;
  fileStatus: ReferenceValidationStatus;
  lineSpanStatus: ReferenceValidationStatus;
  currentBranch: string | null;
  currentHead: string | null;
  currentIsDirty: boolean | null;
}
