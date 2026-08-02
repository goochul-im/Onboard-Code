import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { CallGraph } from "./components/CallGraph";
import { MarkdownEditor } from "./components/MarkdownEditor";
import type {
  AnalysisSummary,
  GraphData,
  OrphanNote,
  RepositoryRecord,
  SourceFile,
  SymbolRecord,
} from "./types";

function App() {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<SymbolRecord[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolRecord | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [depth, setDepth] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [orphanNotes, setOrphanNotes] = useState<OrphanNote[]>([]);
  const [activeView, setActiveView] = useState<"graph" | "detail">("graph");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("로컬 Git 저장소를 열어 분석을 시작하세요.");
  const selectedCodeLine = useRef<HTMLElement | null>(null);

  const repository = useMemo(
    () => repositories.find((item) => item.id === repositoryId) ?? null,
    [repositories, repositoryId],
  );

  const loadSymbols = useCallback(async (targetRepositoryId: string, targetQuery: string) => {
    const nextSymbols = await api.searchSymbols(targetRepositoryId, targetQuery);
    setSymbols(nextSymbols);
    return nextSymbols;
  }, []);

  const loadOrphanNotes = useCallback(async (targetRepositoryId: string) => {
    const items = await api.listOrphanNotes(targetRepositoryId);
    setOrphanNotes(items);
  }, []);

  useEffect(() => {
    void api
      .listRepositories()
      .then((items) => {
        setRepositories(items);
        if (items.length > 0) {
          setRepositoryId(items[0].id);
          setNotice("등록한 저장소를 선택하거나 새 저장소를 추가하세요.");
        }
      })
      .catch((error: unknown) => setNotice(`저장소 목록을 읽지 못했습니다: ${String(error)}`));
  }, []);

  useEffect(() => {
    if (!repositoryId) {
      setSymbols([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void loadSymbols(repositoryId, query).catch((error: unknown) =>
        setNotice(`함수 검색을 완료하지 못했습니다: ${String(error)}`),
      );
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [repositoryId, query, loadSymbols]);

  useEffect(() => {
    if (!repositoryId) {
      setOrphanNotes([]);
      return;
    }
    void loadOrphanNotes(repositoryId).catch((error: unknown) =>
      setNotice(`연결이 끊긴 노트를 읽지 못했습니다: ${String(error)}`),
    );
  }, [repositoryId, loadOrphanNotes]);

  const selectSymbol = useCallback(
    async (symbolId: string) => {
      if (!repositoryId) {
        return;
      }
      const symbol = symbols.find((item) => item.id === symbolId) ?? graph?.nodes.find((item) => item.id === symbolId);
      if (!symbol) {
        return;
      }
      setBusy(true);
      try {
        const [nextGraph, nextSource, nextNote] = await Promise.all([
          api.getGraph(repositoryId, symbolId, depth),
          api.readSource(repositoryId, symbolId),
          api.getNote(repositoryId, symbolId),
        ]);
        setSelectedSymbol(symbol);
        setGraph(nextGraph);
        setSourceFile(nextSource);
        setNoteBody(nextNote?.bodyMarkdown ?? "");
        setTagsInput(nextNote?.tags.join(", ") ?? "");
        setNotice(`${symbol.fqn}을(를) 열었습니다.`);
      } catch (error) {
        setNotice(`함수를 열지 못했습니다: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [depth, graph?.nodes, repositoryId, symbols],
  );

  useEffect(() => {
    if (selectedSymbol) {
      void selectSymbol(selectedSymbol.id);
    }
  }, [depth]); // depth changes intentionally reload the selected graph

  useEffect(() => {
    if (activeView === "detail" && sourceFile) {
      selectedCodeLine.current?.scrollIntoView({ block: "center" });
    }
  }, [activeView, sourceFile]);

  const chooseRepository = async () => {
    const path = await open({
      directory: true,
      multiple: false,
      title: "로컬 Git 저장소 폴더 선택",
    });
    if (typeof path !== "string") {
      return;
    }
    setBusy(true);
    try {
      const nextRepository = await api.registerRepository(path);
      setRepositories((items) => [nextRepository, ...items.filter((item) => item.id !== nextRepository.id)]);
      setRepositoryId(nextRepository.id);
      setSelectedSymbol(null);
      setGraph(null);
      setSourceFile(null);
      setAnalysis(null);
      setActiveView("graph");
      setNotice(`${nextRepository.displayName}을(를) 등록했습니다. 분석을 실행하세요.`);
    } catch (error) {
      setNotice(`저장소를 등록하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    if (!repositoryId) {
      return;
    }
    setBusy(true);
    try {
      const summary = await api.analyzeRepository(repositoryId);
      setAnalysis(summary);
      const nextSymbols = await loadSymbols(repositoryId, query);
      await loadOrphanNotes(repositoryId);
      setNotice(
        `${summary.sourceFileCount}개 파일에서 ${summary.symbolCount}개 함수를 분석했습니다.${
          summary.diagnosticCount > 0 ? ` 확인할 진단 ${summary.diagnosticCount}건이 있습니다.` : ""
        }`,
      );
      if (nextSymbols.length === 1) {
        await selectSymbol(nextSymbols[0].id);
      }
    } catch (error) {
      setNotice(`분석을 완료하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!repositoryId || !selectedSymbol) {
      return;
    }
    setBusy(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const note = await api.saveNote(repositoryId, selectedSymbol.id, noteBody, tags);
      setTagsInput(note.tags.join(", "));
      setNotice(`노트를 저장했습니다. 마지막 수정 ${new Date(note.updatedAt).toLocaleString("ko-KR")}`);
    } catch (error) {
      setNotice(`노트를 저장하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sourceLines = sourceFile?.source.split("\n") ?? [];
  const unresolvedEdges = graph?.edges.filter((edge) => !edge.target) ?? [];

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL-FIRST CODE NOTEBOOK</p>
          <h1>코드 그래프 노트</h1>
        </div>
        <div className="topbar-actions">
          <span className="local-pill">외부 전송 없음</span>
          <button className="secondary-button" onClick={() => void chooseRepository()} disabled={busy}>
            저장소 열기
          </button>
        </div>
      </header>

      <section className="notice" role="status">
        {notice}
      </section>

      <div className="workspace-grid">
        <aside className="sidebar">
          <label className="field-label" htmlFor="repository-select">저장소</label>
          <select
            id="repository-select"
            value={repositoryId ?? ""}
            onChange={(event) => {
              setRepositoryId(event.target.value || null);
              setSelectedSymbol(null);
              setGraph(null);
              setSourceFile(null);
              setActiveView("graph");
            }}
          >
            <option value="">저장소를 선택하세요</option>
            {repositories.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>

          {repository && (
            <div className="repository-meta">
              <strong>{repository.displayName}</strong>
              <span>{repository.branch} · {repository.head}</span>
              <span>{repository.isDirty ? "변경 사항 있음" : "작업 트리 깨끗함"}</span>
            </div>
          )}
          <button className="primary-button" onClick={() => void runAnalysis()} disabled={!repositoryId || busy}>
            {busy ? "처리 중…" : "Java·Python 분석"}
          </button>
          {analysis && <p className="analysis-summary">{analysis.edgeCount}개 호출 관계 · {analysis.status}</p>}

          <label className="field-label" htmlFor="symbol-search">함수 찾기</label>
          <input
            id="symbol-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="함수명, 클래스, 파일명"
            disabled={!repositoryId}
          />
          <div className="symbol-list" aria-label="함수 검색 결과">
            {symbols.map((symbol) => (
              <button
                className={`symbol-row ${selectedSymbol?.id === symbol.id ? "active" : ""}`}
                key={symbol.id}
                onClick={() => void selectSymbol(symbol.id)}
              >
                <span className={`language-dot ${symbol.language}`} />
                <span>
                  <strong>{symbol.fqn}</strong>
                  <small>{symbol.relativePath}:{symbol.startLine}</small>
                </span>
              </button>
            ))}
            {repositoryId && symbols.length === 0 && <p className="muted">분석 후 함수를 검색할 수 있습니다.</p>}
          </div>
          {orphanNotes.length > 0 && (
            <details className="orphan-notes">
              <summary>연결 필요 노트 {orphanNotes.length}개</summary>
              <p>삭제하지 않았습니다. 함수가 이름 변경·삭제되어 다시 연결할 수 없는 노트입니다.</p>
              <ul>
                {orphanNotes.map((note) => (
                  <li key={`${note.symbolFqn}-${note.updatedAt}`}>
                    <code>{note.symbolFqn}{note.symbolSignature}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        {activeView === "graph" ? (
          <section className="graph-panel" aria-label="호출 관계">
            <div className="panel-heading">
              <div className="panel-title">
                <p className="eyebrow">CALL GRAPH</p>
                <h2 title={selectedSymbol?.fqn}>{selectedSymbol?.fqn ?? "함수를 선택하세요"}</h2>
              </div>
              <div className="graph-actions">
                <label className="depth-control">
                  펼칠 깊이
                  <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} disabled={!selectedSymbol}>
                    <option value={1}>1단계</option>
                    <option value={2}>2단계</option>
                    <option value={3}>3단계</option>
                  </select>
                </label>
                <button
                  className="secondary-button small"
                  onClick={() => setActiveView("detail")}
                  disabled={!selectedSymbol || !sourceFile}
                >
                  소스·노트 열기
                </button>
              </div>
            </div>
            <p className="graph-guide">노드를 선택해 그래프의 중심을 바꾸고, 소스·노트 열기에서 함수 상세를 확인하세요.</p>
            <CallGraph graph={graph} selectedSymbolId={selectedSymbol?.id ?? null} onSelectSymbol={(id) => void selectSymbol(id)} />
            {unresolvedEdges.length > 0 && (
              <div className="uncertain-calls">
                <strong>확정할 수 없는 호출</strong>
                <ul>
                  {unresolvedEdges.map((edge) => (
                    <li key={edge.id}>
                      <code>{edge.unresolvedName}</code> · {edge.confidence === "ambiguous" ? "후보가 여러 개" : "대상을 찾지 못함"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : (
          <section className="detail-view" aria-label="함수 상세">
            <header className="detail-view-header">
              <button className="secondary-button small" onClick={() => setActiveView("graph")}>← 그래프로 돌아가기</button>
              <div className="detail-title">
                <p className="eyebrow">FUNCTION DETAIL</p>
                <h2 title={selectedSymbol?.fqn}>{selectedSymbol?.fqn ?? "함수 상세"}</h2>
              </div>
            </header>
            <div className="detail-workspace">
              <section className="source-workspace">
                <div className="source-heading">
                  <div>
                    <p className="eyebrow">SOURCE</p>
                    <h3>{sourceFile?.relativePath ?? "소스 미리보기"}</h3>
                  </div>
                  {sourceFile && <span>{sourceFile.startLine}–{sourceFile.endLine}행</span>}
                </div>
                {sourceFile ? (
                  <pre className="code-preview full-source">
                    {sourceLines.map((line, index) => {
                      const lineNumber = index + 1;
                      const isSelected = lineNumber >= sourceFile.startLine && lineNumber <= sourceFile.endLine;
                      return (
                        <code
                          ref={lineNumber === sourceFile.startLine ? selectedCodeLine : null}
                          className={isSelected ? "code-line selected" : "code-line"}
                          key={`${lineNumber}-${line}`}
                        >
                          <span>{String(lineNumber).padStart(4, " ")}</span>{line || " "}
                        </code>
                      );
                    })}
                  </pre>
                ) : <p className="muted">그래프에서 함수를 선택한 뒤 상세 화면을 여세요.</p>}
              </section>
              <MarkdownEditor
                value={noteBody}
                tags={tagsInput}
                disabled={!selectedSymbol}
                isSaving={busy}
                onChange={setNoteBody}
                onTagsChange={setTagsInput}
                onSave={() => void saveNote()}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
