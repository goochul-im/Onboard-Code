import { describe, expect, it } from "vitest";
import { presentSymbol } from "./symbolPresentation";

describe("symbol search presentation", () => {
  it("separates a long FQN into method and class names", () => {
    expect(presentSymbol(
      "com.thinkfree.tfinder.achievement.AchievementClusterController.createAchievement",
    )).toEqual({
      methodName: "createAchievement",
      className: "AchievementClusterController",
    });
  });

  it("labels a symbol without a containing scope as a global function", () => {
    expect(presentSymbol("bootstrap")).toEqual({
      methodName: "bootstrap",
      className: "전역 함수",
    });
  });
});
