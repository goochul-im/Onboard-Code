import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisSummary,
  GraphData,
  NoteRecord,
  RepositoryRecord,
  SourceFile,
  SymbolRecord,
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
  getNote: (repositoryId: string, symbolId: string) =>
    invoke<NoteRecord | null>("get_note", { repositoryId, symbolId }),
  saveNote: (repositoryId: string, symbolId: string, bodyMarkdown: string, tags: string[]) =>
    invoke<NoteRecord>("save_note", {
      repositoryId,
      symbolId,
      bodyMarkdown,
      tags,
    }),
  readSource: (repositoryId: string, symbolId: string) =>
    invoke<SourceFile>("read_source", { repositoryId, symbolId }),
};
