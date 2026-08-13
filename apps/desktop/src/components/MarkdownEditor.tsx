import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { findMarkdownBlock, parseMarkdownBlocks, replaceMarkdownRange } from "./markdownBlocks";

interface DocumentOption {
  id: number;
  title: string;
}

interface MarkdownEditorProps {
  documents: DocumentOption[];
  selectedDocumentId: number | null;
  title: string;
  value: string;
  tags: string;
  disabled: boolean;
  canCreate: boolean;
  isSaving: boolean;
  onSelectDocument: (documentId: number) => void;
  onCreateDocument: () => void;
  onTitleChange: (title: string) => void;
  onChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onSave: () => void;
  initialSelection: { start: number; end: number } | null;
  initialScrollTop: number;
  onEditorStateChange: (selection: { start: number; end: number }, scrollTop: number) => void;
}

type EditorMode = "live" | "preview";

export interface MarkdownEditorHandle {
  insertAtCursor: (text: string) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  documents,
  selectedDocumentId,
  title,
  value,
  tags,
  disabled,
  canCreate,
  isSaving,
  onSelectDocument,
  onCreateDocument,
  onTitleChange,
  onChange,
  onTagsChange,
  onSave,
  initialSelection,
  initialScrollTop,
  onEditorStateChange,
}, ref) {
  const [mode, setMode] = useState<EditorMode>("live");
  const [activeOffset, setActiveOffset] = useState(initialSelection?.start ?? value.length);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const liveSurface = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const selection = useRef(initialSelection ?? { start: value.length, end: value.length });
  valueRef.current = value;
  const blocks = useMemo(() => parseMarkdownBlocks(value), [value]);
  const activeBlock = findMarkdownBlock(blocks, activeOffset);
  const activeBlockStart = useRef(activeBlock.start);
  activeBlockStart.current = activeBlock.start;
  const editingDisabled = disabled || isSaving;

  useEffect(() => {
    if (liveSurface.current) liveSurface.current.scrollTop = initialScrollTop;
  }, [initialScrollTop, selectedDocumentId]);

  const updateValue = (nextValue: string) => {
    valueRef.current = nextValue;
    onChange(nextValue);
  };

  const rememberSelection = () => {
    const element = textarea.current;
    if (element) {
      selection.current = {
        start: activeBlockStart.current + element.selectionStart,
        end: activeBlockStart.current + element.selectionEnd,
      };
      onEditorStateChange(selection.current, liveSurface.current?.scrollTop ?? initialScrollTop);
    }
  };

  const focusAt = (start: number, end = start) => {
    setMode("live");
    setActiveOffset(start);
    requestAnimationFrame(() => {
      const block = findMarkdownBlock(parseMarkdownBlocks(valueRef.current), start);
      const localStart = Math.max(0, Math.min(start - block.start, block.raw.length));
      const localEnd = Math.max(localStart, Math.min(end - block.start, block.raw.length));
      textarea.current?.focus();
      textarea.current?.setSelectionRange(localStart, localEnd);
      selection.current = { start, end };
    });
  };

  const wrapSelection = (prefix: string, suffix = prefix, placeholder = "텍스트") => {
    rememberSelection();
    const { start, end } = selection.current;
    const selected = valueRef.current.slice(start, end) || placeholder;
    const next = replaceMarkdownRange(valueRef.current, start, end, `${prefix}${selected}${suffix}`);
    updateValue(next);
    const selectionEnd = start + prefix.length + selected.length;
    focusAt(start + prefix.length, selectionEnd);
  };

  const prefixCurrentLine = (prefix: string) => {
    rememberSelection();
    const selectionStart = selection.current.start;
    const lineStart = valueRef.current.lastIndexOf("\n", selectionStart - 1) + 1;
    updateValue(replaceMarkdownRange(valueRef.current, lineStart, lineStart, prefix));
    focusAt(selectionStart + prefix.length);
  };

  const changeActiveBlock = (nextRaw: string, localStart: number, localEnd: number) => {
    const next = replaceMarkdownRange(valueRef.current, activeBlock.start, activeBlock.end, nextRaw);
    const globalStart = activeBlock.start + localStart;
    const globalEnd = activeBlock.start + localEnd;
    const nextBlock = findMarkdownBlock(parseMarkdownBlocks(next), globalStart);
    updateValue(next);
    selection.current = { start: globalStart, end: globalEnd };
    setActiveOffset(globalStart);
    if (nextBlock.start !== activeBlock.start) {
      focusAt(globalStart, globalEnd);
    }
  };

  const activateRenderedBlock = (start: number, contentLength: number) => {
    const cursor = start + contentLength;
    selection.current = { start: cursor, end: cursor };
    focusAt(cursor);
  };

  const activateBlockFromKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
    start: number,
    contentLength: number,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateRenderedBlock(start, contentLength);
    }
  };

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const { start, end } = selection.current;
      const next = replaceMarkdownRange(valueRef.current, start, end, text);
      updateValue(next);
      focusAt(start + text.length);
    },
  }));

  return (
    <section className="markdown-editor" aria-label="Markdown 노트 편집기">
      <div className="markdown-editor-header">
        <div>
          <p className="eyebrow">ANALYSIS DOCUMENTS</p>
          <h2>함수 분석 문서</h2>
        </div>
        <button className="primary-button small" onClick={onSave} disabled={disabled || isSaving}>
          {isSaving ? "저장 중…" : "저장"}
        </button>
      </div>

      <div className="document-switcher">
        <select
          aria-label="분석 문서 선택"
          value={selectedDocumentId ?? ""}
          onChange={(event) => onSelectDocument(Number(event.target.value))}
          disabled={documents.length === 0 || isSaving}
        >
          {documents.length === 0 && <option value="">분석 문서 없음</option>}
          {documents.map((document) => (
            <option value={document.id} key={document.id}>{document.title}</option>
          ))}
        </select>
        <button
          className="secondary-button small"
          type="button"
          onClick={onCreateDocument}
          disabled={!canCreate || isSaving}
        >
          + 새 문서
        </button>
      </div>

      <label className="field-label document-title-label" htmlFor="note-title">문서 제목</label>
      <input
        id="note-title"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="예: 회원가입 흐름, 토큰 재발급 흐름"
        disabled={editingDisabled}
      />

      <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 서식">
        <button type="button" onClick={() => prefixCurrentLine("## ")} disabled={editingDisabled}>제목</button>
        <button type="button" onClick={() => wrapSelection("**")} disabled={editingDisabled}><strong>굵게</strong></button>
        <button type="button" onClick={() => prefixCurrentLine("- ")} disabled={editingDisabled}>목록</button>
        <button type="button" onClick={() => wrapSelection("`", "`", "코드")} disabled={editingDisabled}>코드</button>
        <button type="button" onClick={() => wrapSelection("\n```\n", "\n```\n", "코드 블록")} disabled={editingDisabled}>블록</button>
      </div>

      <div className="markdown-mode-tabs" role="tablist" aria-label="노트 표시 방식">
        <button
          className={mode === "live" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "live"}
          onClick={() => setMode("live")}
        >
          라이브 편집
        </button>
        <button
          className={mode === "preview" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          onClick={() => setMode("preview")}
        >
          전체 미리보기
        </button>
      </div>

      {mode === "live" ? (
        disabled ? (
          <div className="markdown-live-surface empty">새 분석 문서를 만든 뒤 내용을 작성하세요.</div>
        ) : (
          <div
            ref={liveSurface}
            className="markdown-live-surface"
            aria-label="Markdown 라이브 편집기"
            onScroll={(event) => onEditorStateChange(selection.current, event.currentTarget.scrollTop)}
          >
            {blocks.map((block) => block.start === activeBlock.start ? (
              <textarea
                ref={textarea}
                className="markdown-live-input"
                value={block.raw}
                rows={Math.max(3, block.raw.split("\n").length + 1)}
                onChange={(event) => changeActiveBlock(
                  event.target.value,
                  event.target.selectionStart,
                  event.target.selectionEnd,
                )}
                onSelect={rememberSelection}
                onKeyUp={rememberSelection}
                onClick={rememberSelection}
                onBlur={rememberSelection}
                placeholder="## 이 함수의 역할"
                aria-label="현재 Markdown 블록 편집"
                readOnly={isSaving}
                key={`active-${block.start}`}
              />
            ) : (
              <div
                className="markdown-live-block"
                role="button"
                tabIndex={0}
                onClick={() => activateRenderedBlock(block.start, block.content.length)}
                onKeyDown={(event) => activateBlockFromKeyboard(event, block.start, block.content.length)}
                key={`rendered-${block.start}`}
              >
                <MarkdownPreview value={block.content} />
              </div>
            ))}
          </div>
        )
      ) : (
        <MarkdownPreview value={value} />
      )}

      <label className="field-label" htmlFor="note-tags">태그</label>
      <input
        id="note-tags"
        value={tags}
        onChange={(event) => onTagsChange(event.target.value)}
        placeholder="예: 핵심 흐름, 인증, 개선 필요"
        disabled={editingDisabled}
      />
    </section>
  );
});

function MarkdownPreview({ value }: { value: string }) {
  if (!value.trim()) {
    return <div className="markdown-preview empty">아직 작성한 설명이 없습니다.</div>;
  }

  const lines = value.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(<pre className="markdown-code" key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      blocks.push(level === 1
        ? <h3 key={`heading-${index}`}>{content}</h3>
        : level === 2
          ? <h4 key={`heading-${index}`}>{content}</h4>
          : <h5 key={`heading-${index}`}>{content}</h5>);
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(lines[index].slice(2));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>);
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(line.slice(2))}</blockquote>);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^- |^> |^```/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="markdown-preview">{blocks}</div>;
}

function renderInline(text: string): ReactNode[] {
  const fragments = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return fragments.filter(Boolean).map((fragment, index) => {
    if (fragment.startsWith("**") && fragment.endsWith("**")) {
      return <strong key={index}>{fragment.slice(2, -2)}</strong>;
    }
    if (fragment.startsWith("`") && fragment.endsWith("`")) {
      return <code key={index}>{fragment.slice(1, -1)}</code>;
    }
    return <span key={index}>{fragment}</span>;
  });
}
