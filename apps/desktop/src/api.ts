import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisSummary,
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
