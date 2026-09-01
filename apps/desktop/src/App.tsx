import { open } from "@tauri-apps/plugin-dialog";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { api } from "./api";
import { CallGraph } from "./components/CallGraph";
import type { GraphViewport } from "./components/CallGraph";
import { AnalysisHelp } from "./components/AnalysisHelp";
import { GroupedSymbolList } from "./components/GroupedSymbolList";
import { buildConfluenceExport } from "./components/confluenceExport";
import { MarkdownEditor, type MarkdownEditorHandle } from "./components/MarkdownEditor";
import { SelectedSymbolHeading } from "./components/SelectedSymbolHeading";
import { UpdateControl } from "./components/UpdateControl";
import { resolveSourceScrollTop } from "./components/sourceScroll";
import { isLineReferenceGesture, lineReferenceModifierForUserAgent } from "./components/sourceLineGesture";
import { detectSourceLanguage, tokenizeSource } from "./components/syntaxHighlight";
import {
  parseWorkspaceState,
  selectWorkspace,
  serializeWorkspaceState,
  workspaceDatabaseFormatVersion,
  workspaceSnapshotSchemaVersion,
} from "./workspaceContext";
import { defaultWorkspace, workspaces, type Workspace } from "./workspaces";
import type {
  AnalysisSummary,
  GraphData,
  NoteRecord,
  OrphanNote,
  RepositoryRecord,
  SourceFile,
  SymbolRecord,
} from "./types";

interface LineRange {
  start: number;
  end: number;
}

interface NoteDraft extends NoteRecord {
  tagsInput: string;
  isDirty: boolean;
}

