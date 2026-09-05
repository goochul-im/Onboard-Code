import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CollectionSummary, SymbolRecord } from "../types";
import { ExploreCollectionAddDialog } from "./ExploreCollectionAddDialog";

const symbol: SymbolRecord = {
  id: "symbol-1",
  language: "python",
  kind: "function",
  fqn: "checkout.payment.authorize",
  signature: "(order_id)",
  relativePath: "checkout/payment.py",
  startLine: 10,
  endLine: 20,
  astFingerprint: "fp",
};

const collection: CollectionSummary = {
  id: 4,
  repositoryId: "repo",
  title: "결제 승인",
  overviewMarkdown: "",
  tags: [],
  createdRevision: "abc",
  itemCount: 2,
  orphanCount: 0,
  changedCount: 0,
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
};

describe("ExploreCollectionAddDialog", () => {
  it("renders the selected function and existing collections", () => {
    const html = renderToStaticMarkup(
      <ExploreCollectionAddDialog
        collections={[collection]}
        disabled={false}
        newCollectionTitle=""
        selectedCollectionId={collection.id}
        selectedSymbol={symbol}
        onCancel={() => undefined}
        onNewCollectionTitleChange={() => undefined}
        onSelectedCollectionChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain("aria-label=\"컬렉션에 함수 추가\"");
    expect(html).toContain("checkout.payment.authorize(order_id)");
    expect(html).toContain("결제 승인");
    expect(html).toContain("새 컬렉션 만들기");
  });

  it("shows a new collection title input when no collection exists", () => {
    const html = renderToStaticMarkup(
      <ExploreCollectionAddDialog
        collections={[]}
        disabled={false}
        newCollectionTitle="신규 흐름"
        selectedCollectionId="new"
        selectedSymbol={symbol}
        onCancel={() => undefined}
        onNewCollectionTitleChange={() => undefined}
        onSelectedCollectionChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain("새 컬렉션 이름");
    expect(html).toContain("value=\"신규 흐름\"");
  });
});
