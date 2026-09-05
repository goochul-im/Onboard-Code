export function ChangeImpactHelp() {
  return (
    <div className="analysis-help change-impact-help">
      <button
        className="analysis-help-trigger"
        type="button"
        aria-label="변경된 코드 확인 안내"
        aria-describedby="change-impact-help-tooltip"
      >
        ?
      </button>
      <div className="analysis-help-tooltip" id="change-impact-help-tooltip" role="tooltip">
        <section>
          <strong>무엇을 확인하나요?</strong>
          <p>마지막으로 완료된 코드 분석 이후 변경된 함수와 영향을 받을 수 있는 caller를 확인합니다.</p>
        </section>
        <section>
          <strong>어떤 변경을 포함하나요?</strong>
          <p>새 커밋뿐 아니라 staged·unstaged 변경과 새로 추가한 지원 소스 파일도 함께 비교합니다.</p>
        </section>
        <section>
          <strong>결과는 어떻게 해석하나요?</strong>
          <p>정적 호출 관계를 기준으로 한 확인 후보이며 실제 런타임 영향을 확정하지 않습니다.</p>
        </section>
      </div>
    </div>
  );
}
