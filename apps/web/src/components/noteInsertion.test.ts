import { describe, expect, it } from "vitest";
import { insertTextAtSelection } from "./noteInsertion";

describe("web note insertion", () => {
  it("inserts a line reference at the current cursor", () => {
    expect(insertTextAtSelection("역할: ", 4, 4, "[line:30]")).toEqual({
      value: "역할: [line:30]",
      cursor: 13,
    });
  });

  it("replaces the selected note text with a line range", () => {
    expect(insertTextAtSelection("before old after", 7, 10, "[line:30-35]")).toEqual({
      value: "before [line:30-35] after",
      cursor: 19,
    });
  });
});
