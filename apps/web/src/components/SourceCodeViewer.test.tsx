import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceFile, SymbolRecord } from "../core";
import { SourceCodeViewer } from "./SourceCodeViewer";

describe("SourceCodeViewer", () => {
  it("renders IDE-like tokens, line numbers, and the selected function range", () => {
    const sourceFile: SourceFile = {
      relativePath: "src/Demo.ts",
      source: "export class Demo {\n  run(): string { return \"ok\"; }\n}",
      startLine: 1,
      endLine: 3,
    };
    const selectedSymbol: SymbolRecord = {
      id: "run",
      language: "typescript",
      kind: "method",
      fqn: "src.Demo.run",
      signature: "()",
      relativePath: "src/Demo.ts",
      startLine: 2,
      endLine: 2,
      astFingerprint: "run",
    };

    const html = renderToStaticMarkup(
      <SourceCodeViewer
        sourceFile={sourceFile}
        selectedSymbol={selectedSymbol}
        modifier={{ label: "⌘", name: "Command" }}
        onInsertLineReference={() => undefined}
      />,
    );

    expect(html).toContain("<kbd>⌘</kbd>+클릭");
    expect(html).toContain('data-line-number="2"');
    expect(html).toContain("code-line selected");
    expect(html).toContain("token-keyword");
    expect(html).toContain("token-type");
    expect(html).toContain("token-string");
  });
});
