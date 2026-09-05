import { describe, expect, it } from "vitest";
import type { CollectionDetail, CollectionItem, NoteRecord, SymbolRecord } from "../types";
import { buildCollectionExport, collectionItemLabel } from "./collectionExport";

const symbol: SymbolRecord = {
  id: "symbol-1",
  language: "typescript",
  kind: "function",
  fqn: "checkout.Payment.authorize",
  signature: "(orderId: string)",
  relativePath: "src/checkout/Payment.ts",
  startLine: 12,
  endLine: 24,
  astFingerprint: "fresh",
};

const item: CollectionItem = {
  id: 3,
  collectionId: 1,
  repositoryId: "repo",
  symbolId: symbol.id,
  symbolFqn: symbol.fqn,
  symbolSignature: symbol.signature,
  relativePath: symbol.relativePath,
  startLine: symbol.startLine,
  endLine: symbol.endLine,
  astFingerprint: "stale",
  role: "entry",
  memo: "결제 승인 흐름의 시작점",
  status: "linked",
  sortOrder: 0,
  addedRevision: "abc",
  reviewedAt: null,
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
  symbol,
  isChanged: true,
};

const note: NoteRecord = {
  id: 7,
  symbolId: symbol.id,
  title: "승인 요청",
  bodyMarkdown: "## 요약\n\n[line:2]\n\n외부 PG에 요청합니다.",
  tags: ["결제"],
  updatedAt: "2026-09-05T00:00:00Z",
  status: "linked",
};

function detail(items: CollectionItem[] = [item]): CollectionDetail {
  return {
    collection: {
      id: 1,
      repositoryId: "repo",
      title: "결제 승인",
      overviewMarkdown: "주문에서 PG 승인까지 읽는 흐름",
      tags: ["결제", "PG"],
      createdRevision: "abc",
      itemCount: items.length,
      orphanCount: 0,
      changedCount: 1,
      createdAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-05T00:00:00Z",
    },
    items,
  };
}

describe("collection export", () => {
  it("labels an item with the current linked symbol", () => {
    expect(collectionItemLabel(item)).toBe("checkout.Payment.authorize(orderId: string)");
  });

  it("exports collection overview, ordered items, changed state, and selected notes", () => {
    const exported = buildCollectionExport({
      detail: detail(),
      selectedNotes: [{
        itemId: item.id,
        notes: [note],
        sourceFile: {
          relativePath: symbol.relativePath,
          source: "const id = order.id;\nawait gateway.authorize(id);\nreturn id;",
          startLine: 1,
          endLine: 3,
        },
      }],
    });

    expect(exported.includedNoteCount).toBe(1);
    expect(exported.resolvedReferenceCount).toBe(1);
    expect(exported.unresolvedReferenceCount).toBe(0);
    expect(exported.html).toContain("<h1>결제 승인</h1>");
    expect(exported.html).toContain("<strong>역할:</strong> 진입점");
    expect(exported.html).toContain("분석 이후 코드 변경 확인 필요");
    expect(exported.html).toContain("<h3>승인 요청</h3>");
    expect(exported.html).toContain('<pre><code class="language-typescript">await gateway.authorize(id);</code></pre>');
    expect(exported.html).not.toContain("[line:2]");
    expect(exported.text).toContain("결제 승인 흐름의 시작점");
    expect(exported.text).toContain("```typescript\nawait gateway.authorize(id);\n```");
    expect(exported.text).toContain("태그: 결제, PG");
  });

  it("does not include unselected notes", () => {
    const exported = buildCollectionExport({
      detail: detail(),
      selectedNotes: [{ itemId: item.id, notes: [], sourceFile: null }],
    });

    expect(exported.includedNoteCount).toBe(0);
    expect(exported.html).not.toContain("승인 요청");
  });

  it("keeps line references visible when source cannot be loaded", () => {
    const exported = buildCollectionExport({
      detail: detail(),
      selectedNotes: [{ itemId: item.id, notes: [note], sourceFile: null }],
    });

    expect(exported.resolvedReferenceCount).toBe(0);
    expect(exported.unresolvedReferenceCount).toBe(1);
    expect(exported.html).toContain("[line:2]");
  });
});
