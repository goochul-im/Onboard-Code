import { describe, expect, it } from "vitest";
import { placeGraphNodeAction } from "./graphNodeAction";

describe("web graph node action placement", () => {
  it("places the action beside the selected node when possible", () => {
    expect(placeGraphNodeAction({ x1: 100, x2: 296, y1: 80, y2: 164 }, 900, 500, 126, 34))
      .toEqual({ left: 308, top: 105, placement: "right" });
  });

  it("keeps the fallback action inside a narrow graph", () => {
    expect(placeGraphNodeAction({ x1: 42, x2: 238, y1: 420, y2: 504 }, 280, 540, 126, 34))
      .toEqual({ left: 77, top: 496, placement: "below" });
  });
});
