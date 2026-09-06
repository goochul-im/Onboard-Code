import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("web analysis entry points", () => {
  it("offers local folder selection without a direct source paste form", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("저장소 열기");
    expect(html).toContain("파일 선택으로 열기");
    expect(html).toContain('class="workspace-nav"');
    expect(html).toContain('class="workspace-grid workspace-explore"');
    expect(html).toContain('class="sidebar explore-sidebar"');
    expect(html).toContain('class="graph-panel"');
    expect(html).not.toContain("source-panel");
    expect(html).not.toContain("붙여넣기 경로");
    expect(html).not.toContain("붙여넣기 코드");
    expect(html).not.toContain("붙여넣기 분석");
  });
});
