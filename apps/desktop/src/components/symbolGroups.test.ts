import { describe, expect, it } from "vitest";
import type { SymbolRecord } from "../types";
import { groupSymbolsByOwner } from "./symbolGroups";

describe("symbol grouping", () => {
  it("groups methods by owner and file without merging duplicate class names", () => {
    const symbols = [
      symbol("one", "src.AdminController.create", "src/AdminController.ts"),
      symbol("two", "src.AdminController.remove", "src/AdminController.ts"),
      symbol("three", "legacy.AdminController.create", "legacy/AdminController.ts"),
      symbol("four", "src.UserController.find", "src/UserController.ts"),
    ];

    const groups = groupSymbolsByOwner(symbols);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => [group.ownerName, group.relativePath, group.symbols.length])).toEqual([
      ["AdminController", "legacy/AdminController.ts", 1],
      ["AdminController", "src/AdminController.ts", 2],
      ["UserController", "src/UserController.ts", 1],
    ]);
  });
});

function symbol(id: string, fqn: string, relativePath: string): SymbolRecord {
  return {
    id,
    language: "typescript",
    kind: "method",
    fqn,
    signature: "()",
    relativePath,
    startLine: 1,
    endLine: 2,
    astFingerprint: id,
  };
}
