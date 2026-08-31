import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(projectRoot, "../..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"));
const cargoToml = await readFile(resolve(projectRoot, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];

assert(packageJson.version === tauriConfig.version, "package.json과 tauri.conf.json 버전이 다릅니다.");
assert(cargoVersion === tauriConfig.version, "Cargo.toml과 tauri.conf.json 버전이 다릅니다.");
assert(tauriConfig.bundle?.createUpdaterArtifacts === true, "업데이트 번들 생성이 비활성화되어 있습니다.");
assert(Boolean(tauriConfig.plugins?.updater?.pubkey), "업데이트 공개키가 없습니다.");
assert(
  tauriConfig.plugins?.updater?.endpoints?.some((endpoint) => endpoint.startsWith("https://")),
  "HTTPS 업데이트 엔드포인트가 없습니다.",
);

for (const icon of ["icon.ico", "icon.icns", "icon.png"]) {
  await access(resolve(projectRoot, "src-tauri/icons", icon));
}
await access(resolve(repositoryRoot, ".github/workflows/release.yml"));

process.stdout.write(`release configuration ready for v${tauriConfig.version}\n`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
