import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = process.env.PRIVACY_AUDIT_DIST ? resolve(process.env.PRIVACY_AUDIT_DIST) : join(appRoot, "dist");

const requiredFiles = [
  "index.html",
  "CNAME",
  "manifest.webmanifest",
  "sw.js",
  "wasm/web-tree-sitter.wasm",
  "wasm/tree-sitter-java.wasm",
  "wasm/tree-sitter-php.wasm",
  "wasm/tree-sitter-python.wasm",
  "wasm/tree-sitter-tsx.wasm",
  "wasm/tree-sitter-typescript.wasm",
];

const scannedExtensions = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".webmanifest",
  ".svg",
  ".txt",
]);

const ignoredExtensions = new Set([".map"]);
const remoteUrlPattern = /\bhttps?:\/\/[^\s"'`)<>{}\\]+/gi;
const localRemoteOrigins = [
  "http://localhost",
  "http://127.0.0.1",
  "http://0.0.0.0",
  "https://localhost",
  "https://127.0.0.1",
];

const ignoredRemoteUrlHosts = new Set([
  "react.dev",
  "www.w3.org",
  "w3.org",
  "bit.ly",
]);

const deniedRemoteHosts = new Set([
  "google-analytics.com",
  "www.google-analytics.com",
  "googletagmanager.com",
  "www.googletagmanager.com",
  "analytics.google.com",
  "posthog.com",
  "app.posthog.com",
  "us.i.posthog.com",
  "eu.i.posthog.com",
  "segment.com",
  "segment.io",
  "cdn.segment.com",
  "api.segment.io",
  "sentry.io",
  "browser.sentry-cdn.com",
  "amplitude.com",
  "api2.amplitude.com",
  "cdn.amplitude.com",
  "mixpanel.com",
  "api.mixpanel.com",
  "cdn.mxpnl.com",
]);

const deniedExecutablePatterns = [
  { label: "sendBeacon", pattern: /\bnavigator\.sendBeacon\s*\(/gi },
  {
    label: "remote fetch",
    pattern: /\bfetch\s*\(\s*(?:new\s+Request\s*\(\s*)?["'`](https?:\/\/[^"'`]+)["'`]/gi,
  },
  {
    label: "remote XMLHttpRequest",
    pattern: /\.open\s*\(\s*["'`][A-Z]+["'`]\s*,\s*["'`](https?:\/\/[^"'`]+)["'`]/gi,
  },
  {
    label: "remote WebSocket",
    pattern: /\bnew\s+WebSocket\s*\(\s*["'`](wss?:\/\/[^"'`]+)["'`]/gi,
  },
  {
    label: "remote EventSource",
    pattern: /\bnew\s+EventSource\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/gi,
  },
  {
    label: "remote importScripts",
    pattern: /\bimportScripts\s*\([^)]*["'`](https?:\/\/[^"'`]+)["'`]/gi,
  },
];

function fail(message) {
  console.error(`privacy-audit: ${message}`);
  process.exitCode = 1;
}

function extensionOf(path) {
  const lastDot = path.lastIndexOf(".");
  return lastDot === -1 ? "" : path.slice(lastDot);
}

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (stat.isFile()) {
      entries.push(path);
    }
  }
  return entries;
}

function reportLocation(file, contents, index) {
  const prefix = contents.slice(0, index);
  const line = prefix.split("\n").length;
  const lineStart = prefix.lastIndexOf("\n") + 1;
  const column = index - lineStart + 1;
  return `${relative(distRoot, file).split(sep).join("/")}:${line}:${column}`;
}

function remoteHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isDeniedRemoteHost(url) {
  const host = remoteHost(url);
  return [...deniedRemoteHosts].some((deniedHost) => host === deniedHost || host.endsWith(`.${deniedHost}`));
}

function isIgnoredRemoteUrl(url) {
  if (localRemoteOrigins.some((origin) => url.startsWith(origin))) {
    return true;
  }
  return ignoredRemoteUrlHosts.has(remoteHost(url));
}

if (!existsSync(distRoot)) {
  fail("dist directory is missing; run npm run build first.");
} else {
  for (const requiredFile of requiredFiles) {
    const absolutePath = join(distRoot, requiredFile);
    if (!existsSync(absolutePath)) {
      fail(`required local asset is missing: ${requiredFile}`);
    }
  }

  const cnamePath = join(distRoot, "CNAME");
  if (existsSync(cnamePath)) {
    const cname = readFileSync(cnamePath, "utf8").trim();
    if (cname !== "onboardcode.app") {
      fail(`CNAME must contain only onboardcode.app; found ${JSON.stringify(cname)}.`);
    }
  }

  for (const file of walk(distRoot)) {
    const relativePath = relative(distRoot, file).split(sep).join("/");
    const extension = extensionOf(file);
    if (ignoredExtensions.has(extension) || !scannedExtensions.has(extension)) {
      continue;
    }

    const contents = readFileSync(file, "utf8");
    const remoteUrls = contents.matchAll(remoteUrlPattern);
    for (const match of remoteUrls) {
      const url = match[0];
      if (isDeniedRemoteHost(url)) {
        fail(`telemetry URL found in published asset at ${reportLocation(file, contents, match.index)}: ${url}`);
      } else if (!isIgnoredRemoteUrl(url)) {
        fail(`unexpected remote URL found in published asset at ${reportLocation(file, contents, match.index)}: ${url}`);
      }
    }

    for (const { label, pattern } of deniedExecutablePatterns) {
      for (const match of contents.matchAll(pattern)) {
        const target = match[1] ?? "";
        if (target && localRemoteOrigins.some((origin) => target.startsWith(origin))) {
          continue;
        }
        fail(`${label} egress capability found in published asset at ${reportLocation(file, contents, match.index ?? 0)}.`);
      }
    }

    if (relativePath.endsWith(".webmanifest")) {
      try {
        const manifest = JSON.parse(contents);
        const iconSources = Array.isArray(manifest.icons) ? manifest.icons.map((icon) => icon.src) : [];
        for (const src of [manifest.start_url, manifest.scope, ...iconSources]) {
          if (typeof src === "string" && remoteUrlPattern.test(src)) {
            fail(`manifest metadata must use local paths only: ${src}`);
          }
          remoteUrlPattern.lastIndex = 0;
        }
      } catch (error) {
        fail(`manifest is not valid JSON: ${error.message}`);
      }
    }
  }
}

if (process.exitCode) {
  process.exit();
}

console.log("privacy-audit: dist uses local PWA/WASM assets and contains no remote telemetry endpoints.");
