import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeBrowserFiles } from "./analyzer";
import type { BrowserSourceFile } from "./types";

const wasmBaseUrl = fileURLToPath(new URL("../../public/wasm/", import.meta.url));

const fixtures: Array<{ file: BrowserSourceFile; expectedNames: string[] }> = [
  {
    file: {
      relativePath: "src/Demo.java",
      language: "java",
      source: "package sample; class Demo { void entry() { helper(); } void helper() {} }",
    },
    expectedNames: ["sample.Demo.entry", "sample.Demo.helper"],
  },
  {
    file: {
      relativePath: "src/demo.py",
      language: "python",
      source: "def entry():\n    helper()\n\ndef helper():\n    return 1\n",
    },
    expectedNames: ["src.demo.entry", "src.demo.helper"],
  },
  {
    file: {
      relativePath: "src/demo.php",
      language: "php",
      source: "<?php namespace Sample; function entry() { helper(); } function helper() { return 1; }",
    },
    expectedNames: ["Sample\\entry", "Sample\\helper"],
  },
  {
    file: {
      relativePath: "src/demo.ts",
      language: "typescript",
      source: "export function entry() { return helper(); } function helper() { return 1; }",
    },
    expectedNames: ["src.demo.entry", "src.demo.helper"],
  },
];

describe("Tree-sitter WASM browser analyzer", () => {
  for (const fixture of fixtures) {
    it(`parses ${fixture.file.language} declarations and resolves a call`, async () => {
      const result = await analyzeBrowserFiles([fixture.file], wasmBaseUrl);

      expect(result.diagnostics).toEqual([]);
      expect(result.symbols.map((symbol) => symbol.fqn)).toEqual(fixture.expectedNames);
      expect(result.edges).toEqual([
        expect.objectContaining({
          confidence: "resolved",
          target: result.symbols[1].id,
        }),
      ]);
    });
  }

  it("resolves a uniquely named qualified method call", async () => {
    const result = await analyzeBrowserFiles([{
      relativePath: "src/qualified.ts",
      language: "typescript",
      source: "class Demo { entry() { this.helper(); } helper() { return 1; } }",
    }], wasmBaseUrl);
    const helper = result.symbols.find((symbol) => symbol.fqn.endsWith(".helper"));

    expect(helper).toBeDefined();
    expect(result.edges).toContainEqual(expect.objectContaining({
      confidence: "resolved",
      target: helper?.id,
    }));
  });
});
