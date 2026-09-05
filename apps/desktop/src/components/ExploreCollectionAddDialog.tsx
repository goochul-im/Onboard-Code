import type { CollectionSummary, SymbolRecord } from "../types";

interface ExploreCollectionAddDialogProps {
  collections: CollectionSummary[];
  disabled: boolean;
  newCollectionTitle: string;
  selectedCollectionId: number | "new" | "";
  selectedSymbol: SymbolRecord;
  onCancel: () => void;
  onNewCollectionTitleChange: (title: string) => void;
  onSelectedCollectionChange: (collectionId: number | "new") => void;
  onSubmit: () => void;
}

export function ExploreCollectionAddDialog({
  collections,
  disabled,
  newCollectionTitle,
  selectedCollectionId,
  selectedSymbol,
  onCancel,
  onNewCollectionTitleChange,
  onSelectedCollectionChange,
  onSubmit,
}: ExploreCollectionAddDialogProps) {
  const targetIsNew = selectedCollectionId === "new" || collections.length === 0;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="collection-add-dialog" aria-label="컬렉션에 함수 추가" aria-modal="true" role="dialog">
        <header>
          <h2>컬렉션에 추가</h2>
          <button type="button" onClick={onCancel} aria-label="닫기">×</button>
        </header>
        <p>
          <code>{selectedSymbol.fqn}{selectedSymbol.signature}</code>
        </p>
        {collections.length > 0 && (
          <>
            <label className="field-label" htmlFor="explore-collection-target">추가할 컬렉션</label>
            <select
              id="explore-collection-target"
              value={selectedCollectionId}
              onChange={(event) => onSelectedCollectionChange(event.target.value === "new" ? "new" : Number(event.target.value))}
              disabled={disabled}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.title}</option>
              ))}
              <option value="new">새 컬렉션 만들기</option>
            </select>
          </>
        )}
        {targetIsNew && (
          <>
            <label className="field-label" htmlFor="explore-new-collection-title">새 컬렉션 이름</label>
            <input
              id="explore-new-collection-title"
              value={newCollectionTitle}
              onChange={(event) => onNewCollectionTitleChange(event.target.value)}
              placeholder="예: 결제 승인 흐름"
              disabled={disabled}
            />
          </>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>취소</button>
          <button className="primary-button" type="button" onClick={onSubmit} disabled={disabled}>
            추가
          </button>
        </div>
      </section>
    </div>
  );
}
