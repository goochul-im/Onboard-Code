import { describe, expect, it } from "vitest";
import { buildGraph, languageFromPath, type GraphEdge, type SymbolRecord } from ".";

const symbols: SymbolRecord[] = [
  makeSymbol("a", "Feature.start"),
  makeSymbol("b", "Feature.load"),
  makeSymbol("c", "Feature.render"),
];

const edges: GraphEdge[] = [
  { id: 1, source: "a", target: "b", unresolvedName: null, confidence: "resolved", sourceLine: 2 },
  { id: 2, source: "b", target: "c", unresolvedName: null, confidence: "resolved", sourceLine: 2 },
  { id: 3, source: "a", target: null, unresolvedName: "missing", confidence: "unresolved", sourceLine: 3 },
];

describe("browser graph helpers", () => {
  it("detects supported web languages by extension", () => {
    expect(languageFromPath("Service.java")).toBe("java");
    expect(languageFromPath("app/example.py")).toBe("python");
    expect(languageFromPath("page.tsx")).toBe("typescript");
    expect(languageFromPath("README.md")).toBeNull();
  });

  it("builds a selected-function graph by depth", () => {
    expect(buildGraph(symbols, edges, "a", 1).nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(buildGraph(symbols, edges, "a", 2).nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(buildGraph(symbols, edges, "a", 2).edges).toHaveLength(3);
  });
});

function makeSymbol(id: string, fqn: string): SymbolRecord {
  return {
    id,
    language: "typescript",
    kind: "function",
    fqn,
    signature: "()",
    relativePath: `src/${id}.ts`,
    startLine: 1,
    endLine: 4,
    astFingerprint: id,
  };
}
