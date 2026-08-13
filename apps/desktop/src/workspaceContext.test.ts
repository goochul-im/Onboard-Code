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
  it("preserves the selected analysis context from Find through Understand and Record", () => {
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
    let workspace: Workspace = "find";

    workspace = selectWorkspace(workspace, "understand");
    expect(workspace).toBe("understand");
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

    workspace = selectWorkspace(workspace, "find");
    expect(workspace).toBe("find");
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
    };
    expect(parseWorkspaceState(serializeWorkspaceState(state))).toEqual(state);
  });

  it("rejects incompatible and malformed snapshots", () => {
    expect(parseWorkspaceState('{"version":2}')).toBeNull();
    expect(parseWorkspaceState("not json")).toBeNull();
  });
});
