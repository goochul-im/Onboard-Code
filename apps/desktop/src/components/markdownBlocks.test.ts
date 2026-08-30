import { describe, expect, it } from "vitest";
import { replaceMarkdownRange } from "./markdownBlocks";

describe("Markdown editing", () => {
  it("inserts a source line reference at the current cursor offset", () => {
    const value = "첫 문단\n\n분석 내용";
    const start = value.indexOf("분석") + 2;
    const next = replaceMarkdownRange(value, start, start, "[line:31-35]");

    expect(next).toBe("첫 문단\n\n분석[line:31-35] 내용");
  });
});
