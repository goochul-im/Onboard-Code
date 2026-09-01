import { describe, expect, it } from "vitest";
import { buildConfluenceExport } from "./confluenceExport";

describe("Confluence export", () => {
  it("replaces line references with escaped source code blocks", () => {
    const exported = buildConfluenceExport({
      title: "입력 검증",
      markdown: "## 역할\n\n[line:2-3]\n\n**완료**",
      tags: ["인증", "핵심"],
      symbolFqn: "example.Service.validate",
      signature: "(value: string)",
      relativePath: "src/Service.ts",
      source: "const value = input;\nif (value < 2) {\n  return false;\n}",
      language: "typescript",
    });

    expect(exported.resolvedReferenceCount).toBe(1);
    expect(exported.unresolvedReferenceCount).toBe(0);
    expect(exported.html).toContain("<h2>역할</h2>");
    expect(exported.html).toContain("if (value &lt; 2)");
    expect(exported.html).toContain('<pre><code class="language-typescript">');
    expect(exported.html).not.toContain("[line:2-3]");
    expect(exported.text).toContain("```typescript\nif (value < 2)");
    expect(exported.text).toContain("태그: 인증, 핵심");
  });

  it("keeps an explicit warning when a reference is outside the source", () => {
    const exported = buildConfluenceExport({
      title: "범위 오류",
      markdown: "[line:99] 설명",
      tags: [],
      symbolFqn: "example.run",
      signature: "()",
      relativePath: "run.py",
      source: "def run():\n    pass",
      language: "python",
    });

    expect(exported.resolvedReferenceCount).toBe(0);
    expect(exported.unresolvedReferenceCount).toBe(1);
    expect(exported.html).toContain("[line:99]");
    expect(exported.html).toContain("현재 소스에서 찾지 못함");
  });
});
