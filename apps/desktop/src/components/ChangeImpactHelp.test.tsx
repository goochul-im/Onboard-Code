import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeImpactHelp } from "./ChangeImpactHelp";

describe("ChangeImpactHelp", () => {
  it("explains the comparison baseline, scope, and confidence boundary", () => {
    const html = renderToStaticMarkup(<ChangeImpactHelp />);

    expect(html).toContain("aria-label=\"변경된 코드 확인 안내\"");
    expect(html).toContain("마지막으로 완료된 코드 분석 이후");
    expect(html).toContain("staged·unstaged");
    expect(html).toContain("런타임 영향을 확정하지 않습니다");
  });
});
