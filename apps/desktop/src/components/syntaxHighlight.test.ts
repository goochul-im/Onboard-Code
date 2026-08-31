import { describe, expect, it } from "vitest";
import { detectSourceLanguage, tokenizeSource } from "./syntaxHighlight";

describe("syntax highlighting", () => {
  it("classifies common Java declarations, strings, comments, and numbers", () => {
    const lines = tokenizeSource(
      "@Slf4j\npublic class Example {\n  String name = \"Codex\"; // greeting\n  int count = 31;\n}",
      "java",
    );

    expect(lines[0]).toEqual([{ text: "@Slf4j", kind: "annotation" }]);
    expect(token(lines[1], "public")?.kind).toBe("keyword");
    expect(token(lines[1], "Example")?.kind).toBe("type");
    expect(token(lines[2], "String")?.kind).toBe("type");
    expect(token(lines[2], "\"Codex\"")?.kind).toBe("string");
    expect(token(lines[2], "// greeting")?.kind).toBe("comment");
    expect(token(lines[3], "31")?.kind).toBe("number");
  });

  it("keeps Java block comments highlighted across lines", () => {
    const lines = tokenizeSource("/* first\n * second */\nint count = 2;", "java");

    expect(lines[0]).toEqual([{ text: "/* first", kind: "comment" }]);
    expect(lines[1]).toEqual([{ text: " * second */", kind: "comment" }]);
    expect(token(lines[2], "int")?.kind).toBe("type");
    expect(token(lines[2], "2")?.kind).toBe("number");
  });

  it("classifies Python decorators, definitions, strings, and comments", () => {
    const lines = tokenizeSource("@cache\ndef greet(name: str) -> None:\n    return f\"Hi {name}\" # greeting", "python");

    expect(lines[0]).toEqual([{ text: "@cache", kind: "annotation" }]);
    expect(token(lines[1], "def")?.kind).toBe("keyword");
    expect(token(lines[1], "greet")?.kind).toBe("function");
    expect(token(lines[1], "str")?.kind).toBe("type");
    expect(token(lines[2], "return")?.kind).toBe("keyword");
    expect(token(lines[2], "f\"Hi {name}\"")?.kind).toBe("string");
    expect(token(lines[2], "# greeting")?.kind).toBe("comment");
  });

  it("derives the supported language from the source file extension", () => {
    expect(detectSourceLanguage("src/main/python/service.py")).toBe("python");
    expect(detectSourceLanguage("src/main/java/App.java")).toBe("java");
    expect(detectSourceLanguage("src/PaymentService.php")).toBe("php");
    expect(detectSourceLanguage("src/services/user.ts")).toBe("typescript");
    expect(detectSourceLanguage("src/components/UserCard.tsx")).toBe("typescript");
    expect(detectSourceLanguage("src/server/bootstrap.mts")).toBe("typescript");
    expect(detectSourceLanguage("src/server/config.cts")).toBe("typescript");
  });

  it("classifies TypeScript declarations, types, templates, and comments", () => {
    const lines = tokenizeSource(
      "export interface User { name: string }\nconst greet = (user: User): string => `Hi ${user.name}`; // greeting\n/* note */",
      "typescript",
    );

    expect(token(lines[0], "export")?.kind).toBe("keyword");
    expect(token(lines[0], "interface")?.kind).toBe("keyword");
    expect(token(lines[0], "User")?.kind).toBe("type");
    expect(token(lines[0], "string")?.kind).toBe("type");
    expect(token(lines[1], "const")?.kind).toBe("keyword");
    expect(token(lines[1], "`Hi ${user.name}`")?.kind).toBe("string");
    expect(token(lines[1], "// greeting")?.kind).toBe("comment");
    expect(token(lines[2], "/* note */")?.kind).toBe("comment");
  });

  it("classifies PHP declarations, types, strings, and hash comments", () => {
    const lines = tokenizeSource(
      "<?php\nfinal class PaymentService {\n  public function charge(int $amount): void { echo \"ok\"; } # charged\n}",
      "php",
    );

    expect(token(lines[0], "php")?.kind).toBe("keyword");
    expect(token(lines[1], "final")?.kind).toBe("keyword");
    expect(token(lines[1], "PaymentService")?.kind).toBe("type");
    expect(token(lines[2], "function")?.kind).toBe("keyword");
    expect(token(lines[2], "charge")?.kind).toBe("function");
    expect(token(lines[2], "int")?.kind).toBe("type");
    expect(token(lines[2], "\"ok\"")?.kind).toBe("string");
    expect(token(lines[2], "# charged")?.kind).toBe("comment");
  });
});

function token(tokens: ReturnType<typeof tokenizeSource>[number], text: string) {
  return tokens.find((item) => item.text === text);
}
