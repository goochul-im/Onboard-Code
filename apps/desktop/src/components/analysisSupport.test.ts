import { describe, expect, it } from "vitest";
import { analysisHelpSections } from "./analysisSupport";

describe("analysis help content", () => {
  it("keeps every supported language in the expandable help model", () => {
    expect(analysisHelpSections[0]).toEqual({
      title: "지원 언어",
      items: [
        { label: "Java", detail: ".java" },
        { label: "PHP", detail: ".php" },
        { label: "Python", detail: ".py" },
        { label: "TypeScript", detail: ".ts · .tsx · .mts · .cts" },
      ],
    });
  });
});
