import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserWorkspace,
  browserFileAccessSupported,
  filesFromFileList,
  languageFromPath,
  pickRepositoryDirectory,
  privacyTooltip,
  type BrowserAnalysisIndex,
  type BrowserCollectionDetail,
  type BrowserCollectionSummary,
  type BrowserSourceFile,
  type CollectionItemRole,
  type GraphData,
  type NoteRecord,
  type SourceFile,
  type SymbolRecord,
} from "./core";
import { CallGraph } from "./components/CallGraph";
import { Tooltip } from "./components/Tooltip";

type WorkspaceTab = "explore" | "record" | "collections";

const supportedLanguages = [
  { label: "Java", extensions: ".java" },
  { label: "Python", extensions: ".py" },
  { label: "PHP", extensions: ".php" },
  { label: "TypeScript", extensions: ".ts, .tsx" },
];

const sampleSource = `export function greetUser(name: string) {\n  return formatMessage(name);\n}\n\nfunction formatMessage(name: string) {\n  return "Hello " + name;\n}\n`;

export default function App() {
  const workspaceRef = useRef<BrowserWorkspace | null>(null);
  workspaceRef.current ??= new BrowserWorkspace();
  const workspace = workspaceRef.current;
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<WorkspaceTab>("explore");
  const [index, setIndex] = useState<BrowserAnalysisIndex | null>(null);
  const [collections, setCollections] = useState<BrowserCollectionSummary[]>([]);
  const [collectionDetail, setCollectionDetail] = useState<BrowserCollectionDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [depth, setDepth] = useState(2);
  const [status, setStatus] = useState("URL에서 바로 실행할 수 있습니다.");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [fallbackPath, setFallbackPath] = useState("src/example.ts");
  const [fallbackSource, setFallbackSource] = useState(sampleSource);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    void workspace.load().then((state) => {
      setIndex(state.index);
      setSelectedId(state.workspace.selectedSymbolId ?? state.index?.symbols[0]?.id ?? null);
      setDepth(state.workspace.graphDepth);
      refreshCollections(state.workspace.selectedCollectionId ?? null);
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

  const symbols = index?.symbols ?? [];
  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedId) ?? null;
  const filteredSymbols = workspace.searchSymbols(query).filter((symbol) => languageFilter === "all" || symbol.language === languageFilter);
  const graph = useMemo(() => safeGraph(workspace, selectedId, depth), [workspace, selectedId, depth, index]);
  const sourceSlice = useMemo(() => safeSourceSlice(workspace, selectedSymbol), [workspace, selectedSymbol]);
  const note = selectedId ? workspace.listNotes(selectedId)[0] : undefined;
  const visibleCollections = collections.filter((collection) =>
    `${collection.title} ${collection.tags.join(" ")}`.toLowerCase().includes(collectionQuery.toLowerCase()),
  );
  const activeCollection = collectionDetail ?? (visibleCollections[0] ? workspace.getCollection(visibleCollections[0].id) : null);
  const selectedAlreadyIncluded = Boolean(selectedId
    && activeCollection?.items.some((item) => item.symbolId === selectedId));
  const collectionGraph = useMemo(() => safeCollectionGraph(workspace, activeCollection?.collection.id ?? null), [workspace, activeCollection?.collection.id, index]);

  async function analyzeRepository(input: { displayName: string; files: BrowserSourceFile[] }) {
    if (input.files.length === 0) {
      setStatus("지원되는 소스 파일을 찾지 못했습니다.");
      return;
    }
    setAnalyzing(true);
    setStatus("브라우저 WASM worker로 분석 중입니다...");
    try {
      const summary = await workspace.analyzeRepository({ displayName: input.displayName, files: input.files });
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
      await analyzeRepository({ displayName: picked.displayName, files: picked.files });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "폴더를 열지 못했습니다.");
    }
  }

  async function handleFallbackInput(files: FileList | null) {
    if (!files?.length) return;
    await analyzeRepository({ displayName: "selected-files", files: await filesFromFileList(files) });
  }

  async function handlePasteAnalysis() {
    const language = languageFromPath(fallbackPath);
    if (!language) {
      setStatus("붙여넣기 경로는 .java, .py, .php, .ts, .tsx 중 하나여야 합니다.");
      return;
    }
    await analyzeRepository({ displayName: "pasted-source", files: [{ relativePath: fallbackPath, source: fallbackSource, language }] });
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
      else {
        await workspace.createNote(
          selectedId,
          title || selectedSymbol?.fqn.split(".").at(-1) || "노트",
          bodyMarkdown,
          tagList,
        );
      }
      setStatus("노트를 저장했습니다.");
    } catch (error) {
      setStatus(`노트를 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OnboardCode Web</p>
          <h1>로컬 코드 그래프 노트</h1>
        </div>
        <div className="topbar-actions">
          <span className="privacy-badge">브라우저 안에서만 처리</span>
          <span className={`status-pill ${online ? "online" : "offline"}`}>{online ? "온라인" : "오프라인"}</span>
          <Tooltip label="웹 배포판">
            <ul>{privacyTooltip.map((item) => <li key={item}>{item}</li>)}</ul>
          </Tooltip>
        </div>
      </header>

      <nav className="tabs" aria-label="작업 영역">
        {(["explore", "record", "collections"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} type="button" onClick={() => setTab(item)}>
            {item === "explore" ? "Explore" : item === "record" ? "Record" : "Collections"}
          </button>
        ))}
      </nav>

      <section className="status-row" aria-live="polite">{status}</section>

      {tab === "explore" && (
        <section className="workspace-grid">
          <aside className="panel sidebar">
            <div className="panel-title-row">
              <h2>분석</h2>
              <Tooltip label="코드 분석">
                <span>선택한 폴더의 Java, Python, PHP, TypeScript 파일을 브라우저 WASM worker에서 읽고 함수 목록과 호출 후보를 만듭니다.</span>
              </Tooltip>
            </div>
            <button className="primary-action" type="button" onClick={handleDirectoryPick} disabled={!browserFileAccessSupported() || analyzing}>
              {analyzing ? "분석 중…" : "폴더 열기"}
            </button>
            <button className="secondary-action" type="button" onClick={() => fileInput.current?.click()} disabled={analyzing}>
              파일로 열기
            </button>
            <input ref={fileInput} className="hidden-input" type="file" multiple webkitdirectory="" onChange={(event) => void handleFallbackInput(event.currentTarget.files)} />
            <label className="field-label">
              붙여넣기 경로
              <input value={fallbackPath} onChange={(event) => setFallbackPath(event.target.value)} />
            </label>
            <label className="field-label">
              붙여넣기 코드
              <textarea value={fallbackSource} onChange={(event) => setFallbackSource(event.target.value)} rows={8} />
            </label>
            <button className="secondary-action" type="button" onClick={() => void handlePasteAnalysis()} disabled={analyzing}>
              붙여넣기 분석
            </button>
            <div className="language-list">
              {supportedLanguages.map((language) => <span key={language.label}>{language.label} {language.extensions}</span>)}
            </div>
          </aside>

          <section className="panel symbol-panel">
            <div className="filter-row">
              <input aria-label="함수 검색" placeholder="함수, 클래스, 파일 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
              <select aria-label="언어 필터" value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}>
                <option value="all">전체</option>
                <option value="java">Java</option>
                <option value="python">Python</option>
                <option value="php">PHP</option>
                <option value="typescript">TypeScript</option>
              </select>
              <label className="depth-control">
                깊이
                <input type="range" min="1" max="3" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
                {depth}
              </label>
            </div>
            <div className="symbol-list" role="list">
              {filteredSymbols.map((symbol) => (
                <button key={symbol.id} className={symbol.id === selectedId ? "symbol-card active" : "symbol-card"} type="button" onClick={() => setSelectedId(symbol.id)}>
                  <span>{symbol.fqn}</span>
                  <small>{symbol.relativePath}:{symbol.startLine}</small>
                </button>
              ))}
              {filteredSymbols.length === 0 && <p className="empty-text">분석된 함수가 없습니다.</p>}
            </div>
          </section>

          <section className="panel graph-panel">
            <CallGraph graph={graph} selectedSymbolId={selectedId} onSelectSymbol={setSelectedId} />
          </section>

          <section className="panel source-panel">
            <div className="panel-title-row">
              <h2>소스</h2>
              {selectedSymbol && <button className="secondary-action compact" type="button" onClick={() => setTab("record")}>기록</button>}
            </div>
            <pre>{sourceSlice || "선택한 함수의 코드가 여기에 표시됩니다. 새로 접속했다면 같은 폴더를 다시 열어 주세요."}</pre>
          </section>
        </section>
      )}

      {tab === "record" && <RecordWorkspace selectedSymbol={selectedSymbol} note={note} onSave={saveCurrentNote} />}

      {tab === "collections" && (
        <section className="workspace-grid collections-grid">
          <aside className="panel sidebar">
            <h2>컬렉션</h2>
            <div className="inline-form">
              <input aria-label="컬렉션 이름" placeholder="기능 이름" value={collectionTitle} onChange={(event) => setCollectionTitle(event.target.value)} />
              <button type="button" onClick={() => void (async () => {
                try {
                  await workspace.createCollection(collectionTitle || "새 컬렉션");
                  setCollectionTitle("");
                  refreshCollections(null);
                } catch (error) {
                  setStatus(`컬렉션을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                }
              })()}>생성</button>
            </div>
            <input className="collection-search" aria-label="컬렉션 검색" placeholder="컬렉션 검색" value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} />
            {visibleCollections.map((collection) => (
              <div key={collection.id} className="collection-row">
                <button type="button" onClick={() => setCollectionDetail(workspace.getCollection(collection.id))}>{collection.title}</button>
                <small>{collection.itemCount}개</small>
                <button type="button" onClick={() => void (async () => {
                  if (window.confirm(`${collection.title} 컬렉션을 삭제할까요?`)) {
                    try {
                      await workspace.deleteCollection(collection.id);
                      refreshCollections(null);
                    } catch (error) {
                      setStatus(`컬렉션을 삭제하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                    }
                  }
                })()}>삭제</button>
              </div>
            ))}
          </aside>
          <section className="panel collection-detail">
            <div className="panel-title-row">
              <h2>{activeCollection?.collection.title ?? "컬렉션을 만들어 주세요"}</h2>
              {activeCollection && selectedSymbol && (
                <button
                  className="primary-action compact"
                  type="button"
                  disabled={selectedAlreadyIncluded}
                  onClick={() => void (async () => {
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
              )}
            </div>
            {activeCollection && (
              <div className="collection-items">
                {activeCollection.items.map((item) => (
                  <article key={item.id} className={`collection-item ${item.isChanged ? "changed" : item.status}`}>
                    <div>
                      <strong>{item.symbolFqn}</strong>
                      <small>{item.isChanged ? "변경됨" : item.status === "orphan" ? "연결 필요" : "연결됨"}</small>
                    </div>
                    <select value={String(item.role)} onChange={(event) => void (async () => {
                      try {
                        const saved = workspace.updateCollectionItem(activeCollection.collection.id, item.id, { role: event.target.value as CollectionItemRole });
                        refreshCollections(activeCollection.collection.id);
                        await saved;
                      } catch (error) {
                        setStatus(`컬렉션을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                      }
                    })()}>
                      <option value="entry">entry</option>
                      <option value="core">core</option>
                      <option value="data">data</option>
                      <option value="external">external</option>
                      <option value="error">error</option>
                      <option value="other">other</option>
                    </select>
                    <input aria-label={`${item.symbolFqn} 메모`} placeholder="메모" value={item.memo} onChange={(event) => void (async () => {
                      try {
                        const saved = workspace.updateCollectionItem(activeCollection.collection.id, item.id, { memo: event.target.value });
                        refreshCollections(activeCollection.collection.id);
                        await saved;
                      } catch (error) {
                        setStatus(`컬렉션을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
                      }
                    })()} />
                    <div className="move-actions">
                      <button type="button" onClick={() => void reorderItem(workspace, activeCollection, item.id, -1, refreshCollections, setStatus)}>위</button>
                      <button type="button" onClick={() => void reorderItem(workspace, activeCollection, item.id, 1, refreshCollections, setStatus)}>아래</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="panel graph-panel">
            <CallGraph graph={collectionGraph} selectedSymbolId={selectedId} onSelectSymbol={setSelectedId} />
          </section>
        </section>
      )}
    </main>
  );
}

function RecordWorkspace({
  selectedSymbol,
  note,
  onSave,
}: {
  selectedSymbol: SymbolRecord | null;
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
    <section className="record-layout">
      <div className="panel record-editor">
        <h2>{selectedSymbol ? selectedSymbol.fqn : "함수를 먼저 선택하세요"}</h2>
        <label className="field-label">제목<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!selectedSymbol} /></label>
        <label className="field-label">태그<input value={tags} onChange={(event) => setTags(event.target.value)} disabled={!selectedSymbol} placeholder="api, auth" /></label>
        <label className="field-label">노트<textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={!selectedSymbol} rows={14} /></label>
        <button className="primary-action compact" type="button" disabled={!selectedSymbol} onClick={() => void onSave(title, body, tags)}>저장</button>
      </div>
    </section>
  );
}

function safeGraph(workspace: BrowserWorkspace, symbolId: string | null, depth: number): GraphData | null {
  if (!symbolId) return null;
  try {
    return workspace.getGraph(symbolId, depth);
  } catch {
    return null;
  }
}

function safeSourceSlice(workspace: BrowserWorkspace, symbol: SymbolRecord | null): string {
  if (!symbol) return "";
  try {
    const file = workspace.readSource(symbol.id);
    return sliceAroundSymbol(file, symbol);
  } catch {
    return "";
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

function sliceAroundSymbol(file: SourceFile, symbol: SymbolRecord): string {
  return file.source.split(/\r?\n/).slice(Math.max(0, symbol.startLine - 3), symbol.endLine + 2).join("\n");
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
