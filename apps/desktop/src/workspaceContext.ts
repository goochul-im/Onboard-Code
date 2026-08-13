import type { Workspace } from "./workspaces";
import type { NoteRecord, SymbolRecord } from "./types";

export const workspaceSnapshotSchemaVersion = 1;
export const workspaceDatabaseFormatVersion = 1;

export interface PersistedNoteDraft extends NoteRecord {
  tagsInput: string;
  isDirty: boolean;
}

export interface PersistedWorkspaceState {
  version: 1;
  activeWorkspace: Workspace;
  query: string;
  depth: number;
  selectedSymbol: SymbolRecord | null;
  selectedNoteId: number | null;
  noteDrafts: PersistedNoteDraft[];
  lineReferenceRange: { start: number; end: number } | null;
  graphViewport: { zoom: number; panX: number; panY: number } | null;
  sourceScrollTop: number;
  markdownSelection: { start: number; end: number } | null;
  markdownScrollTop: number;
}

/**
 * Changes only the visible workspace. Repository, symbol, and document draft
 * state stay owned by App so navigation cannot discard in-progress analysis.
 */
export function selectWorkspace(_current: Workspace, next: Workspace): Workspace {
  return next;
}

export function serializeWorkspaceState(state: PersistedWorkspaceState): string {
  return JSON.stringify(state);
}

export function parseWorkspaceState(value: string): PersistedWorkspaceState | null {
  try {
    const state = JSON.parse(value) as Partial<PersistedWorkspaceState>;
    if (state.version !== 1 || !isWorkspace(state.activeWorkspace)) return null;
    if (typeof state.query !== "string" || !Number.isInteger(state.depth)
      || state.depth! < 1 || state.depth! > 3 || !Array.isArray(state.noteDrafts)) return null;
    return {
      version: 1,
      activeWorkspace: state.activeWorkspace,
      query: state.query,
      depth: state.depth as number,
      selectedSymbol: state.selectedSymbol ?? null,
      selectedNoteId: Number.isInteger(state.selectedNoteId) ? state.selectedNoteId! : null,
      noteDrafts: state.noteDrafts,
      lineReferenceRange: validLineRange(state.lineReferenceRange) ? state.lineReferenceRange : null,
      graphViewport: validGraphViewport(state.graphViewport) ? state.graphViewport : null,
      sourceScrollTop: validOffset(state.sourceScrollTop) ? state.sourceScrollTop : 0,
      markdownSelection: validSelection(state.markdownSelection) ? state.markdownSelection : null,
      markdownScrollTop: validOffset(state.markdownScrollTop) ? state.markdownScrollTop : 0,
    };
  } catch {
    return null;
  }
}

function validOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validSelection(value: unknown): value is { start: number; end: number } {
  if (!value || typeof value !== "object") return false;
  const selection = value as { start?: unknown; end?: unknown };
  return Number.isInteger(selection.start) && Number.isInteger(selection.end)
    && Number(selection.start) >= 0 && Number(selection.end) >= Number(selection.start);
}

function validGraphViewport(value: unknown): value is { zoom: number; panX: number; panY: number } {
  if (!value || typeof value !== "object") return false;
  const viewport = value as { zoom?: unknown; panX?: unknown; panY?: unknown };
  return typeof viewport.zoom === "number" && Number.isFinite(viewport.zoom) && viewport.zoom > 0
    && typeof viewport.panX === "number" && Number.isFinite(viewport.panX)
    && typeof viewport.panY === "number" && Number.isFinite(viewport.panY);
}

function isWorkspace(value: unknown): value is Workspace {
  return value === "find" || value === "understand" || value === "record";
}

function validLineRange(value: unknown): value is { start: number; end: number } {
  if (!value || typeof value !== "object") return false;
  const range = value as { start?: unknown; end?: unknown };
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && Number(range.start) > 0 && Number(range.end) >= Number(range.start);
}
