import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChangeImpactReport, SymbolRecord } from "../types";
import { ChangeImpactPanel } from "./ChangeImpactPanel";

const changedSymbol: SymbolRecord = {
  id: "callee",
  language: "java",
  kind: "method",
  fqn: "example.PaymentClient.refund",
  signature: "()",
  relativePath: "src/PaymentClient.java",
  startLine: 10,
  endLine: 14,
  astFingerprint: "current",
};

const callerSymbol: SymbolRecord = {
  ...changedSymbol,
  id: "caller",
  fqn: "example.OrderService.cancel",
  relativePath: "src/OrderService.java",
  startLine: 24,
};

describe("ChangeImpactPanel", () => {
  it("renders a changed function and its reverse caller candidate", () => {
    const report: ChangeImpactReport = {
      status: "changed",
      repositoryId: "repo_1",
      baseRevision: "abc123",
      currentRevision: "def456",
      branch: "feature/payment",
      isDirty: true,
      changedFiles: ["src/PaymentClient.java"],
      changes: [{ kind: "modified", symbol: changedSymbol, previousSymbol: { ...changedSymbol, astFingerprint: "previous" } }],
      affectedCallers: [{ symbol: callerSymbol, distance: 1, changedSymbols: [changedSymbol.id] }],
      diagnosticCount: 0,
    };

    const html = renderToStaticMarkup(<ChangeImpactPanel report={report} />);

    expect(html).toContain("<details class=\"change-impact-panel status-changed\" open=\"\"");
    expect(html).toContain("PaymentClient.refund");
    expect(html).toContain("OrderService.cancel");
    expect(html).toContain("1단계");
    expect(html).toContain("커밋하지 않은 변경 포함");
  });
});
