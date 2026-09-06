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
    expect(html).toContain("서버로 업로드하지 않고 브라우저 안에서만 분석");
    expect(html).toContain("커밋 변경 영향 분석을 제공하지 않습니다");
    expect(html).toContain("Java(.java), Python(.py), PHP(.php), TypeScript(.ts/.tsx)");
  });
});
