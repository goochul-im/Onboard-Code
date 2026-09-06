import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("web analysis entry points", () => {
  it("offers local folder selection without a direct source paste form", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("폴더 열기");
    expect(html).toContain("파일로 열기");
    expect(html).not.toContain("붙여넣기 경로");
    expect(html).not.toContain("붙여넣기 코드");
    expect(html).not.toContain("붙여넣기 분석");
  });
});
