import { describe, expect, it } from "vitest";
import { findLineReferenceAt, parseLineReference } from "./lineReference";

describe("line references", () => {
  it("parses single and ranged references", () => {
    expect(parseLineReference("[line:31]")).toEqual({ start: 31, end: 31 });
    expect(parseLineReference("[line:35-31]")).toEqual({ start: 31, end: 35 });
    expect(parseLineReference("[line:0]")).toBeNull();
  });

  it("finds a reference under the editor cursor", () => {
    const value = "역할 [line:31-35] 분석";
    expect(findLineReferenceAt(value, value.indexOf("31"))).toEqual({ start: 31, end: 35 });
    expect(findLineReferenceAt(value, 1)).toBeNull();
  });
});
