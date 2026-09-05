import type { CollectionDetail, CollectionItem, NoteRecord, SourceFile } from "../types";
import { renderMarkdownForConfluence, renderMarkdownHtml } from "./confluenceExport";

export interface CollectionNoteSelection {
  itemId: number;
  notes: NoteRecord[];
  sourceFile: SourceFile | null;
}

export interface CollectionExportInput {
  detail: CollectionDetail;
  selectedNotes: CollectionNoteSelection[];
}

export interface CollectionExport {
  html: string;
  text: string;
  includedNoteCount: number;
  resolvedReferenceCount: number;
  unresolvedReferenceCount: number;
}

export const collectionRoleLabels: Record<string, string> = {
  entry: "진입점",
  core: "주요 로직",
  data: "데이터 접근",
  external: "외부 연동",
  error: "예외 처리",
  other: "기타",
};

export function collectionItemLabel(item: CollectionItem): string {
  const symbol = item.symbol;
  return `${symbol?.fqn ?? item.symbolFqn}${symbol?.signature ?? item.symbolSignature}`;
}

export function buildCollectionExport(input: CollectionExportInput): CollectionExport {
  const notesByItemId = new Map(input.selectedNotes.map((selection) => [selection.itemId, selection]));
  const noteCount = input.selectedNotes.reduce((count, item) => count + item.notes.length, 0);
  let resolvedReferenceCount = 0;
  let unresolvedReferenceCount = 0;
  const { collection, items } = input.detail;
  const tags = collection.tags.length > 0 ? collection.tags.join(", ") : "없음";
  const htmlItems = items.map((item, index) => {
    const selection = notesByItemId.get(item.id);
    const notes = selection?.notes ?? [];
    return [
      `<section>`,
      `<h2>${index + 1}. ${escapeHtml(collectionItemLabel(item))}</h2>`,
      `<p><strong>역할:</strong> ${escapeHtml(collectionRoleLabels[item.role] ?? "기타")}<br>`,
      `<strong>위치:</strong> ${escapeHtml(item.symbol?.relativePath ?? item.relativePath)}:${item.symbol?.startLine ?? item.startLine}`,
      item.isChanged ? `<br><strong>상태:</strong> 분석 이후 코드 변경 확인 필요` : "",
      item.status === "orphan" ? `<br><strong>상태:</strong> 연결 필요` : "",
      `</p>`,
      item.memo.trim() ? `<p>${escapeHtml(item.memo).replaceAll("\n", "<br>")}</p>` : "",
      ...notes.map((note) => {
        const body = renderNoteBodyForItem(item, note, selection?.sourceFile ?? null);
        resolvedReferenceCount += body.resolvedReferenceCount;
        unresolvedReferenceCount += body.unresolvedReferenceCount;
        return [
          `<article>`,
          `<h3>${escapeHtml(note.title)}</h3>`,
          body.html,
          note.tags.length > 0 ? `<p><strong>태그:</strong> ${note.tags.map(escapeHtml).join(", ")}</p>` : "",
          `</article>`,
        ].join("");
      }),
      `</section>`,
    ].join("");
  });
  const textItems = items.map((item, index) => {
    const selection = notesByItemId.get(item.id);
    const notes = selection?.notes ?? [];
    const status = [
      item.isChanged ? "분석 이후 코드 변경 확인 필요" : "",
      item.status === "orphan" ? "연결 필요" : "",
    ].filter(Boolean).join(", ");
    return [
      `## ${index + 1}. ${collectionItemLabel(item)}`,
      `역할: ${collectionRoleLabels[item.role] ?? "기타"}`,
      `위치: ${item.symbol?.relativePath ?? item.relativePath}:${item.symbol?.startLine ?? item.startLine}`,
      status ? `상태: ${status}` : "",
      item.memo.trim(),
      ...notes.flatMap((note) => {
        const body = renderNoteBodyForItem(item, note, selection?.sourceFile ?? null);
        return [
          `### ${note.title}`,
          body.text,
          note.tags.length > 0 ? `태그: ${note.tags.join(", ")}` : "",
        ];
      }),
    ].filter(Boolean).join("\n\n");
  });

  return {
    html: [
      `<h1>${escapeHtml(collection.title)}</h1>`,
      `<p><strong>태그:</strong> ${escapeHtml(tags)}</p>`,
      collection.overviewMarkdown.trim() ? renderMarkdownHtml(collection.overviewMarkdown) : "",
      htmlItems.join(""),
    ].join(""),
    text: [
      `# ${collection.title}`,
      `태그: ${tags}`,
      collection.overviewMarkdown.trim(),
      textItems.join("\n\n"),
    ].filter(Boolean).join("\n\n"),
    includedNoteCount: noteCount,
    resolvedReferenceCount,
    unresolvedReferenceCount,
  };
}

function renderNoteBodyForItem(item: CollectionItem, note: NoteRecord, sourceFile: SourceFile | null) {
  if (!sourceFile || !item.symbol) {
    const unresolvedReferenceCount = note.bodyMarkdown.match(/\[line:\d+(?:-\d+)?\]/g)?.length ?? 0;
    return {
      html: renderMarkdownHtml(note.bodyMarkdown),
      text: note.bodyMarkdown,
      resolvedReferenceCount: 0,
      unresolvedReferenceCount,
    };
  }
  return renderMarkdownForConfluence({
    markdown: note.bodyMarkdown,
    relativePath: sourceFile.relativePath,
    source: sourceFile.source,
    language: item.symbol.language,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
