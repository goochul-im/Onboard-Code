import type { ChangeImpactReport } from "../types";
import { impactChangeLabels, impactSummary, impactSymbolLabel } from "./changeImpactPresentation";

interface ChangeImpactPanelProps {
  report: ChangeImpactReport;
}

export function ChangeImpactPanel({ report }: ChangeImpactPanelProps) {
  const revisionLabel = report.baseRevision
    ? `${report.baseRevision} → ${report.currentRevision}`
    : report.currentRevision;

  return (
    <details className={`change-impact-panel status-${report.status}`} open={report.status === "changed"}>
      <summary>
        <span>변경 영향</span>
        <small>{impactSummary(report)}</small>
      </summary>
      <div className="change-impact-meta">
        <code>{revisionLabel}</code>
        <span>{report.branch}{report.isDirty ? " · 커밋하지 않은 변경 포함" : ""}</span>
      </div>

      {report.status === "noBaseline" && (
        <p>먼저 코드 분석을 실행하면 그 시점의 커밋과 호출 그래프가 비교 기준으로 저장됩니다.</p>
      )}

      {report.status === "unchanged" && (
        <p>{report.changedFiles.length > 0
          ? "파일 변경은 있지만 분석 가능한 함수의 구조는 동일합니다."
          : "커밋과 작업 트리에서 분석 대상 변경을 찾지 못했습니다."}</p>
      )}

      {report.changes.length > 0 && (
        <section>
          <strong>직접 변경된 함수</strong>
          <ul>
            {report.changes.map((change, index) => {
              const symbol = change.symbol ?? change.previousSymbol;
              return (
                <li key={`${change.kind}-${symbol?.id ?? index}`}>
                  <span className={`impact-kind kind-${change.kind}`}>{impactChangeLabels[change.kind]}</span>
                  <span title={symbol?.fqn}>{impactSymbolLabel(symbol)}</span>
                  {symbol && <small>{symbol.relativePath}:{symbol.startLine}</small>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {report.affectedCallers.length > 0 && (
        <section>
          <strong>영향 가능성이 있는 호출자</strong>
          <ul>
            {report.affectedCallers.map((caller) => (
              <li key={caller.symbol.id}>
                <span title={caller.symbol.fqn}>{impactSymbolLabel(caller.symbol)}</span>
                <small>{caller.distance}단계 · {caller.symbol.relativePath}:{caller.symbol.startLine}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.changedFiles.length > 0 && (
        <section>
          <strong>변경 파일</strong>
          <ul className="impact-file-list">
            {report.changedFiles.map((path) => <li key={path}><code>{path}</code></li>)}
          </ul>
        </section>
      )}

      {report.diagnosticCount > 0 && (
        <p className="impact-warning">임시 분석에서 확인할 진단 {report.diagnosticCount}건이 있습니다.</p>
      )}
      {report.status === "changed" && (
        <p className="impact-caveat">정적 호출 관계를 기준으로 한 확인 후보입니다. 코드 분석을 실행하면 현재 그래프에 반영됩니다.</p>
      )}
    </details>
  );
}
