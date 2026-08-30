import { describe, expect, it } from "vitest";
import { placeGraphNodeAction } from "./graphNodeAction";

describe("graph node action placement", () => {
  it("places the action to the right when space is available", () => {
    expect(placeGraphNodeAction(
      { x1: 100, x2: 296, y1: 80, y2: 164 },
      900,
      500,
      126,
      34,
    )).toEqual({ left: 308, top: 105, placement: "right" });
  });

  it("moves the action to the left near the right edge", () => {
    expect(placeGraphNodeAction(
      { x1: 650, x2: 846, y1: 80, y2: 164 },
      900,
      500,
      126,
      34,
    )).toEqual({ left: 512, top: 105, placement: "left" });
  });

  it("keeps the fallback action inside a narrow container", () => {
    const position = placeGraphNodeAction(
      { x1: 42, x2: 238, y1: 420, y2: 504 },
      280,
      540,
      126,
      34,
    );

    expect(position).toEqual({ left: 77, top: 496, placement: "below" });
  });

  it("hides the action when the selected node is outside the viewport", () => {
    expect(placeGraphNodeAction(
      { x1: -300, x2: -104, y1: 80, y2: 164 },
      900,
      500,
      126,
      34,
    )).toBeNull();
  });
});
