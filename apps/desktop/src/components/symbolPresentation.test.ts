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

  it("hides the module path from an Explore heading", () => {
    expect(presentSymbol(
      "src.achievement-cluster.achievement-cluster.controller.AchievementClusterController.deleteAll",
    )).toEqual({
      methodName: "deleteAll",
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
