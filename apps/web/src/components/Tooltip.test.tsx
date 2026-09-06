import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { privacyTooltipText } from "../core";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders the web deployment limits for hover and focus discovery", () => {
    const html = renderToStaticMarkup(
      <Tooltip label="웹 배포판">
        <span>{privacyTooltipText}</span>
      </Tooltip>,
    );

    expect(html).toContain("웹 배포판 도움말");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("서버로 업로드하지 않고 브라우저 안에서만 분석");
    expect(html).toContain("커밋 변경 영향 분석을 제공하지 않습니다");
    expect(html).toContain("지원 소스 5,000개, 파일당 2MB");
    expect(html).toContain("함수당 한 개의 기본 노트");
    expect(html).toContain("개요·태그·수동 재연결·검토 완료");
    expect(html).toContain("여러 저장소를 동시에 등록");
    expect(html).toContain("Java(.java), Python(.py), PHP(.php), TypeScript(.ts/.tsx)");
  });
});
