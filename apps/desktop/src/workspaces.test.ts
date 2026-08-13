import { describe, expect, it } from "vitest";
import { defaultWorkspace, workspaces } from "./workspaces";

describe("workspace layout", () => {
  it("starts in Find and gives every workspace one primary surface", () => {
    expect(defaultWorkspace).toBe("find");
    expect(workspaces).toEqual([
      expect.objectContaining({ id: "find", primarySurface: "search-results" }),
      expect.objectContaining({ id: "understand", primarySurface: "caller-callee-graph" }),
      expect.objectContaining({ id: "record", primarySurface: "source-markdown-split" }),
    ]);
  });
});
