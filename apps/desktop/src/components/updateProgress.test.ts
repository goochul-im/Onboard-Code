import { describe, expect, it } from "vitest";
import { formatUpdateProgress } from "./updateProgress";

describe("update progress", () => {
  it("formats determinate and indeterminate downloads", () => {
    expect(formatUpdateProgress("0.2.0", 25, 100)).toBe("v0.2.0 다운로드 25%");
    expect(formatUpdateProgress("0.2.0", 25, 0)).toBe("v0.2.0 다운로드 중…");
    expect(formatUpdateProgress("0.2.0", 150, 100)).toBe("v0.2.0 다운로드 100%");
  });
});
