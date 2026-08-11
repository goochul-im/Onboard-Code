import { describe, expect, it } from "vitest";
import { findMarkdownBlock, parseMarkdownBlocks, replaceMarkdownRange } from "./markdownBlocks";

describe("Markdown live preview blocks", () => {
  it("splits ordinary paragraphs at a blank line and preserves offsets", () => {
    const value = "첫 문단\n\n두 번째 문단";
    const blocks = parseMarkdownBlocks(value);

    expect(blocks).toEqual([
      { start: 0, end: 6, raw: "첫 문단\n\n", content: "첫 문단" },
      { start: 6, end: value.length, raw: "두 번째 문단", content: "두 번째 문단" },
    ]);
  });

  it("does not split a fenced code block at its internal blank line", () => {
    const value = "```java\nreturn 1;\n\nreturn 2;\n```\n\n설명";
    const blocks = parseMarkdownBlocks(value);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].content).toContain("return 1;\n\nreturn 2;");
    expect(blocks[1].content).toBe("설명");
  });

  it("creates an editable empty block after a trailing blank line", () => {
    const value = "완성한 문단\n\n";
    const blocks = parseMarkdownBlocks(value);

    expect(blocks.at(-1)).toEqual({
      start: value.length,
      end: value.length,
      raw: "",
      content: "",
    });
    expect(findMarkdownBlock(blocks, value.length).raw).toBe("");
  });

  it("inserts a source line reference at a global cursor offset", () => {
    const value = "첫 문단\n\n분석 내용";
    const start = value.indexOf("분석") + 2;
    const next = replaceMarkdownRange(value, start, start, "[line:31-35]");

    expect(next).toBe("첫 문단\n\n분석[line:31-35] 내용");
    expect(findMarkdownBlock(parseMarkdownBlocks(next), start + 12).content).toContain("[line:31-35]");
  });
});
