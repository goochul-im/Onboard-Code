import { analysisHelpSections } from "./analysisSupport";

export function AnalysisHelp() {
  return (
    <div className="analysis-help">
      <button
        className="analysis-help-trigger"
        type="button"
        aria-label="코드 분석 지원 정보"
        aria-describedby="analysis-help-tooltip"
      >
        ?
      </button>
      <div className="analysis-help-tooltip" id="analysis-help-tooltip" role="tooltip">
        {analysisHelpSections.map((section) => (
          <section key={section.title}>
            <strong>{section.title}</strong>
            <ul>
              {section.items.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <code>{item.detail}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
