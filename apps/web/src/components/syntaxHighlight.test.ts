import { describe, expect, it } from "vitest";
import { detectSourceLanguage, tokenizeSource } from "./syntaxHighlight";

describe("web source syntax highlighting", () => {
  it("highlights TypeScript keywords, types, functions, strings, and comments", () => {
    const lines = tokenizeSource(
      "export class Greeter {\n  greet(name: string) { return `Hi ${name}`; } // message\n}",
      "typescript",
    );
    expect(token(lines[0], "export")?.kind).toBe("keyword");
    expect(token(lines[0], "Greeter")?.kind).toBe("type");
    expect(token(lines[1], "greet")?.kind).toBe("function");
    expect(token(lines[1], "string")?.kind).toBe("type");
    expect(token(lines[1], "`Hi ${name}`")?.kind).toBe("string");
    expect(token(lines[1], "// message")?.kind).toBe("comment");
  });

  it("keeps block comments highlighted across Java lines", () => {
    const lines = tokenizeSource("/* first\n * second */\nint count = 30;", "java");
    expect(lines[0]).toEqual([{ text: "/* first", kind: "comment" }]);
    expect(lines[1]).toEqual([{ text: " * second */", kind: "comment" }]);
    expect(token(lines[2], "int")?.kind).toBe("type");
    expect(token(lines[2], "30")?.kind).toBe("number");
  });

  it("highlights Python definitions and comments", () => {
    const lines = tokenizeSource("@cache\ndef greet(name: str):\n    return f\"Hi {name}\" # message", "python");
    expect(token(lines[0], "@cache")?.kind).toBe("annotation");
    expect(token(lines[1], "def")?.kind).toBe("keyword");
    expect(token(lines[1], "greet")?.kind).toBe("function");
    expect(token(lines[2], "f\"Hi {name}\"")?.kind).toBe("string");
    expect(token(lines[2], "# message")?.kind).toBe("comment");
  });

  it("highlights PHP declarations and types", () => {
    const lines = tokenizeSource("<?php\nfinal class Payment {\n  public function charge(int $amount): void { return; }\n}", "php");
    expect(token(lines[0], "php")?.kind).toBe("keyword");
    expect(token(lines[1], "final")?.kind).toBe("keyword");
    expect(token(lines[1], "Payment")?.kind).toBe("type");
    expect(token(lines[2], "charge")?.kind).toBe("function");
    expect(token(lines[2], "int")?.kind).toBe("type");
  });

  it("supports Python, PHP, Java, and TypeScript file extensions", () => {
    expect(detectSourceLanguage("src/App.java")).toBe("java");
    expect(detectSourceLanguage("src/app.py")).toBe("python");
    expect(detectSourceLanguage("src/App.php")).toBe("php");
    expect(detectSourceLanguage("src/app.tsx")).toBe("typescript");
  });
});

function token(tokens: ReturnType<typeof tokenizeSource>[number], text: string) {
  return tokens.find((item) => item.text === text);
}