function App() {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<SymbolRecord[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolRecord | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const [notes, setNotes] = useState<NoteDraft[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [depth, setDepth] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [orphanNotes, setOrphanNotes] = useState<OrphanNote[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(defaultWorkspace);
  const [restoredRepositoryId, setRestoredRepositoryId] = useState<string | null>(null);
  const [workspaceWritable, setWorkspaceWritable] = useState(false);
  const [lineReferenceRange, setLineReferenceRange] = useState<LineRange | null>(null);
  const [graphViewport, setGraphViewport] = useState<GraphViewport | null>(null);
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const [markdownSelection, setMarkdownSelection] = useState<{ start: number; end: number } | null>(null);
  const [markdownScrollTop, setMarkdownScrollTop] = useState(0);
  const [pendingLineReference, setPendingLineReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("로컬 Git 저장소를 열어 분석을 시작하세요.");
  const selectedCodeLine = useRef<HTMLElement | null>(null);
  const sourcePreview = useRef<HTMLPreElement | null>(null);
  const shouldCenterSource = useRef(true);
  const markdownEditor = useRef<MarkdownEditorHandle>(null);
  const sourceDragStart = useRef<number | null>(null);
  const sourceDragEnd = useRef<number | null>(null);
  const symbolRequestSequence = useRef(0);

  const repository = useMemo(
    () => repositories.find((item) => item.id === repositoryId) ?? null,
    [repositories, repositoryId],
  );
  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const updateSelectedNote = (update: (note: NoteDraft) => NoteDraft) => {
    if (selectedNoteId === null) {
      return;
    }
    setNotes((items) => items.map((note) => note.id === selectedNoteId
      ? { ...update(note), isDirty: true }
      : note));
  };

  const persistDirtyNotes = useCallback(async (
    targetRepositoryId: string,
    targetSymbolId: string,
    drafts: NoteDraft[],
  ) => {
    for (const draft of drafts.filter((note) => note.isDirty)) {
      const tags = draft.tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await api.updateNote(
        targetRepositoryId,
        targetSymbolId,
        draft.id,
        draft.title,
        draft.bodyMarkdown,
        tags,
      );
    }
  }, []);

  const loadSymbols = useCallback(async (targetRepositoryId: string, targetQuery: string) => {
    const nextSymbols = await api.searchSymbols(targetRepositoryId, targetQuery);
    setSymbols(nextSymbols);
    return nextSymbols;
  }, []);

  const loadOrphanNotes = useCallback(async (targetRepositoryId: string) => {
    const items = await api.listOrphanNotes(targetRepositoryId);
    setOrphanNotes(items);
  }, []);

  const persistWorkspace = useCallback(async (targetRepositoryId: string) => {
    await api.saveWorkspaceSnapshot({
      schemaVersion: workspaceSnapshotSchemaVersion,
      appVersion: "0.1.0",
      databaseFormatVersion: workspaceDatabaseFormatVersion,
      repositoryId: targetRepositoryId,
      stateJson: serializeWorkspaceState({
        version: 1,
        activeWorkspace,
        query,
        depth,
        selectedSymbol,
        selectedNoteId,
        noteDrafts: notes,
        lineReferenceRange,
        graphViewport,
        sourceScrollTop,
        markdownSelection,
        markdownScrollTop,
      }),
    });
  }, [activeWorkspace, depth, graphViewport, lineReferenceRange, markdownScrollTop,
    markdownSelection, notes, query, selectedNoteId, selectedSymbol, sourceScrollTop]);

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
    const targetRepository = repositories.find((item) => item.id === repositoryId);
    if (!repositoryId || !targetRepository) {
      setRestoredRepositoryId(null);
      return;
    }
    let cancelled = false;
    setRestoredRepositoryId(null);
    setWorkspaceWritable(false);
    void (async () => {
      try {
        const snapshot = await api.currentWorkspaceSnapshot(repositoryId);
        if (!snapshot || cancelled) {
          if (!cancelled) {
            setWorkspaceWritable(true);
            setRestoredRepositoryId(repositoryId);
          }
          return;
        }
        const restored = parseWorkspaceState(snapshot.stateJson);
        if (!restored) {
          setNotice("저장된 작업공간 상태가 호환되지 않아 새 화면으로 시작합니다. 분석 문서는 보존됩니다.");
          setRestoredRepositoryId(repositoryId);
          return;
        }
        setActiveWorkspace(restored.activeWorkspace);
        setQuery(restored.query);
        setDepth(restored.depth);
        setLineReferenceRange(restored.lineReferenceRange);
        setGraphViewport(restored.graphViewport);
        shouldCenterSource.current = false;
        setSourceScrollTop(restored.sourceScrollTop);
        setMarkdownSelection(restored.markdownSelection);
        setMarkdownScrollTop(restored.markdownScrollTop);
        if (!restored.selectedSymbol) {
          setWorkspaceWritable(true);
          setRestoredRepositoryId(repositoryId);
          return;
        }
        const validation = await api.validateRestorationReferences({
          repositoryId,
          rootPath: targetRepository.rootPath,
          branch: targetRepository.branch,
          head: targetRepository.head,
          selectedSymbol: restored.selectedSymbol,
        });
        if (cancelled) return;
        if (validation.symbolStatus !== "valid") {
          setNotice(`${restored.selectedSymbol.fqn} 참조는 재확인이 필요합니다. 저장된 문맥은 유지했습니다.`);
          setRestoredRepositoryId(repositoryId);
          return;
        }
        const availableSymbols = await api.searchSymbols(repositoryId, restored.query);
        const symbol = availableSymbols.find((item) => item.id === restored.selectedSymbol?.id)
          ?? availableSymbols.find((item) => item.fqn === restored.selectedSymbol?.fqn
            && item.signature === restored.selectedSymbol?.signature);
        if (!symbol || cancelled) {
          setNotice(`${restored.selectedSymbol.fqn} 참조는 재확인이 필요합니다. 저장된 문맥은 유지했습니다.`);
          setRestoredRepositoryId(repositoryId);
          return;
        }
        const [nextGraph, nextSource, savedNotes] = await Promise.all([
          api.getGraph(repositoryId, symbol.id, restored.depth),
          api.readSource(repositoryId, symbol.id),
          api.listNotes(repositoryId, symbol.id),
        ]);
        if (cancelled) return;
        const draftsById = new Map(restored.noteDrafts.map((draft) => [draft.id, draft]));
        const restoredDrafts = savedNotes.map((note) => {
          const draft = draftsById.get(note.id);
          return draft && draft.symbolId === symbol.id ? draft : toNoteDraft(note);
        });
        setSymbols(availableSymbols);
        setSelectedSymbol(symbol);
        setGraph(nextGraph);
        setSourceFile(nextSource);
        setNotes(restoredDrafts);
        setSelectedNoteId(restoredDrafts.some((note) => note.id === restored.selectedNoteId)
          ? restored.selectedNoteId : restoredDrafts[0]?.id ?? null);
        setNotice(`${symbol.fqn}의 마지막 분석 문맥을 복원했습니다.`);
        setWorkspaceWritable(true);
        setRestoredRepositoryId(repositoryId);
      } catch (error) {
        if (!cancelled) {
          setNotice(`작업공간을 복원하지 못해 새 화면으로 시작합니다: ${String(error)}`);
          setRestoredRepositoryId(repositoryId);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [repositories, repositoryId]);

  useEffect(() => {
    if (!repositoryId || restoredRepositoryId !== repositoryId || !workspaceWritable) return;
    const timeout = window.setTimeout(() => {
      void persistWorkspace(repositoryId).catch((error: unknown) =>
        setNotice(`작업공간 자동 저장에 실패했습니다. 다시 시도할 수 있습니다: ${String(error)}`),
      );
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [persistWorkspace, repositoryId, restoredRepositoryId, workspaceWritable]);

  useEffect(() => {
    if (!repositoryId || restoredRepositoryId !== repositoryId) {
      setSymbols([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void loadSymbols(repositoryId, query).catch((error: unknown) =>
        setNotice(`함수 검색을 완료하지 못했습니다: ${String(error)}`),
      );
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [repositoryId, query, loadSymbols, restoredRepositoryId]);

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
      if (!repositoryId || busy) {
        return;
      }
      const requestSequence = ++symbolRequestSequence.current;
      const symbol = symbols.find((item) => item.id === symbolId) ?? graph?.nodes.find((item) => item.id === symbolId);
      if (!symbol) {
        return;
      }
      setBusy(true);
      try {
        if (selectedSymbol) {
          await persistDirtyNotes(repositoryId, selectedSymbol.id, notes);
        }
        const [nextGraph, nextSource, nextNotes] = await Promise.all([
          api.getGraph(repositoryId, symbolId, depth),
          api.readSource(repositoryId, symbolId),
          api.listNotes(repositoryId, symbolId),
        ]);
        if (requestSequence !== symbolRequestSequence.current) {
          return;
        }
        setSelectedSymbol(symbol);
        setGraph(nextGraph);
        setSourceFile(nextSource);
        shouldCenterSource.current = true;
        setSourceScrollTop(0);
        const nextDrafts = nextNotes.map(toNoteDraft);
        setNotes(nextDrafts);
        setSelectedNoteId(nextDrafts[0]?.id ?? null);
        setLineReferenceRange(null);
        setWorkspaceWritable(true);
        setNotice(`${symbol.fqn}을(를) 열었습니다.`);
      } catch (error) {
        if (requestSequence === symbolRequestSequence.current) {
          setNotice(`함수를 열지 못했습니다: ${String(error)}`);
        }
      } finally {
        if (requestSequence === symbolRequestSequence.current) {
          setBusy(false);
        }
      }
    },
    [busy, depth, graph?.nodes, notes, persistDirtyNotes, repositoryId, selectedSymbol, symbols],
  );

  useEffect(() => {
    if (repositoryId && selectedSymbol) {
      const requestSequence = ++symbolRequestSequence.current;
      void api
        .getGraph(repositoryId, selectedSymbol.id, depth)
        .then((nextGraph) => {
          if (requestSequence === symbolRequestSequence.current) {
            setGraph(nextGraph);
          }
        })
        .catch((error: unknown) => {
          if (requestSequence === symbolRequestSequence.current) {
            setNotice(`호출 그래프를 갱신하지 못했습니다: ${String(error)}`);
          }
        });
    }
  }, [depth]); // depth changes intentionally reload the selected graph

  useEffect(() => {
    if (activeWorkspace === "record" && sourceFile) {
      const frame = requestAnimationFrame(() => {
        const preview = sourcePreview.current;
        const selectedLine = selectedCodeLine.current;
        if (!preview || !selectedLine) return;
        const previewBox = preview.getBoundingClientRect();
        const selectedLineBox = selectedLine.getBoundingClientRect();
        const nextScrollTop = resolveSourceScrollTop({
          shouldCenter: shouldCenterSource.current,
          savedScrollTop: sourceScrollTop,
          selectedLineTop: selectedLineBox.top - previewBox.top + preview.scrollTop,
          selectedLineHeight: selectedLineBox.height,
          viewportHeight: preview.clientHeight,
          scrollHeight: preview.scrollHeight,
        });
        shouldCenterSource.current = false;
        preview.scrollTop = nextScrollTop;
        setSourceScrollTop(nextScrollTop);
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [activeWorkspace, sourceFile]);

  const rememberGraphViewport = useCallback((viewport: GraphViewport) => setGraphViewport(viewport), []);
  const rememberMarkdownState = useCallback((selection: { start: number; end: number }, scrollTop: number) => {
    setMarkdownSelection(selection);
    setMarkdownScrollTop(scrollTop);
  }, []);

  useEffect(() => {
    if (activeWorkspace === "record" && pendingLineReference && selectedNote && markdownEditor.current) {
      markdownEditor.current.insertAtCursor(pendingLineReference);
      setPendingLineReference(null);
    }
  }, [activeWorkspace, pendingLineReference, selectedNote]);

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
      if (repositoryId && selectedSymbol) {
        await persistDirtyNotes(repositoryId, selectedSymbol.id, notes);
      }
      if (repositoryId && restoredRepositoryId === repositoryId) {
        await persistWorkspace(repositoryId);
      }
      symbolRequestSequence.current += 1;
      const nextRepository = await api.registerRepository(path);
      setRepositories((items) => [nextRepository, ...items.filter((item) => item.id !== nextRepository.id)]);
      setRepositoryId(nextRepository.id);
      setSelectedSymbol(null);
      setGraph(null);
      setSourceFile(null);
      setNotes([]);
      setSelectedNoteId(null);
      setAnalysis(null);
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
      if (selectedSymbol) {
        await persistDirtyNotes(repositoryId, selectedSymbol.id, notes);
        setNotes((items) => items.map((note) => ({ ...note, isDirty: false })));
      }
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

  const changeRepository = async (nextRepositoryId: string | null) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (repositoryId && selectedSymbol) {
        await persistDirtyNotes(repositoryId, selectedSymbol.id, notes);
      }
      if (repositoryId && restoredRepositoryId === repositoryId) {
        await persistWorkspace(repositoryId);
      }
      symbolRequestSequence.current += 1;
      setRepositoryId(nextRepositoryId);
      setRestoredRepositoryId(null);
      setWorkspaceWritable(false);
      setSelectedSymbol(null);
      setGraph(null);
      setSourceFile(null);
      setNotes([]);
      setSelectedNoteId(null);
    } catch (error) {
      setNotice(`저장소를 바꾸기 전에 분석 문서를 저장하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!repositoryId || !selectedSymbol || !selectedNote) {
      return;
    }
    setBusy(true);
    try {
      const tags = selectedNote.tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const note = await api.updateNote(
        repositoryId,
        selectedSymbol.id,
        selectedNote.id,
        selectedNote.title,
        selectedNote.bodyMarkdown,
        tags,
      );
      setNotes((items) => items.map((item) => item.id === note.id ? toNoteDraft(note) : item));
      setNotice(`분석 문서를 저장했습니다. 마지막 수정 ${new Date(note.updatedAt).toLocaleString("ko-KR")}`);
    } catch (error) {
      setNotice(`분석 문서를 저장하지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const copyNoteForConfluence = async () => {
    if (!selectedNote || !selectedSymbol || !sourceFile) return;
    const tags = selectedNote.tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const exported = buildConfluenceExport({
      title: selectedNote.title,
      markdown: selectedNote.bodyMarkdown,
      tags,
      symbolFqn: selectedSymbol.fqn,
      signature: selectedSymbol.signature,
      relativePath: sourceFile.relativePath,
      source: sourceFile.source,
      language: selectedSymbol.language,
    });
    try {
      await writeHtml(exported.html, exported.text);
      const unresolved = exported.unresolvedReferenceCount > 0
        ? ` 찾지 못한 참조 ${exported.unresolvedReferenceCount}개가 있습니다.`
        : "";
      setNotice(`Confluence용 문서를 복사했습니다. 코드 블록 ${exported.resolvedReferenceCount}개.${unresolved}`);
    } catch (htmlError) {
      try {
        await writeText(exported.text);
        setNotice("HTML 복사를 지원하지 않아 일반 텍스트 형식으로 복사했습니다.");
      } catch (textError) {
        setNotice(`Confluence용 문서를 복사하지 못했습니다: ${String(textError || htmlError)}`);
      }
    }
  };

  const createNote = async () => {
    if (!repositoryId || !selectedSymbol) {
      return;
    }
    setBusy(true);
    try {
      const title = nextNoteTitle(notes);
      const note = await api.createNote(repositoryId, selectedSymbol.id, title);
      setNotes((items) => [toNoteDraft(note), ...items]);
      setSelectedNoteId(note.id);
      setNotice(`${note.title} 문서를 만들었습니다.`);
    } catch (error) {
      setNotice(`분석 문서를 만들지 못했습니다: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const syntaxLines = useMemo(
    () => sourceFile ? tokenizeSource(sourceFile.source, detectSourceLanguage(sourceFile.relativePath)) : [],
    [sourceFile],
  );
  const unresolvedEdges = graph?.edges.filter((edge) => !edge.target) ?? [];
  const lineReferenceModifier = useMemo(
    () => lineReferenceModifierForUserAgent(window.navigator.userAgent),
    [],
  );

  const lineNumberFromElement = (element: Element | null): number | null => {
    const codeLine = element?.closest<HTMLElement>("code[data-line-number]");
    const lineNumber = Number(codeLine?.dataset.lineNumber);
    return Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : null;
  };

  const lineNumberAtPointer = (event: PointerEvent<HTMLPreElement>): number | null => {
    const elementAtPointer = document.elementFromPoint(event.clientX, event.clientY);
    if (elementAtPointer) {
      return lineNumberFromElement(elementAtPointer);
    }
    return lineNumberFromElement(event.target instanceof Element ? event.target : null);
  };

  const normalizedLineRange = (start: number, end: number): LineRange => ({
    start: Math.min(start, end),
    end: Math.max(start, end),
  });

  const navigateToLineReference = (start: number, end: number) => {
    const range = normalizedLineRange(start, end);
    setLineReferenceRange(range);
    requestAnimationFrame(() => {
      const preview = sourcePreview.current;
      const targetLine = preview?.querySelector<HTMLElement>(`code[data-line-number="${range.start}"]`);
      if (!preview || !targetLine) {
        setNotice(`[line:${range.start}] 위치를 현재 소스에서 찾지 못했습니다.`);
        return;
      }
      const previewBox = preview.getBoundingClientRect();
      const targetBox = targetLine.getBoundingClientRect();
      const nextScrollTop = resolveSourceScrollTop({
        shouldCenter: true,
        savedScrollTop: preview.scrollTop,
        selectedLineTop: targetBox.top - previewBox.top + preview.scrollTop,
        selectedLineHeight: targetBox.height,
        viewportHeight: preview.clientHeight,
        scrollHeight: preview.scrollHeight,
      });
      shouldCenterSource.current = false;
      preview.scrollTop = nextScrollTop;
      setSourceScrollTop(nextScrollTop);
      const reference = range.start === range.end
        ? `[line:${range.start}]`
        : `[line:${range.start}-${range.end}]`;
      setNotice(`${reference} 소스 위치로 이동했습니다.`);
    });
  };

  const startSourceLineSelection = (event: PointerEvent<HTMLPreElement>) => {
    if (!isLineReferenceGesture(event)) {
      return;
    }
    const lineNumber = lineNumberAtPointer(event);
    if (!lineNumber) {
      return;
    }
    event.preventDefault();
    sourceDragStart.current = lineNumber;
    sourceDragEnd.current = lineNumber;
    setLineReferenceRange({ start: lineNumber, end: lineNumber });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateSourceLineSelection = (event: PointerEvent<HTMLPreElement>) => {
    const start = sourceDragStart.current;
    if (!start) {
      return;
    }
    event.preventDefault();
    const lineNumber = lineNumberAtPointer(event);
    if (!lineNumber) {
      return;
    }
    sourceDragEnd.current = lineNumber;
    setLineReferenceRange(normalizedLineRange(start, lineNumber));
  };

  const finishSourceLineSelection = (event: PointerEvent<HTMLPreElement>) => {
    const start = sourceDragStart.current;
    if (!start) {
      return;
    }
    event.preventDefault();
    const end = lineNumberAtPointer(event) ?? sourceDragEnd.current;
    sourceDragStart.current = null;
    sourceDragEnd.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!start || !end) {
      return;
    }
    const range = normalizedLineRange(start, end);
    setLineReferenceRange(range);
    const lineReference = range.start === range.end
      ? `[line:${range.start}]`
      : `[line:${range.start}-${range.end}]`;
    if (!selectedNote) {
      setNotice("먼저 새 분석 문서를 만든 뒤 줄 참조를 추가하세요.");
      return;
    }
    if (busy) {
      setNotice("현재 작업이 끝난 뒤 줄 참조를 추가하세요.");
      return;
    }
    setPendingLineReference(lineReference);
    setActiveWorkspace((current) => selectWorkspace(current, "record"));
    setNotice(`${lineReference} 참조를 분석 문서에 추가할 준비를 마쳤습니다.`);
  };

  const cancelSourceLineSelection = () => {
    sourceDragStart.current = null;
    sourceDragEnd.current = null;
  };

  const suppressModifiedClickMenu = (event: MouseEvent<HTMLPreElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  };

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <h1>코드 그래프 노트</h1>
        </div>
        <div className="topbar-actions">
          <UpdateControl />
          <button className="secondary-button" onClick={() => void chooseRepository()} disabled={busy}>
            저장소 열기
          </button>
        </div>
      </header>

      <nav className="workspace-nav" aria-label="분석 작업공간">
        {workspaces.map(({ id: workspace, label, description }) => (
          <button
            aria-current={activeWorkspace === workspace ? "page" : undefined}
            className={activeWorkspace === workspace ? "active" : ""}
            key={workspace}
            onClick={() => setActiveWorkspace((current) => selectWorkspace(current, workspace))}
            title={description}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="notice" role="status">
        {notice}
      </section>

      <div className={`workspace-grid workspace-${activeWorkspace}`}>
        {activeWorkspace === "explore" && <section className="sidebar explore-sidebar" aria-label="함수 찾기">
          <label className="field-label" htmlFor="repository-select">저장소</label>
          <select
            id="repository-select"
            value={repositoryId ?? ""}
            onChange={(event) => void changeRepository(event.target.value || null)}
            disabled={busy}
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
          <div className="analysis-action">
            <button className="primary-button" onClick={() => void runAnalysis()} disabled={!repositoryId || busy}>
              {busy ? "처리 중…" : "코드 분석"}
            </button>
            <AnalysisHelp />
          </div>
          {analysis && <p className="analysis-summary">{analysis.edgeCount}개 호출 관계 · {analysis.status}</p>}

          <label className="field-label" htmlFor="symbol-search">함수 찾기</label>
          <input
            id="symbol-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="함수명, 클래스, 파일명"
            disabled={!repositoryId}
          />
          <GroupedSymbolList
            symbols={symbols}
            query={query}
            selectedSymbolId={selectedSymbol?.id ?? null}
            disabled={busy}
            showEmptyMessage={Boolean(repositoryId)}
            onSelect={(symbolId) => void selectSymbol(symbolId)}
          />
          {orphanNotes.length > 0 && (
            <details className="orphan-notes">
              <summary>연결 필요 노트 {orphanNotes.length}개</summary>
              <p>삭제하지 않았습니다. 함수가 이름 변경·삭제되어 다시 연결할 수 없는 노트입니다.</p>
              <ul>
                {orphanNotes.map((note) => (
                  <li key={note.id}>
                    <strong>{note.title}</strong> · <code>{note.symbolFqn}{note.symbolSignature}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>}

        {activeWorkspace === "explore" && (
          <section className="graph-panel" aria-label="호출 관계">
            <div className="panel-heading">
              <div className="panel-title">
                <SelectedSymbolHeading symbol={selectedSymbol} />
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
              </div>
            </div>
            <p className="graph-guide">노드를 선택한 뒤 옆에 나타나는 버튼으로 소스와 분석 문서를 여세요.</p>
            <CallGraph
              graph={graph}
              selectedSymbolId={selectedSymbol?.id ?? null}
              onSelectSymbol={(id) => void selectSymbol(id)}
              viewport={graphViewport}
              onViewportChange={rememberGraphViewport}
              canOpenDetail={Boolean(selectedSymbol && sourceFile) && !busy}
              isSelectionLoading={busy}
              onOpenDetail={() => setActiveWorkspace((current) => selectWorkspace(current, "record"))}
            />
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
        )}

        {activeWorkspace === "record" && (
          <section className="record-workspace" aria-label="분석 기록">
            <header className="record-workspace-header">
              <div>
                <h2 title={selectedSymbol?.fqn}>{selectedSymbol?.fqn ?? "함수를 선택하세요"}</h2>
              </div>
              {!selectedSymbol && <p className="muted">Explore에서 함수를 선택하면 새 분석 문서를 만들 수 있습니다.</p>}
            </header>
            <div className="detail-workspace record-detail-workspace">
              <section className="source-workspace" aria-label="선택한 함수 소스">
                <div className="source-heading">
                  <div>
                    <h3>{sourceFile?.relativePath ?? "소스 미리보기"}</h3>
                  </div>
                  {sourceFile && <span>{sourceFile.startLine}–{sourceFile.endLine}행</span>}
                </div>
                <p className="source-selection-guide">일반 드래그로 코드를 선택·복사합니다. <kbd>{lineReferenceModifier.label}</kbd>+클릭은 <code>[line:31]</code>, <kbd>{lineReferenceModifier.label}</kbd>+드래그는 <code>[line:31-35]</code> 참조를 노트에 넣습니다.</p>
                {sourceFile ? (
                  <pre
                    ref={sourcePreview}
                    className="code-preview full-source selectable-source"
                    aria-label={`소스 코드. 일반 드래그로 복사할 코드를 선택하고, ${lineReferenceModifier.name}을 누른 채 클릭하거나 드래그해 노트에 줄 참조를 추가할 수 있습니다.`}
                    onPointerDown={startSourceLineSelection}
                    onPointerMove={updateSourceLineSelection}
                    onPointerUp={finishSourceLineSelection}
                    onPointerCancel={cancelSourceLineSelection}
                    onContextMenu={suppressModifiedClickMenu}
                    onScroll={(event) => {
                      shouldCenterSource.current = false;
                      setSourceScrollTop(event.currentTarget.scrollTop);
                    }}
                  >
                    {syntaxLines.map((tokens, index) => {
                      const lineNumber = index + 1;
                      const isSelected = lineNumber >= sourceFile.startLine && lineNumber <= sourceFile.endLine;
                      const isLineReference = lineReferenceRange
                        && lineNumber >= lineReferenceRange.start
                        && lineNumber <= lineReferenceRange.end;
                      return (
                        <code
                          ref={lineNumber === sourceFile.startLine ? selectedCodeLine : null}
                          className={`code-line${isSelected ? " selected" : ""}${isLineReference ? " line-reference" : ""}`}
                          data-line-number={lineNumber}
                          key={lineNumber}
                        >
                          <span className="line-number">{String(lineNumber).padStart(4, " ")}</span>
                          {tokens.length > 0 ? tokens.map((token, tokenIndex) => (
                            <span className={`syntax-token token-${token.kind}`} key={`${tokenIndex}-${token.text}`}>
                              {token.text}
                            </span>
                          )) : " "}
                        </code>
                      );
                    })}
                  </pre>
                ) : <p className="muted">Explore에서 함수를 선택하면 여기에 소스가 표시됩니다.</p>}
              </section>
              <MarkdownEditor
                key={selectedNote?.id ?? `no-note-${selectedSymbol?.id ?? "no-symbol"}`}
                ref={markdownEditor}
                documents={notes.map((note) => ({ id: note.id, title: note.title }))}
                selectedDocumentId={selectedNoteId}
                title={selectedNote?.title ?? ""}
                value={selectedNote?.bodyMarkdown ?? ""}
                tags={selectedNote?.tagsInput ?? ""}
                disabled={!selectedNote}
                canCreate={Boolean(selectedSymbol)}
                isSaving={busy}
                onSelectDocument={setSelectedNoteId}
                onCreateDocument={() => void createNote()}
                onTitleChange={(title) => updateSelectedNote((note) => ({ ...note, title }))}
                onChange={(bodyMarkdown) => updateSelectedNote((note) => ({ ...note, bodyMarkdown }))}
                onTagsChange={(tagsInput) => updateSelectedNote((note) => ({ ...note, tagsInput }))}
                onSave={() => void saveNote()}
                onCopyForConfluence={() => void copyNoteForConfluence()}
                onLineReferenceClick={navigateToLineReference}
                initialSelection={markdownSelection}
                initialScrollTop={markdownScrollTop}
                onEditorStateChange={rememberMarkdownState}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function toNoteDraft(note: NoteRecord): NoteDraft {
  return { ...note, tagsInput: note.tags.join(", "), isDirty: false };
}

function nextNoteTitle(notes: NoteRecord[]): string {
  let sequence = notes.length + 1;
  while (notes.some((note) => note.title === `분석 ${sequence}`)) {
    sequence += 1;
  }
  return `분석 ${sequence}`;
}

export default App;
