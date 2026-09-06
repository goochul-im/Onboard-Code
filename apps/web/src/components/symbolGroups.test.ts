import { describe, expect, it } from "vitest";
import type { SymbolRecord } from "../core";
import { groupSymbolsByOwner } from "./symbolGroups";
import { presentSymbol } from "./symbolPresentation";

describe("web symbol presentation", () => {
  it("shows the compact Class.Function parts", () => {
    expect(presentSymbol("src.feature.AuthController.login")).toEqual({
      className: "AuthController",
      methodName: "login",
    });
  });

  it("groups duplicate owner names by file", () => {
    const groups = groupSymbolsByOwner([
      symbol("a", "src.Admin.create", "src/Admin.ts"),
      symbol("b", "src.Admin.remove", "src/Admin.ts"),
      symbol("c", "legacy.Admin.create", "legacy/Admin.ts"),
    ]);
    expect(groups.map((group) => [group.ownerName, group.relativePath, group.symbols.length])).toEqual([
      ["Admin", "legacy/Admin.ts", 1],
      ["Admin", "src/Admin.ts", 2],
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
