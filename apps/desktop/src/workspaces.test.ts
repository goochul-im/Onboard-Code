import { describe, expect, it } from "vitest";
import { defaultWorkspace, workspaces } from "./workspaces";

describe("workspace layout", () => {
  it("starts in Explore and gives every workspace one primary surface", () => {
    expect(defaultWorkspace).toBe("explore");
    expect(workspaces).toEqual([
      expect.objectContaining({ id: "explore", primarySurface: "search-and-call-graph" }),
      expect.objectContaining({ id: "record", primarySurface: "source-markdown-split" }),
    ]);
  });
});
