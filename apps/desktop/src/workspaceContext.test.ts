import { describe, expect, it } from "vitest";
import { selectWorkspace } from "./workspaceContext";
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
