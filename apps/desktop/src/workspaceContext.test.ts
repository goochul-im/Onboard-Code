import { describe, expect, it } from "vitest";
import { parseWorkspaceState, selectWorkspace, serializeWorkspaceState } from "./workspaceContext";
import type { Workspace } from "./workspaces";

interface AnalysisContextFixture {
  repositoryId: string;
  selectedFunctionId: string;
  activeDocumentId: number;
  draft: { title: string; body: string; tags: string };
}

describe("workspace navigation", () => {
  it("preserves the selected analysis context between Explore and Record", () => {
    const context: AnalysisContextFixture = {
      repositoryId: "fixture-repository",
      selectedFunctionId: "com.example.AuthController.createRefreshCookie",
      activeDocumentId: 42,
      draft: {
        title: "Refresh cookie analysis",
        body: "Unsaved reasoning about the expiry branch.",
        tags: "auth, cookie, unsaved",
      },
    };
    let workspace: Workspace = "explore";

    workspace = selectWorkspace(workspace, "explore");
    expect(workspace).toBe("explore");
    expect(context).toEqual({
      repositoryId: "fixture-repository",
      selectedFunctionId: "com.example.AuthController.createRefreshCookie",
      activeDocumentId: 42,
      draft: {
        title: "Refresh cookie analysis",
        body: "Unsaved reasoning about the expiry branch.",
        tags: "auth, cookie, unsaved",
      },
    });

    workspace = selectWorkspace(workspace, "record");
    expect(workspace).toBe("record");
    expect(context.selectedFunctionId).toBe("com.example.AuthController.createRefreshCookie");
    expect(context.activeDocumentId).toBe(42);
    expect(context.draft).toEqual({
      title: "Refresh cookie analysis",
      body: "Unsaved reasoning about the expiry branch.",
      tags: "auth, cookie, unsaved",
    });

    workspace = selectWorkspace(workspace, "explore");
    expect(workspace).toBe("explore");
    expect(context.repositoryId).toBe("fixture-repository");
    expect(context.draft.body).toBe("Unsaved reasoning about the expiry branch.");
  });
});

describe("workspace snapshot", () => {
  it("round-trips the selected workspace and unsaved drafts", () => {
    const state = {
      version: 1 as const,
      activeWorkspace: "record" as const,
      query: "AuthController",
      depth: 2,
      selectedSymbol: null,
      selectedNoteId: 7,
      noteDrafts: [{
        id: 7, symbolId: "symbol-1", title: "로그인 흐름",
        bodyMarkdown: "[line:31] 검증", tags: ["인증"], tagsInput: "인증",
        updatedAt: "2026-08-13T00:00:00Z", status: "linked" as const, isDirty: true,
      }],
      lineReferenceRange: { start: 31, end: 35 },
      graphViewport: { zoom: 1.2, panX: 30, panY: -10 },
      sourceScrollTop: 240,
      markdownSelection: { start: 8, end: 8 },
      markdownScrollTop: 90,
      selectedCollectionId: 12,
    };
    expect(parseWorkspaceState(serializeWorkspaceState(state))).toEqual(state);
  });

  it("accepts Collections as a restorable workspace", () => {
    const state = JSON.stringify({
      version: 1,
      activeWorkspace: "collections",
      query: "",
      depth: 1,
      selectedSymbol: null,
      selectedNoteId: null,
      noteDrafts: [],
      selectedCollectionId: 9,
    });

    expect(parseWorkspaceState(state)?.activeWorkspace).toBe("collections");
    expect(parseWorkspaceState(state)?.selectedCollectionId).toBe(9);
  });

  it("rejects incompatible and malformed snapshots", () => {
    expect(parseWorkspaceState('{"version":2}')).toBeNull();
    expect(parseWorkspaceState("not json")).toBeNull();
  });

  it("migrates legacy Find and Understand snapshots to Explore", () => {
    const legacy = (activeWorkspace: string) => JSON.stringify({
      version: 1, activeWorkspace, query: "", depth: 1, noteDrafts: [],
    });
    expect(parseWorkspaceState(legacy("find"))?.activeWorkspace).toBe("explore");
    expect(parseWorkspaceState(legacy("understand"))?.activeWorkspace).toBe("explore");
  });
});
