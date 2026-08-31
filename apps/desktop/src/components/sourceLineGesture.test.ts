import { describe, expect, it } from "vitest";
import { isLineReferenceGesture } from "./sourceLineGesture";

describe("source line reference gesture", () => {
  it("starts only with Control and the primary pointer button", () => {
    expect(isLineReferenceGesture({ ctrlKey: true, button: 0 })).toBe(true);
    expect(isLineReferenceGesture({ ctrlKey: false, button: 0 })).toBe(false);
    expect(isLineReferenceGesture({ ctrlKey: true, button: 2 })).toBe(false);
  });
});
