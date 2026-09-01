import type { SourceLanguage } from "../types";
import { parseLineReference } from "./lineReference";

export interface ConfluenceExportInput {
  title: string;
  markdown: string;
  tags: string[];
  symbolFqn: string;
  signature: string;
  relativePath: string;
  source: string;
  language: SourceLanguage;
}

export interface ConfluenceExport {
  html: string;
  text: string;
  resolvedReferenceCount: number;
  unresolvedReferenceCount: number;
}

export function buildConfluenceExport(input: ConfluenceExportInput): ConfluenceExport {
  const sourceLines = input.source.split(/\r?\n/);
  const segments = input.markdown.split(/(\[line:\d+(?:-\d+)?\])/g).filter(Boolean);
  const htmlBody: string[] = [];
  const textBody: string[] = [];
  let resolvedReferenceCount = 0;
  let unresolvedReferenceCount = 0;

  for (const segment of segments) {
    const reference = parseLineReference(segment);
    if (!reference) {
      htmlBody.push(renderMarkdownHtml(segment));
      textBody.push(segment);
      continue;
    }

    if (reference.start > sourceLines.length) {
      unresolvedReferenceCount += 1;
      htmlBody.push(`<p><strong>${escapeHtml(segment)}</strong> — 현재 소스에서 찾지 못함</p>`);
      textBody.push(`${segment} — 현재 소스에서 찾지 못함`);
      continue;
    }

    resolvedReferenceCount += 1;
    const end = Math.min(reference.end, sourceLines.length);
    const rangeLabel = reference.start === end ? `${reference.start}행` : `${reference.start}–${end}행`;
    const code = sourceLines.slice(reference.start - 1, end).join("\n");
    const sourceLabel = `${input.relativePath} · ${rangeLabel}`;
    htmlBody.push(
      `<p><strong>${escapeHtml(sourceLabel)}</strong></p>`,
      `<pre><code class="language-${input.language}">${escapeHtml(code)}</code></pre>`,
    );
    textBody.push(
      `**${sourceLabel}**`,
      `\`\`\`${input.language}\n${code}\n\`\`\``,
    );
  }

  const symbol = `${input.symbolFqn}${input.signature}`;
  const tagsHtml = input.tags.length > 0
    ? `<p><strong>태그:</strong> ${input.tags.map(escapeHtml).join(", ")}</p>`
    : "";
  const tagsText = input.tags.length > 0 ? `\n\n태그: ${input.tags.join(", ")}` : "";
  return {
    html: [
      `<h1>${escapeHtml(input.title)}</h1>`,
      `<p><strong>함수:</strong> <code>${escapeHtml(symbol)}</code><br><strong>소스:</strong> ${escapeHtml(input.relativePath)}</p>`,
      htmlBody.join(""),
      tagsHtml,
    ].join(""),
    text: `# ${input.title}\n\n함수: ${symbol}\n소스: ${input.relativePath}\n\n${textBody.join("\n\n")}${tagsText}`,
    resolvedReferenceCount,
    unresolvedReferenceCount,
  };
}

function renderMarkdownHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineHtml(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(`<li>${renderInlineHtml(lines[index].slice(2))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(`<blockquote>${renderInlineHtml(line.slice(2))}</blockquote>`);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^- |^> |^```/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInlineHtml).join("<br>")}</p>`);
  }
  return blocks.join("");
}

function renderInlineHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((fragment) => {
      if (fragment.startsWith("**") && fragment.endsWith("**")) {
        return `<strong>${escapeHtml(fragment.slice(2, -2))}</strong>`;
      }
      if (fragment.startsWith("`") && fragment.endsWith("`")) {
        return `<code>${escapeHtml(fragment.slice(1, -1))}</code>`;
      }
      return escapeHtml(fragment);
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
