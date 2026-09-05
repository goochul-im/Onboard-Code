import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisSummary,
  CollectionDetail,
  CollectionItem,
  CollectionSummary,
  ChangeImpactReport,
  GraphData,
  NoteRecord,
  OrphanNote,
  RepositoryRecord,
  SourceFile,
  SymbolRecord,
  RestorationRequest,
  RestorationValidation,
  WorkspaceSnapshot,
  WorkspaceSnapshotRequest,
} from "./types";

export const api = {
  listRepositories: () => invoke<RepositoryRecord[]>("list_repositories"),
  registerRepository: (path: string) =>
    invoke<RepositoryRecord>("register_repository", { path }),
  analyzeRepository: (repositoryId: string) =>
    invoke<AnalysisSummary>("analyze_repository", { repositoryId }),
  getChangeImpact: (repositoryId: string) =>
    invoke<ChangeImpactReport>("get_change_impact", { repositoryId }),
  listCollections: (repositoryId: string) =>
    invoke<CollectionSummary[]>("list_collections", { repositoryId }),
  searchCollections: (repositoryId: string, query: string) =>
    invoke<CollectionSummary[]>("search_collections", { repositoryId, query }),
  getCollection: (repositoryId: string, collectionId: number) =>
    invoke<CollectionDetail | null>("get_collection", { repositoryId, collectionId }),
  createCollection: (repositoryId: string, title: string, overviewMarkdown: string, tags: string[]) =>
    invoke<CollectionDetail>("create_collection", { repositoryId, title, overviewMarkdown, tags }),
  updateCollection: (
    repositoryId: string,
    collectionId: number,
    title: string,
    overviewMarkdown: string,
    tags: string[],
  ) =>
    invoke<CollectionDetail>("update_collection", {
      repositoryId,
      collectionId,
      title,
      overviewMarkdown,
      tags,
    }),
  deleteCollection: (repositoryId: string, collectionId: number) =>
    invoke<void>("delete_collection", { repositoryId, collectionId }),
  addCollectionItem: (
    repositoryId: string,
    collectionId: number,
    symbolId: string,
    role: string,
    memo: string,
  ) =>
    invoke<CollectionDetail>("add_collection_item", { repositoryId, collectionId, symbolId, role, memo }),
  updateCollectionItem: (
    repositoryId: string,
    collectionId: number,
    itemId: number,
    role: string,
    memo: string,
  ) =>
    invoke<CollectionItem>("update_collection_item", { repositoryId, collectionId, itemId, role, memo }),
  reorderCollectionItems: (repositoryId: string, collectionId: number, itemIds: number[]) =>
    invoke<CollectionDetail>("reorder_collection_items", { repositoryId, collectionId, itemIds }),
  removeCollectionItem: (repositoryId: string, collectionId: number, itemId: number) =>
    invoke<CollectionDetail>("remove_collection_item", { repositoryId, collectionId, itemId }),
  markCollectionItemReviewed: (repositoryId: string, collectionId: number, itemId: number) =>
    invoke<CollectionItem>("mark_collection_item_reviewed", { repositoryId, collectionId, itemId }),
  relinkCollectionItem: (repositoryId: string, collectionId: number, itemId: number, symbolId: string) =>
    invoke<CollectionItem>("relink_collection_item", { repositoryId, collectionId, itemId, symbolId }),
  getCollectionGraph: (repositoryId: string, collectionId: number) =>
    invoke<GraphData>("get_collection_graph", { repositoryId, collectionId }),
  searchSymbols: (repositoryId: string, query: string) =>
    invoke<SymbolRecord[]>("search_symbols", { repositoryId, query }),
  getGraph: (repositoryId: string, rootSymbolId: string, depth: number) =>
    invoke<GraphData>("get_graph", { repositoryId, rootSymbolId, depth }),
  listNotes: (repositoryId: string, symbolId: string) =>
    invoke<NoteRecord[]>("list_notes", { repositoryId, symbolId }),
  getNote: (repositoryId: string, symbolId: string) =>
    invoke<NoteRecord | null>("get_note", { repositoryId, symbolId }),
  createNote: (repositoryId: string, symbolId: string, title: string) =>
    invoke<NoteRecord>("create_note", { repositoryId, symbolId, title }),
  updateNote: (
    repositoryId: string,
    symbolId: string,
    noteId: number,
    title: string,
    bodyMarkdown: string,
    tags: string[],
  ) =>
    invoke<NoteRecord>("update_note", {
      repositoryId,
      symbolId,
      noteId,
      title,
      bodyMarkdown,
      tags,
    }),
  saveNote: (repositoryId: string, symbolId: string, bodyMarkdown: string, tags: string[]) =>
    invoke<NoteRecord>("save_note", {
      repositoryId,
      symbolId,
      bodyMarkdown,
      tags,
    }),
  listOrphanNotes: (repositoryId: string) =>
    invoke<OrphanNote[]>("list_orphan_notes", { repositoryId }),
  readSource: (repositoryId: string, symbolId: string) =>
    invoke<SourceFile>("read_source", { repositoryId, symbolId }),
  saveWorkspaceSnapshot: (request: WorkspaceSnapshotRequest) =>
    invoke<WorkspaceSnapshot>("save_workspace_snapshot", { request }),
  currentWorkspaceSnapshot: (repositoryId: string) =>
    invoke<WorkspaceSnapshot | null>("current_workspace_snapshot", { repositoryId }),
  validateRestorationReferences: (request: RestorationRequest) =>
    invoke<RestorationValidation>("validate_restoration_references", { request }),
};
