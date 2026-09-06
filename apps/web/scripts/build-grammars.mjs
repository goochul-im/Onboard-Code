import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public/wasm");
await mkdir(output, { recursive: true });

const builds = [
  ["tree-sitter-java", "tree-sitter-java.wasm"],
  ["tree-sitter-python", "tree-sitter-python.wasm"],
  ["tree-sitter-php/php", "tree-sitter-php.wasm"],
  ["tree-sitter-typescript/typescript", "tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript/tsx", "tree-sitter-tsx.wasm"],
];

await copyFile(
  resolve(root, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
  resolve(output, "web-tree-sitter.wasm"),
);

for (const [packagePath, outputName] of builds) {
  const destination = resolve(output, outputName);
  const grammarPath = resolve(root, "node_modules", packagePath);
  const result = spawnSync(
    resolve(root, "node_modules/.bin/tree-sitter"),
    ["build", "--wasm", grammarPath, "--output", destination],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  const info = await stat(destination);
  if (info.size === 0) throw new Error(`${outputName} 생성 결과가 비어 있습니다.`);
}

process.stdout.write("browser Tree-sitter grammars ready\n");

