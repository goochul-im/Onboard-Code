import type { Workspace } from "./workspaces";

/**
 * Changes only the visible workspace. Repository, symbol, and document draft
 * state stay owned by App so navigation cannot discard in-progress analysis.
 */
export function selectWorkspace(_current: Workspace, next: Workspace): Workspace {
  return next;
}
