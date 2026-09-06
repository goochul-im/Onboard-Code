import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserWorkspace,
  browserFileAccessSupported,
  filesFromFileList,
  pickRepositoryDirectory,
  privacyTooltip,
  type BrowserAnalysisIndex,
  type BrowserCollectionDetail,
  type BrowserCollectionSummary,
  type BrowserRepositoryInput,
  type BrowserSourceFile,
  type CollectionItemRole,
  type GraphData,
  type NoteRecord,
  type SourceFile,
  type SymbolRecord,
} from "./core";
import { CallGraph } from "./components/CallGraph";
import { GroupedSymbolList } from "./components/GroupedSymbolList";
import { SelectedSymbolHeading } from "./components/SelectedSymbolHeading";
import { Tooltip } from "./components/Tooltip";

type WorkspaceTab = "explore" | "record" | "collections";
type CollectionView = "order" | "graph";

const workspaces: Array<{ id: WorkspaceTab; label: string; description: string }> = [
  { id: "explore", label: "Explore", description: "함수와 호출 관계 탐색" },
  { id: "record", label: "Record", description: "선택한 함수의 소스와 노트" },
  { id: "collections", label: "Collections", description: "기능별 함수 흐름" },
];

export default function App() {
  const workspaceRef = useRef<BrowserWorkspace | null>(null);
  workspaceRef.current ??= new BrowserWorkspace();
  const workspace = workspaceRef.current;
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<WorkspaceTab>("explore");
  const [index, setIndex] = useState<BrowserAnalysisIndex | null>(null);
  const [repositoryInput, setRepositoryInput] = useState<BrowserRepositoryInput | null>(null);
  const [collections, setCollections] = useState<BrowserCollectionSummary[]>([]);
  const [collectionDetail, setCollectionDetail] = useState<BrowserCollectionDetail | null>(null);
  const [collectionView, setCollectionView] = useState<CollectionView>("order");
  const [collectionAddOpen, setCollectionAddOpen] = useState(false);
  const [targetCollectionId, setTargetCollectionId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [depth, setDepth] = useState(2);
  const [status, setStatus] = useState("폴더를 열면 브라우저 안에서 코드를 분석합니다.");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    void workspace.load().then((state) => {
      setIndex(state.index);
      const restoredSelection = state.index?.symbols.some((symbol) => symbol.id === state.workspace.selectedSymbolId)
        ? state.workspace.selectedSymbolId
        : state.index?.symbols[0]?.id ?? null;
      setSelectedId(restoredSelection);
      setDepth(state.workspace.graphDepth);
      refreshCollections(state.workspace.selectedCollectionId ?? null);
      if (state.workspace.reanalysisRequired) {
        setStatus("그래프 저장 형식이 변경되었습니다. 노트와 컬렉션은 유지했으니 폴더를 다시 열어 분석해 주세요.");
      } else if (state.index) {
        setStatus(`${state.index.summary.sourceFileCount}개 파일, ${state.index.summary.symbolCount}개 함수, ${state.index.summary.edgeCount}개 호출 관계`);
      }
    }).catch((error) => {
      setStatus(`저장된 브라우저 데이터를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [workspace]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [tab]);

  const symbols = index?.symbols ?? [];
  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedId) ?? null;
  const filteredSymbols = workspace.searchSymbols(query)
    .filter((symbol) => languageFilter === "all" || symbol.language === languageFilter);
  const graphResult = useMemo(() => readGraph(workspace, selectedId, depth), [workspace, selectedId, depth, index]);
  const graph = graphResult.graph;
  const uncertainEdges = graph?.edges.filter((edge) => !edge.target) ?? [];
  const confirmedEdgeCount = graph?.edges.filter((edge) => edge.target).length ?? 0;
  const sourceFile = useMemo(() => safeSourceFile(workspace, selectedSymbol), [workspace, selectedSymbol]);
  const note = selectedId ? workspace.listNotes(selectedId)[0] : undefined;
  const visibleCollections = collections.filter((collection) =>
    `${collection.title} ${collection.tags.join(" ")}`.toLowerCase().includes(collectionQuery.toLowerCase()));
  const activeCollection = collectionDetail
    ?? (visibleCollections[0] ? workspace.getCollection(visibleCollections[0].id) : null);
  const selectedAlreadyIncluded = Boolean(selectedId
    && activeCollection?.items.some((item) => item.symbolId === selectedId));
  const collectionGraph = useMemo(
    () => safeCollectionGraph(workspace, activeCollection?.collection.id ?? null),
    [workspace, activeCollection?.collection.id, index],
  );

  async function analyzeRepository(input: BrowserRepositoryInput) {
    if (input.files.length === 0) {
      setStatus("지원되는 소스 파일을 찾지 못했습니다.");
      return;
    }
    setRepositoryInput(input);
    setAnalyzing(true);
    setStatus("브라우저 WASM worker로 분석 중입니다…");
    try {
      const summary = await workspace.analyzeRepository(input);
      const currentIndex = workspace.currentIndex();
      setIndex(currentIndex);
      setSelectedId(currentIndex?.symbols[0]?.id ?? null);
      refreshCollections(activeCollection?.collection.id ?? null);
      setStatus(`${summary.sourceFileCount}개 파일, ${summary.symbolCount}개 함수, ${summary.edgeCount}개 호출 관계를 분석했습니다.`);
    } catch (error) {
      setStatus(`분석하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDirectoryPick() {
    try {
      const picked = await pickRepositoryDirectory();
      await analyzeRepository(picked);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "폴더를 열지 못했습니다.");
    }
  }

  async function handleFallbackInput(files: FileList | null) {
    if (!files?.length) return;
    const loaded = await filesFromFileList(files);
    const firstFolder = loaded[0]?.relativePath.split("/")[0];
    await analyzeRepository({ displayName: firstFolder || "선택한 폴더", files: loaded });
  }

  function refreshCollections(preferredId: number | null) {
    const list = workspace.listCollections();
    setCollections(list);
    const nextId = preferredId && list.some((collection) => collection.id === preferredId)
      ? preferredId
      : list[0]?.id ?? null;
    setCollectionDetail(nextId ? workspace.getCollection(nextId) : null);
  }

  async function saveCurrentNote(title: string, bodyMarkdown: string, tags: string) {
    if (!selectedId) return;
    const tagList = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    try {
      if (note?.id) await workspace.updateNote(note.id, { title, bodyMarkdown, tags: tagList });
      else await workspace.createNote(selectedId, title || selectedSymbol?.fqn.split(".").at(-1) || "노트", bodyMarkdown, tagList);
      setStatus("노트를 저장했습니다.");
    } catch (error) {
      setStatus(`노트를 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function openCollectionAddDialog() {
    if (!selectedSymbol) return;
    if (collections.length === 0) {
      setTab("collections");
      setStatus("컬렉션을 먼저 만든 뒤 선택한 함수를 추가해 주세요.");
      return;
    }
    setTargetCollectionId(activeCollection?.collection.id ?? collections[0].id);
    setCollectionAddOpen(true);
  }

  async function confirmCollectionAdd() {
    if (!selectedSymbol || !targetCollectionId) return;
    try {
      await workspace.addCollectionItem(targetCollectionId, selectedSymbol.id, "other", "");
      refreshCollections(targetCollectionId);
      setCollectionAddOpen(false);
      setStatus(`${selectedSymbol.fqn}을(를) 컬렉션에 추가했습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <h1>코드 그래프 노트 <span className="web-build-badge">Web</span></h1>
        <div className="topbar-actions">
          <span className="privacy-badge">브라우저 안에서만 처리</span>
          <span className={`status-pill ${online ? "online" : "offline"}`}>{online ? "온라인" : "오프라인"}</span>
          <Tooltip label="웹 배포판">
            <ul>{privacyTooltip.map((item) => <li key={item}>{item}</li>)}</ul>
          </Tooltip>
          <button className="secondary-button topbar-open" type="button" onClick={() => void handleDirectoryPick()} disabled={!browserFileAccessSupported() || analyzing}>
            {analyzing ? "분석 중…" : "저장소 열기"}
          </button>
        </div>
      </header>

      <nav className="workspace-nav" aria-label="분석 작업공간">
        {workspaces.map(({ id, label, description }) => (
          <button
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            title={description}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="notice" role="status" aria-live="polite">{status}</section>

      {tab === "explore" && (
        <div className="workspace-grid workspace-explore">
          <section className="sidebar explore-sidebar" aria-label="함수 찾기">
            <span className="field-label">저장소</span>
            <div className="repository-choice">
              <strong>{index?.repository.displayName ?? "폴더를 선택하세요"}</strong>
              <span>{index ? `브라우저 분석 · ${shortRevision(index.repository.head)}` : "소스는 브라우저 메모리에서만 읽습니다."}</span>
            </div>

            <div className="analysis-action">
              <button
                className="primary-button"
                type="button"
                onClick={() => repositoryInput && void analyzeRepository(repositoryInput)}
                disabled={!repositoryInput || analyzing}
              >
                {analyzing ? "처리 중…" : "코드 분석"}
              </button>
              <Tooltip label="코드 분석">
                <span>선택한 폴더의 지원 소스를 서버로 보내지 않고 브라우저 WASM worker에서 분석합니다.</span>
              </Tooltip>
            </div>
            <button className="secondary-button fallback-open" type="button" onClick={() => fileInput.current?.click()} disabled={analyzing}>
              파일 선택으로 열기
            </button>
            <input ref={fileInput} className="hidden-input" type="file" multiple webkitdirectory="" onChange={(event) => void handleFallbackInput(event.currentTarget.files)} />
            {index && <p className="analysis-summary">{index.summary.edgeCount}개 호출 관계 · {index.summary.status ?? "completed"}</p>}

            <label className="field-label" htmlFor="symbol-search">함수 찾기</label>
            <input
              id="symbol-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="함수명, 클래스, 파일명"
              disabled={!index}
            />
            <label className="field-label compact-label" htmlFor="language-filter">언어</label>
            <select id="language-filter" value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} disabled={!index}>
              <option value="all">전체</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
              <option value="php">PHP</option>
              <option value="typescript">TypeScript</option>
            </select>
            <GroupedSymbolList
              symbols={filteredSymbols}
              query={query}
              selectedSymbolId={selectedId}
              disabled={analyzing}
              showEmptyMessage={Boolean(index)}
              onSelect={setSelectedId}
            />
          </section>

          <section className="graph-panel" aria-label="호출 관계">
            <div className="panel-heading">
              <div className="panel-title"><SelectedSymbolHeading symbol={selectedSymbol} /></div>
              <div className="graph-actions">
                <button className="secondary-button small" disabled={!selectedSymbol} onClick={openCollectionAddDialog} type="button">
                  컬렉션에 추가
                </button>
                <label className="depth-control">
                  펼칠 깊이
                  <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} disabled={!selectedSymbol}>
                    <option value={1}>1단계</option>
                    <option value={2}>2단계</option>
                    <option value={3}>3단계</option>
                  </select>
                </label>
              </div>
            </div>
            <p className="graph-guide">
              {selectedSymbol
                ? `확정 관계 ${confirmedEdgeCount}개 · 불확실 호출 ${uncertainEdges.length}개`
                : "노드를 선택한 뒤 옆에 나타나는 버튼으로 소스와 분석 문서를 여세요."}
            </p>
            <CallGraph
              graph={graph}
              selectedSymbolId={selectedId}
              onSelectSymbol={setSelectedId}
              canOpenDetail={Boolean(selectedSymbol && sourceFile)}
              onOpenDetail={() => setTab("record")}
            />
            {graphResult.error && <p className="graph-error" role="alert">호출 그래프를 불러오지 못했습니다: {graphResult.error}</p>}
            {graph && selectedSymbol && graph.nodes.length === 1 && uncertainEdges.length === 0 && (
              <p className="graph-status">이 함수에서 확정된 caller/callee 관계를 찾지 못했습니다.</p>
            )}
            {uncertainEdges.length > 0 && <UncertainCalls edges={uncertainEdges} />}
          </section>
        </div>
      )}

      {tab === "record" && (
        <RecordWorkspace selectedSymbol={selectedSymbol} sourceFile={sourceFile} note={note} onSave={saveCurrentNote} />
      )}

      {tab === "collections" && (
        <section className="collections-workspace">
          <aside className="collections-sidebar">
            <h2>컬렉션</h2>
            <div className="collection-create-row">
              <input aria-label="컬렉션 이름" placeholder="기능 이름" value={collectionTitle} onChange={(event) => setCollectionTitle(event.target.value)} />
              <button className="secondary-button" type="button" onClick={() => void (async () => {
                try {
                  const created = await workspace.createCollection(collectionTitle || "새 컬렉션");
                  setCollectionTitle("");
                  refreshCollections(created.collection.id);
                } catch (error) {
                  setStatus(`컬렉션을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                }
              })()}>생성</button>
            </div>
            <input className="collection-search" aria-label="컬렉션 검색" placeholder="컬렉션 검색" value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} />
            <ul className="collection-list">
              {visibleCollections.map((collection) => (
                <li key={collection.id}>
                  <button
                    type="button"
                    className={activeCollection?.collection.id === collection.id ? "active" : ""}
                    onClick={() => setCollectionDetail(workspace.getCollection(collection.id))}
                  >
                    <strong>{collection.title}</strong>
                    <span>{collection.itemCount}개 함수 · 변경 {collection.changedCount}</span>
                  </button>
                  <button className="text-danger" type="button" aria-label={`${collection.title} 삭제`} onClick={() => void (async () => {
                    if (!window.confirm(`${collection.title} 컬렉션을 삭제할까요?`)) return;
                    try {
                      await workspace.deleteCollection(collection.id);
                      refreshCollections(null);
                    } catch (error) {
                      setStatus(`컬렉션을 삭제하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                    }
                  })()}>삭제</button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="collection-flow-panel">
            <div className="collection-toolbar">
              <div>
                <h2>{activeCollection?.collection.title ?? "컬렉션을 만들어 주세요"}</h2>
                {selectedSymbol && <p className="muted">현재 함수: <code>{selectedSymbol.fqn}</code></p>}
              </div>
              <label className="toggle-label">
                보기
                <select value={collectionView} onChange={(event) => setCollectionView(event.target.value as CollectionView)} disabled={!activeCollection}>
                  <option value="order">읽기 순서</option>
                  <option value="graph">호출 그래프</option>
                </select>
              </label>
              <button
                className="secondary-button small"
                type="button"
                disabled={!activeCollection || !selectedSymbol || selectedAlreadyIncluded}
                onClick={() => activeCollection && selectedSymbol && void (async () => {
                  try {
                    await workspace.addCollectionItem(activeCollection.collection.id, selectedSymbol.id, "entry", "");
                    refreshCollections(activeCollection.collection.id);
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : String(error));
                  }
                })()}
              >
                {selectedAlreadyIncluded ? "이미 추가됨" : "현재 함수 추가"}
              </button>
            </div>

            {!activeCollection && <p className="muted collection-empty-message">왼쪽에서 컬렉션을 만들어 기능 흐름을 정리하세요.</p>}
            {activeCollection && collectionView === "graph" && (
              <CallGraph graph={collectionGraph} selectedSymbolId={selectedId} onSelectSymbol={setSelectedId} canOpenDetail={Boolean(sourceFile)} onOpenDetail={() => setTab("record")} />
            )}
            {activeCollection && collectionView === "order" && (
              <ol className="collection-item-list">
                {activeCollection.items.map((item, indexPosition) => (
                  <li key={item.id} className={`collection-item-card ${item.isChanged ? "status-changed" : `status-${item.status}`}`}>
                    <div className="collection-item-main">
                      <span className="collection-order">{indexPosition + 1}</span>
                      <span>
                        <strong>{item.symbolFqn}</strong>
                        <small>{item.relativePath}:{item.startLine}</small>
                      </span>
                      <span className="collection-badges">
                        {item.isChanged && <span className="changed-badge">변경됨</span>}
                        {item.status === "orphan" && <span className="orphan-badge">연결 필요</span>}
                      </span>
                    </div>
                    <div className="collection-item-controls">
                      <button type="button" onClick={() => void reorderItem(workspace, activeCollection, item.id, -1, refreshCollections, setStatus)}>위</button>
                      <button type="button" onClick={() => void reorderItem(workspace, activeCollection, item.id, 1, refreshCollections, setStatus)}>아래</button>
                      <select value={String(item.role)} onChange={(event) => void updateCollectionItem(workspace, activeCollection, item.id, { role: event.target.value as CollectionItemRole }, refreshCollections, setStatus)}>
                        <option value="entry">entry</option>
                        <option value="core">core</option>
                        <option value="data">data</option>
                        <option value="external">external</option>
                        <option value="error">error</option>
                        <option value="other">other</option>
                      </select>
                      <input aria-label={`${item.symbolFqn} 메모`} placeholder="메모" value={item.memo} onChange={(event) => void updateCollectionItem(workspace, activeCollection, item.id, { memo: event.target.value }, refreshCollections, setStatus)} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside className="collection-detail-panel">
            <h2>기능 정보</h2>
            {activeCollection ? (
              <>
                <dl className="collection-stats">
                  <div><dt>함수</dt><dd>{activeCollection.collection.itemCount}</dd></div>
                  <div><dt>변경</dt><dd>{activeCollection.collection.changedCount}</dd></div>
                  <div><dt>연결 필요</dt><dd>{activeCollection.collection.orphanCount}</dd></div>
                </dl>
                <div className="web-limit-note">
                  <strong>웹 기본 컬렉션</strong>
                  <p>순서·역할·메모와 호출 그래프를 지원합니다. 개요·수동 재연결·검토 완료·Confluence 내보내기는 데스크톱 앱에서 사용할 수 있습니다.</p>
                </div>
              </>
            ) : <p className="muted">선택한 컬렉션의 상태가 여기에 표시됩니다.</p>}
          </aside>
        </section>
      )}

      {collectionAddOpen && selectedSymbol && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setCollectionAddOpen(false);
        }}>
          <section className="collection-add-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-add-title">
            <header>
              <h2 id="collection-add-title">컬렉션에 추가</h2>
              <button type="button" onClick={() => setCollectionAddOpen(false)} aria-label="닫기">닫기</button>
            </header>
            <p><code>{selectedSymbol.fqn}</code></p>
            <label className="field-label" htmlFor="target-collection">대상 컬렉션</label>
            <select id="target-collection" value={targetCollectionId ?? ""} onChange={(event) => setTargetCollectionId(Number(event.target.value))}>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}
            </select>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setCollectionAddOpen(false)}>취소</button>
              <button className="primary-button small" type="button" onClick={() => void confirmCollectionAdd()}>추가</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function RecordWorkspace({
  selectedSymbol,
  sourceFile,
  note,
  onSave,
}: {
  selectedSymbol: SymbolRecord | null;
  sourceFile: SourceFile | null;
  note: NoteRecord | undefined;
  onSave: (title: string, bodyMarkdown: string, tags: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.bodyMarkdown ?? "");
  const [tags, setTags] = useState(note?.tags.join(", ") ?? "");

  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.bodyMarkdown ?? "");
    setTags(note?.tags.join(", ") ?? "");
  }, [note, selectedSymbol?.id]);

  return (
    <section className="record-workspace" aria-label="분석 기록">
      <header className="record-workspace-header">
        <div>
          <h2 title={selectedSymbol?.fqn}>{selectedSymbol?.fqn ?? "함수를 선택하세요"}</h2>
          {!selectedSymbol && <p className="muted">Explore에서 함수를 선택하면 기본 분석 노트를 작성할 수 있습니다.</p>}
        </div>
      </header>
      <div className="detail-workspace record-detail-workspace">
        <section className="source-workspace" aria-label="선택한 함수 소스">
          <div className="source-heading">
            <h3>소스</h3>
            {selectedSymbol && <span>{selectedSymbol.relativePath}:{selectedSymbol.startLine}-{selectedSymbol.endLine}</span>}
          </div>
          <pre className="code-preview full-source">{sourceFile?.source ?? "원본 소스는 영구 저장하지 않습니다. Explore에서 같은 폴더를 다시 열어 주세요."}</pre>
        </section>
        <section className="markdown-editor" aria-label="함수 노트">
          <div className="markdown-editor-header">
            <div><h2>분석 기록</h2><p className="muted">웹 기본 노트</p></div>
            <button className="primary-button small" type="button" disabled={!selectedSymbol} onClick={() => void onSave(title, body, tags)}>저장</button>
          </div>
          <label className="field-label">제목<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!selectedSymbol} /></label>
          <label className="field-label">태그<input value={tags} onChange={(event) => setTags(event.target.value)} disabled={!selectedSymbol} placeholder="api, auth" /></label>
          <label className="field-label note-body-label">노트<textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={!selectedSymbol} /></label>
        </section>
      </div>
    </section>
  );
}

function UncertainCalls({ edges }: { edges: NonNullable<GraphData>["edges"] }) {
  return (
    <div className="uncertain-calls">
      <strong>확정할 수 없는 호출</strong>
      <ul>
        {edges.map((edge) => (
          <li key={edge.id}>
            <code>{edge.unresolvedName}</code> · {edge.confidence === "ambiguous" ? "후보가 여러 개" : "대상을 찾지 못함"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function readGraph(
  workspace: BrowserWorkspace,
  symbolId: string | null,
  depth: number,
): { graph: GraphData | null; error: string | null } {
  if (!symbolId) return { graph: null, error: null };
  try {
    return { graph: workspace.getGraph(symbolId, depth), error: null };
  } catch (error) {
    return { graph: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeSourceFile(workspace: BrowserWorkspace, symbol: SymbolRecord | null): SourceFile | null {
  if (!symbol) return null;
  try {
    return workspace.readSource(symbol.id);
  } catch {
    return null;
  }
}

function safeCollectionGraph(workspace: BrowserWorkspace, collectionId: number | null): GraphData | null {
  if (!collectionId) return null;
  try {
    return workspace.getCollectionGraph(collectionId);
  } catch {
    return null;
  }
}

function shortRevision(revision: string): string {
  return revision.length > 8 ? revision.slice(0, 8) : revision;
}

async function updateCollectionItem(
  workspace: BrowserWorkspace,
  detail: BrowserCollectionDetail,
  itemId: number,
  patch: { role?: CollectionItemRole; memo?: string },
  refresh: (preferredId: number | null) => void,
  setStatus: (message: string) => void,
) {
  try {
    const saved = workspace.updateCollectionItem(detail.collection.id, itemId, patch);
    refresh(detail.collection.id);
    await saved;
  } catch (error) {
    setStatus(`컬렉션을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reorderItem(
  workspace: BrowserWorkspace,
  detail: BrowserCollectionDetail,
  itemId: number,
  direction: -1 | 1,
  refresh: (preferredId: number | null) => void,
  setStatus: (message: string) => void,
) {
  const ids = detail.items.map((item) => item.id);
  const index = ids.indexOf(itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try {
    const saved = workspace.reorderCollectionItems(detail.collection.id, ids);
    refresh(detail.collection.id);
    await saved;
  } catch (error) {
    setStatus(`컬렉션 순서를 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}
