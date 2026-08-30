import { describe, expect, it } from "vitest";
import { resolveSourceScrollTop } from "./sourceScroll";

describe("source scroll restoration", () => {
  it("preserves an intentional top position instead of centering again", () => {
    expect(resolveSourceScrollTop({
      shouldCenter: false,
      savedScrollTop: 0,
      selectedLineTop: 1200,
      selectedLineHeight: 20,
      viewportHeight: 500,
      scrollHeight: 2200,
    })).toBe(0);
  });

  it("centers the selected line when a function is opened for the first time", () => {
    expect(resolveSourceScrollTop({
      shouldCenter: true,
      savedScrollTop: 0,
      selectedLineTop: 1200,
      selectedLineHeight: 20,
      viewportHeight: 500,
      scrollHeight: 2200,
    })).toBe(960);
  });

  it("clamps restored positions to the current source bounds", () => {
    expect(resolveSourceScrollTop({
      shouldCenter: false,
      savedScrollTop: 4000,
      selectedLineTop: 0,
      selectedLineHeight: 20,
      viewportHeight: 500,
      scrollHeight: 2200,
    })).toBe(1700);
  });
});
