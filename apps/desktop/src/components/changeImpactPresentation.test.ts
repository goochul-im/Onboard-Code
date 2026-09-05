import { describe, expect, it } from "vitest";
import type { ChangeImpactReport, SymbolRecord } from "../types";
import { impactSummary, impactSymbolLabel } from "./changeImpactPresentation";

const symbol: SymbolRecord = {
  id: "symbol_refund",
  language: "java",
  kind: "method",
  fqn: "com.example.payment.PaymentClient.refund",
  signature: "(Order)",
  relativePath: "src/PaymentClient.java",
  startLine: 12,
  endLine: 20,
  astFingerprint: "fingerprint",
};

function report(overrides: Partial<ChangeImpactReport> = {}): ChangeImpactReport {
  return {
    status: "changed",
    repositoryId: "repo_1",
    baseRevision: "abc123",
    currentRevision: "def456",
    branch: "main",
    isDirty: true,
    changedFiles: ["src/PaymentClient.java"],
    changes: [{ kind: "modified", symbol, previousSymbol: symbol }],
    affectedCallers: [{ symbol: { ...symbol, id: "caller" }, distance: 1, changedSymbols: [symbol.fqn] }],
    diagnosticCount: 0,
    ...overrides,
  };
}

describe("change impact presentation", () => {
  it("uses Class.Function for a narrow impact label", () => {
    expect(impactSymbolLabel(symbol)).toBe("PaymentClient.refund");
  });

  it("summarizes changed files, functions, and callers", () => {
    expect(impactSummary(report())).toBe("1개 파일 · 1개 함수 변경 · 1개 호출자 확인 필요");
  });

  it("distinguishes missing baselines and unchanged analyses", () => {
    expect(impactSummary(report({ status: "noBaseline", baseRevision: null }))).toContain("이전 분석");
    expect(impactSummary(report({ status: "unchanged", changes: [], affectedCallers: [] }))).toContain("변경이 없습니다");
  });
});
