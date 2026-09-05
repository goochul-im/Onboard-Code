import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { CollectionDetail, CollectionItem, CollectionItemRole, CollectionSummary, GraphData, NoteRecord, SymbolRecord } from "../types";
import { CallGraph, type GraphViewport } from "./CallGraph";
import { buildCollectionExport, collectionItemLabel, collectionRoleLabels } from "./collectionExport";
import { MarkdownPreview } from "./MarkdownEditor";
import { SymbolSearchResult } from "./SymbolSearchResult";

const roles: Array<{ value: CollectionItemRole; label: string }> = [
  { value: "entry", label: "진입점" },
  { value: "core", label: "주요 로직" },
  { value: "data", label: "데이터 접근" },
  { value: "external", label: "외부 연동" },
  { value: "error", label: "예외 처리" },
  { value: "other", label: "기타" },
];

interface CollectionsWorkspaceProps {
  repositoryId: string | null;
  selectedSymbol: SymbolRecord | null;
  selectedCollectionId: number | null;
  busy: boolean;
  onSelectSymbol: (symbolId: string) => void;
  onOpenRecord: () => void;
  onSelectionChange: (collectionId: number | null) => void;
  onNotice: (message: string) => void;
}

export function CollectionsWorkspace({
  repositoryId,
  selectedSymbol,
  selectedCollectionId,
  busy,
  onSelectSymbol,
  onOpenRecord,
  onSelectionChange,
  onNotice,
}: CollectionsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphViewport, setGraphViewport] = useState<GraphViewport | null>(null);
  const [mode, setMode] = useState<"order" | "calls">("order");
  const [overviewMode, setOverviewMode] = useState<"write" | "preview">("write");
  const [newTitle, setNewTitle] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftOverview, setDraftOverview] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [relinkQueries, setRelinkQueries] = useState<Record<number, string>>({});
  const [relinkResults, setRelinkResults] = useState<Record<number, SymbolRecord[]>>({});
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [notesByItemId, setNotesByItemId] = useState<Record<number, NoteRecord[]>>({});
  const [selectedGraphSymbolId, setSelectedGraphSymbolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );
  const selectedSymbolAlreadyIncluded = Boolean(
    selectedSymbol && detail?.items.some((item) =>
      item.status === "linked"
      && (item.symbolId === selectedSymbol.id
        || (item.symbolFqn === selectedSymbol.fqn
          && item.symbolSignature === selectedSymbol.signature
          && item.relativePath === selectedSymbol.relativePath))),
  );

  useEffect(() => {
    if (!repositoryId) {
      setCollections([]);
      setDetail(null);
      onSelectionChange(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const items = query.trim()
          ? await api.searchCollections(repositoryId, query)
          : await api.listCollections(repositoryId);
        if (cancelled) return;
        setCollections(items);
        if (selectedCollectionId === null && items.length > 0) {
          onSelectionChange(items[0].id);
        } else if (selectedCollectionId !== null && !items.some((item) => item.id === selectedCollectionId)) {
          onSelectionChange(items[0]?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) onNotice(`컬렉션 목록을 읽지 못했습니다: ${String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [repositoryId, query, selectedCollectionId]);

  useEffect(() => {
    if (!repositoryId || selectedCollectionId === null) {
      setDetail(null);
      setGraph(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api.getCollection(repositoryId, selectedCollectionId),
      api.getCollectionGraph(repositoryId, selectedCollectionId),
    ]).then(([nextDetail, nextGraph]) => {
      if (cancelled) return;
      setDetail(nextDetail);
      setGraph(nextGraph);
      setSelectedGraphSymbolId(null);
      setDraftTitle(nextDetail?.collection.title ?? "");
      setDraftOverview(nextDetail?.collection.overviewMarkdown ?? "");
      setDraftTags(nextDetail?.collection.tags.join(", ") ?? "");
    }).catch((error: unknown) => {
      if (!cancelled) onNotice(`컬렉션을 열지 못했습니다: ${String(error)}`);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [repositoryId, selectedCollectionId]);

  useEffect(() => {
    if (!repositoryId || !detail) {
      setNotesByItemId({});
      return;
    }
    const linkedItems = detail.items.filter((item) => item.status === "linked" && item.symbolId);
    let cancelled = false;
    void Promise.all(linkedItems.map(async (item) => ({
      itemId: item.id,
      notes: item.symbolId ? await api.listNotes(repositoryId, item.symbolId) : [],
    }))).then((entries) => {
      if (cancelled) return;
      setNotesByItemId(Object.fromEntries(entries.map((entry) => [entry.itemId, entry.notes])));
    }).catch((error: unknown) => {
      if (!cancelled) onNotice(`컬렉션 노트를 읽지 못했습니다: ${String(error)}`);
    });
    return () => { cancelled = true; };
  }, [repositoryId, detail?.items.map((item) => `${item.id}:${item.symbolId}:${item.updatedAt}`).join("|")]);

  const refreshCollections = async (nextDetail?: CollectionDetail | null, refreshGraph = false) => {
    if (!repositoryId) return;
    const items = await api.listCollections(repositoryId);
    setCollections(items);
    if (nextDetail !== undefined) setDetail(nextDetail);
    const graphCollectionId = nextDetail?.collection.id ?? detail?.collection.id ?? selectedCollectionId;
    if (refreshGraph && graphCollectionId !== null) {
      setGraph(await api.getCollectionGraph(repositoryId, graphCollectionId));
    }
  };

  const createCollection = async () => {
    if (!repositoryId) return;
    setLoading(true);
    try {
      const created = await api.createCollection(repositoryId, newTitle || "새 컬렉션", "", []);
      setNewTitle("");
      await refreshCollections(created);
      onSelectionChange(created.collection.id);
      onNotice(`${created.collection.title} 컬렉션을 만들었습니다.`);
    } catch (error) {
      onNotice(`컬렉션을 만들지 못했습니다: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const saveCollection = async () => {
    if (!repositoryId || !detail) return;
    setLoading(true);
    try {
      const tags = draftTags.split(",").map((tag) => tag.trim()).filter(Boolean);
      const saved = await api.updateCollection(repositoryId, detail.collection.id, draftTitle, draftOverview, tags);
      await refreshCollections(saved);
      onNotice("컬렉션 개요를 저장했습니다.");
    } catch (error) {
      onNotice(`컬렉션을 저장하지 못했습니다: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteCollection = async (collection: CollectionSummary) => {
    if (!repositoryId || !window.confirm(`${collection.title} 컬렉션을 삭제할까요? 항목 메모도 함께 삭제됩니다.`)) return;
    setLoading(true);
    try {
      await api.deleteCollection(repositoryId, collection.id);
      const items = await api.listCollections(repositoryId);
      setCollections(items);
      onSelectionChange(items[0]?.id ?? null);
      onNotice("컬렉션을 삭제했습니다.");
    } catch (error) {
      onNotice(`컬렉션을 삭제하지 못했습니다: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const addSelectedSymbol = async () => {
    if (!repositoryId || !selectedSymbol) return;
    let targetId = detail?.collection.id ?? selectedCollectionId;
    setLoading(true);
    try {
      if (targetId === null) {
        const created = await api.createCollection(repositoryId, "새 기능 흐름", "", []);
        targetId = created.collection.id;
        onSelectionChange(targetId);
      }
      if (selectedSymbolAlreadyIncluded) {
        onNotice("이미 이 컬렉션에 들어 있는 함수입니다.");
        return;
      }
      const nextDetail = await api.addCollectionItem(repositoryId, targetId, selectedSymbol.id, "other", "");
      await refreshCollections(nextDetail, true);
      onNotice(`${selectedSymbol.fqn}을(를) 컬렉션에 추가했습니다.`);
    } catch (error) {
      onNotice(`컬렉션에 함수를 추가하지 못했습니다: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const updateItem = async (item: CollectionItem, role: string, memo: string) => {
    if (!repositoryId || !detail) return;
    try {
      const saved = await api.updateCollectionItem(repositoryId, detail.collection.id, item.id, role, memo);
      const nextDetail = { ...detail, items: detail.items.map((current) => current.id === saved.id ? saved : current) };
      await refreshCollections(nextDetail);
    } catch (error) {
      onNotice(`항목을 저장하지 못했습니다: ${String(error)}`);
    }
  };

  const moveItem = async (item: CollectionItem, offset: number) => {
    if (!repositoryId || !detail) return;
    const index = detail.items.findIndex((current) => current.id === item.id);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= detail.items.length) return;
    const ids = detail.items.map((current) => current.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, moved);
    try {
      const nextDetail = await api.reorderCollectionItems(repositoryId, detail.collection.id, ids);
      await refreshCollections(nextDetail, true);
    } catch (error) {
      onNotice(`순서를 저장하지 못했습니다: ${String(error)}`);
    }
  };

  const removeItem = async (item: CollectionItem) => {
    if (!repositoryId || !detail || !window.confirm(`${collectionItemLabel(item)} 항목을 컬렉션에서 제거할까요?`)) return;
    try {
      const nextDetail = await api.removeCollectionItem(repositoryId, detail.collection.id, item.id);
      await refreshCollections(nextDetail, true);
    } catch (error) {
      onNotice(`항목을 제거하지 못했습니다: ${String(error)}`);
    }
  };

  const markReviewed = async (item: CollectionItem) => {
    if (!repositoryId || !detail) return;
    try {
      const saved = await api.markCollectionItemReviewed(repositoryId, detail.collection.id, item.id);
      const nextDetail = {
        ...detail,
        collection: {
          ...detail.collection,
          changedCount: Math.max(0, detail.collection.changedCount - 1),
        },
        items: detail.items.map((current) => current.id === saved.id ? saved : current),
      };
      await refreshCollections(nextDetail);
      onNotice("변경 확인 상태를 저장했습니다.");
    } catch (error) {
      onNotice(`변경 확인 상태를 저장하지 못했습니다: ${String(error)}`);
    }
  };

  const searchRelinkCandidates = async (item: CollectionItem, nextQuery: string) => {
    if (!repositoryId) return;
    try {
      const results = await api.searchSymbols(repositoryId, nextQuery.trim() || item.symbolFqn);
      setRelinkResults((values) => ({ ...values, [item.id]: results.slice(0, 8) }));
    } catch (error) {
      onNotice(`다시 연결할 함수 후보를 찾지 못했습니다: ${String(error)}`);
    }
  };

  const relinkItem = async (item: CollectionItem, symbolId: string) => {
    if (!repositoryId || !detail) return;
    try {
      const saved = await api.relinkCollectionItem(repositoryId, detail.collection.id, item.id, symbolId);
      const nextDetail = { ...detail, items: detail.items.map((current) => current.id === saved.id ? saved : current) };
      await refreshCollections(nextDetail, true);
      onNotice("컬렉션 항목을 다시 연결했습니다.");
    } catch (error) {
      onNotice(`항목을 다시 연결하지 못했습니다: ${String(error)}`);
    }
  };

  const copyCollectionForConfluence = async () => {
    if (!repositoryId || !detail) return;
    const selectedNotes = await Promise.all(detail.items.map(async (item) => {
      const notes = (notesByItemId[item.id] ?? [])
        .filter((note) => selectedNoteIds.has(noteKey(item.id, note.id)));
      const sourceFile = item.symbolId && notes.length > 0
        ? await api.readSource(repositoryId, item.symbolId).catch(() => null)
        : null;
      return { itemId: item.id, notes, sourceFile };
    }));
    const exported = buildCollectionExport({ detail, selectedNotes });
    try {
      await writeHtml(exported.html, exported.text);
      const unresolved = exported.unresolvedReferenceCount > 0
        ? ` 찾지 못한 참조 ${exported.unresolvedReferenceCount}개가 있습니다.`
        : "";
      onNotice(`Confluence용 컬렉션을 복사했습니다. 분석 문서 ${exported.includedNoteCount}개, 코드 블록 ${exported.resolvedReferenceCount}개.${unresolved}`);
    } catch (htmlError) {
      try {
        await writeText(exported.text);
        onNotice(`HTML 복사를 지원하지 않아 일반 텍스트 형식으로 복사했습니다. 코드 블록 ${exported.resolvedReferenceCount}개.`);
      } catch (textError) {
        onNotice(`컬렉션을 복사하지 못했습니다: ${String(textError || htmlError)}`);
      }
    }
  };

  if (!repositoryId) {
    return <section className="collections-empty">저장소를 먼저 선택하세요.</section>;
  }

  return (
    <section className="collections-workspace" aria-label="기능별 탐색 컬렉션">
      <aside className="collections-sidebar">
        <label className="field-label" htmlFor="collection-search">컬렉션 검색</label>
        <input id="collection-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 태그, 함수" />
        <div className="collection-create-row">
          <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="새 컬렉션 이름" />
          <button className="secondary-button" type="button" onClick={() => void createCollection()} disabled={busy || loading}>추가</button>
        </div>
        <ul className="collection-list">
          {collections.map((collection) => (
            <li key={collection.id}>
              <button className={collection.id === selectedCollectionId ? "active" : ""} type="button" onClick={() => onSelectionChange(collection.id)}>
                <strong>{collection.title}</strong>
                <span>{collection.itemCount}개 함수 · 변경 {collection.changedCount} · 연결 필요 {collection.orphanCount}</span>
              </button>
              <button className="icon-danger" type="button" onClick={() => void deleteCollection(collection)} aria-label={`${collection.title} 삭제`}>×</button>
            </li>
          ))}
        </ul>
        {collections.length === 0 && <p className="muted collection-empty-message">아직 만든 컬렉션이 없습니다.</p>}
      </aside>

      <section className="collection-flow-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>{selectedCollection?.title ?? "컬렉션을 선택하세요"}</h2>
            {selectedSymbol && <p className="muted">현재 함수: <code>{selectedSymbol.fqn}</code></p>}
          </div>
          <div className="collection-toolbar">
            <button className="secondary-button" type="button" onClick={() => void addSelectedSymbol()} disabled={!selectedSymbol || busy || loading || selectedSymbolAlreadyIncluded}>
              {selectedSymbolAlreadyIncluded ? "이미 추가됨" : "컬렉션에 추가"}
            </button>
            <label className="toggle-label">
              보기
              <select value={mode} onChange={(event) => setMode(event.target.value as "order" | "calls")}>
                <option value="order">정렬 순서</option>
                <option value="calls">실제 호출 관계</option>
              </select>
            </label>
          </div>
        </div>
        {!detail && <p className="muted">왼쪽에서 컬렉션을 만들거나 선택하세요.</p>}
        {detail && mode === "calls" && (
          <CallGraph
            graph={graph}
            selectedSymbolId={selectedGraphSymbolId}
            onSelectSymbol={(id) => {
              setSelectedGraphSymbolId(id);
              onSelectSymbol(id);
            }}
            viewport={graphViewport}
            onViewportChange={setGraphViewport}
            canOpenDetail={Boolean(selectedGraphSymbolId && selectedSymbol?.id === selectedGraphSymbolId)}
            isSelectionLoading={busy || loading}
            onOpenDetail={onOpenRecord}
          />
        )}
        {detail && mode === "order" && (
          <ol className="collection-item-list">
            {detail.items.map((item, index) => (
              <li className={`collection-item-card status-${item.status}`} key={item.id}>
                <div className="collection-item-main">
                  <span className="collection-order">{index + 1}</span>
                  <div>
                    <strong title={collectionItemLabel(item)}>{collectionItemLabel(item)}</strong>
                    <small>{item.symbol?.relativePath ?? item.relativePath}:{item.symbol?.startLine ?? item.startLine}</small>
                  </div>
                  <div className="collection-badges">
                    {item.isChanged && <span className="changed-badge">변경됨</span>}
                    {item.status === "orphan" && <span className="orphan-badge">연결 필요</span>}
                  </div>
                </div>
                <div className="collection-item-controls">
                  <button type="button" onClick={() => void moveItem(item, -1)} disabled={index === 0}>↑</button>
                  <button type="button" onClick={() => void moveItem(item, 1)} disabled={index === detail.items.length - 1}>↓</button>
                  <select value={roles.some((role) => role.value === item.role) ? item.role : "other"} onChange={(event) => void updateItem(item, event.target.value, item.memo)}>
                    {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <input
                    defaultValue={item.memo}
                    key={`${item.id}-${item.updatedAt}`}
                    onBlur={(event) => {
                      if (event.target.value !== item.memo) {
                        void updateItem(item, item.role, event.target.value);
                      }
                    }}
                    placeholder="이 함수가 맡는 역할 메모"
                  />
                  {item.symbolId && <button type="button" onClick={() => { onSelectSymbol(item.symbolId!); onOpenRecord(); }}>열기</button>}
                  {item.isChanged && <button type="button" onClick={() => void markReviewed(item)}>검토 완료</button>}
                  <button type="button" onClick={() => void removeItem(item)}>제거</button>
                </div>
                {item.status === "orphan" && (
                  <div className="collection-relink">
                    <p>분석 결과에서 이 함수를 찾지 못했습니다. 현재 검색 결과에서 다시 연결할 수 있습니다.</p>
                    <div className="collection-relink-search">
                      <input
                        value={relinkQueries[item.id] ?? item.symbolFqn}
                        onChange={(event) => setRelinkQueries((values) => ({ ...values, [item.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchRelinkCandidates(item, event.currentTarget.value);
                          }
                        }}
                        placeholder="다시 연결할 함수 검색"
                      />
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void searchRelinkCandidates(item, relinkQueries[item.id] ?? item.symbolFqn)}
                      >
                        후보 찾기
                      </button>
                    </div>
                    <div className="relink-results">
                      {(relinkResults[item.id] ?? []).map((symbol) => (
                        <SymbolSearchResult
                          compact
                          disabled={false}
                          key={symbol.id}
                          selected={false}
                          symbol={symbol}
                          onSelect={(symbolId) => void relinkItem(item, symbolId)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {detail && mode === "order" && detail.items.length === 0 && (
          <p className="muted collection-empty-message">Explore에서 함수를 선택해 이 컬렉션에 추가하세요.</p>
        )}
      </section>

      <aside className="collection-detail-panel">
        <label className="field-label" htmlFor="collection-title">컬렉션 이름</label>
        <input id="collection-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} disabled={!detail} />
        <label className="field-label" htmlFor="collection-tags">태그</label>
        <input id="collection-tags" value={draftTags} onChange={(event) => setDraftTags(event.target.value)} disabled={!detail} placeholder="결제, 온보딩" />
        <label className="field-label" htmlFor="collection-overview">개요</label>
        <div className="markdown-mode-tabs collection-overview-tabs" role="tablist" aria-label="컬렉션 개요 표시 방식">
          <button
            className={overviewMode === "write" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={overviewMode === "write"}
            onClick={() => setOverviewMode("write")}
          >
            편집
          </button>
          <button
            className={overviewMode === "preview" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={overviewMode === "preview"}
            onClick={() => setOverviewMode("preview")}
          >
            미리보기
          </button>
        </div>
        {overviewMode === "write" ? (
          <textarea id="collection-overview" value={draftOverview} onChange={(event) => setDraftOverview(event.target.value)} disabled={!detail} placeholder="이 기능 흐름을 읽는 순서와 배경을 적어두세요." />
        ) : (
          <MarkdownPreview
            value={draftOverview}
            onLineReferenceClick={() => onNotice("함수별 줄 참조는 연결된 분석 문서에서 열어주세요.")}
          />
        )}
        <button className="primary-button" type="button" onClick={() => void saveCollection()} disabled={!detail || busy || loading}>개요 저장</button>
        {detail && (
          <section className="collection-export">
            <h3>Confluence 복사</h3>
            <div className="collection-note-picker">
              {detail.items.map((item) => (notesByItemId[item.id] ?? []).map((note) => {
                const key = noteKey(item.id, note.id);
                return (
                  <label key={key}>
                    <input
                      checked={selectedNoteIds.has(key)}
                      type="checkbox"
                      onChange={(event) => {
                        const next = new Set(selectedNoteIds);
                        if (event.target.checked) next.add(key);
                        else next.delete(key);
                        setSelectedNoteIds(next);
                      }}
                    />
                    <span>{collectionRoleLabels[item.role] ?? "기타"} · {note.title}</span>
                  </label>
                );
              }))}
            </div>
            <button className="secondary-button" type="button" onClick={() => void copyCollectionForConfluence()}>Confluence용 복사</button>
          </section>
        )}
      </aside>
    </section>
  );
}

function noteKey(itemId: number, noteId: number): string {
  return `${itemId}:${noteId}`;
}
