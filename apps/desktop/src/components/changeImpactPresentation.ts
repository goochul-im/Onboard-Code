import type { ChangeImpactReport, ImpactChangeKind, SymbolRecord } from "../types";

export const impactChangeLabels: Record<ImpactChangeKind, string> = {
  added: "추가",
  modified: "수정",
  deleted: "삭제",
  moved: "이동",
};

export function impactSymbolLabel(symbol: SymbolRecord | null): string {
  if (!symbol) return "알 수 없는 함수";
  const parts = symbol.fqn.split(".").filter(Boolean);
  return parts.slice(-2).join(".") || symbol.fqn;
}

export function impactSummary(report: ChangeImpactReport): string {
  if (report.status === "noBaseline") {
    return "비교할 이전 분석이 없습니다.";
  }
  if (report.status === "unchanged") {
    return "마지막 분석 이후 함수 변경이 없습니다.";
  }
  return `${report.changedFiles.length}개 파일 · ${report.changes.length}개 함수 변경 · ${report.affectedCallers.length}개 호출자 확인 필요`;
}
