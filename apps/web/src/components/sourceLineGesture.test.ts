import { describe, expect, it } from "vitest";
import { isLineReferenceGesture, lineReferenceModifierForUserAgent } from "./sourceLineGesture";

describe("web source line reference gesture", () => {
  it("accepts Command or Control with the primary pointer button", () => {
    expect(isLineReferenceGesture({ metaKey: true, ctrlKey: false, button: 0 })).toBe(true);
    expect(isLineReferenceGesture({ metaKey: false, ctrlKey: true, button: 0 })).toBe(true);
    expect(isLineReferenceGesture({ metaKey: false, ctrlKey: false, button: 0 })).toBe(false);
    expect(isLineReferenceGesture({ metaKey: true, ctrlKey: false, button: 2 })).toBe(false);
  });

  it("uses the platform-native modifier label", () => {
    expect(lineReferenceModifierForUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toEqual({ label: "⌘", name: "Command" });
    expect(lineReferenceModifierForUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toEqual({ label: "Ctrl", name: "Control" });
  });
});
