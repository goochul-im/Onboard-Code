import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { findLineReferenceAt, parseLineReference } from "./lineReference";
import { replaceMarkdownRange } from "./markdownBlocks";

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
  onCopyForConfluence: () => void;
  onLineReferenceClick: (start: number, end: number) => void;
  initialSelection: { start: number; end: number } | null;
  initialScrollTop: number;
  onEditorStateChange: (selection: { start: number; end: number }, scrollTop: number) => void;
}

type EditorMode = "write" | "preview";

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
  onCopyForConfluence,
  onLineReferenceClick,
  initialSelection,
  initialScrollTop,
  onEditorStateChange,
}, ref) {
  const [mode, setMode] = useState<EditorMode>("write");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const selection = useRef(initialSelection ?? { start: value.length, end: value.length });
  valueRef.current = value;
  const editingDisabled = disabled || isSaving;

  useEffect(() => {
    if (mode !== "write") return;
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      const start = Math.min(initialSelection?.start ?? valueRef.current.length, valueRef.current.length);
      const end = Math.min(initialSelection?.end ?? start, valueRef.current.length);
      selection.current = { start, end };
      element.setSelectionRange(start, end);
      element.scrollTop = initialScrollTop;
    });
  }, [initialScrollTop, initialSelection, mode, selectedDocumentId]);

  const updateValue = (nextValue: string) => {
    valueRef.current = nextValue;
    onChange(nextValue);
  };

  const rememberSelection = () => {
    const element = textarea.current;
    if (element) {
      selection.current = {
        start: element.selectionStart,
        end: element.selectionEnd,
      };
      onEditorStateChange(selection.current, element.scrollTop);
    }
  };

  const focusAt = (start: number, end = start) => {
    setMode("write");
    requestAnimationFrame(() => {
      const safeStart = Math.max(0, Math.min(start, valueRef.current.length));
      const safeEnd = Math.max(safeStart, Math.min(end, valueRef.current.length));
      textarea.current?.focus();
      textarea.current?.setSelectionRange(safeStart, safeEnd);
      selection.current = { start: safeStart, end: safeEnd };
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

  const handleEditorClick = (event: MouseEvent<HTMLTextAreaElement>) => {
    rememberSelection();
    const reference = findLineReferenceAt(valueRef.current, event.currentTarget.selectionStart);
    if (reference) {
      onLineReferenceClick(reference.start, reference.end);
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
        <div className="markdown-editor-actions">
          <button
            className="secondary-button small"
            type="button"
            title="줄 참조를 실제 코드 블록으로 바꿔 복사"
            onClick={onCopyForConfluence}
            disabled={disabled || isSaving}
          >
            Confluence용 복사
          </button>
          <button className="primary-button small" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving ? "저장 중…" : "저장"}
          </button>
        </div>
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
          className={mode === "write" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "write"}
          onClick={() => setMode("write")}
        >
          편집
        </button>
        <button
          className={mode === "preview" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          onClick={() => setMode("preview")}
        >
          미리보기
        </button>
      </div>

      {mode === "write" ? (
        <textarea
          ref={textarea}
          className="markdown-input"
          value={value}
          onChange={(event) => {
            updateValue(event.target.value);
            selection.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            };
            onEditorStateChange(selection.current, event.target.scrollTop);
          }}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onClick={handleEditorClick}
          onBlur={rememberSelection}
          onScroll={rememberSelection}
          placeholder={disabled ? "새 분석 문서를 만든 뒤 내용을 작성하세요." : "## 이 함수의 역할"}
          aria-label="Markdown 편집기"
          disabled={disabled}
          readOnly={isSaving}
        />
      ) : (
        <MarkdownPreview value={value} onLineReferenceClick={onLineReferenceClick} />
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

export function MarkdownPreview({
  value,
  onLineReferenceClick,
}: {
  value: string;
  onLineReferenceClick: (start: number, end: number) => void;
}) {
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
      const content = renderInline(heading[2], onLineReferenceClick);
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
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, onLineReferenceClick)}</li>)}</ul>);
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(line.slice(2), onLineReferenceClick)}</blockquote>);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^- |^> |^```/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(" "), onLineReferenceClick)}</p>);
  }

  return <div className="markdown-preview">{blocks}</div>;
}

function renderInline(
  text: string,
  onLineReferenceClick: (start: number, end: number) => void,
): ReactNode[] {
  const fragments = text.split(/(\[line:\d+(?:-\d+)?\]|\*\*[^*]+\*\*|`[^`]+`)/g);
  return fragments.filter(Boolean).map((fragment, index) => {
    const lineReference = parseLineReference(fragment);
    if (lineReference) {
      const label = lineReference.start === lineReference.end
        ? `${lineReference.start}행 코드로 이동`
        : `${lineReference.start}행부터 ${lineReference.end}행 코드로 이동`;
      return (
        <button
          className="markdown-line-reference"
          type="button"
          aria-label={label}
          onClick={() => onLineReferenceClick(lineReference.start, lineReference.end)}
          key={index}
        >
          {fragment}
        </button>
      );
    }
    if (fragment.startsWith("**") && fragment.endsWith("**")) {
      return <strong key={index}>{fragment.slice(2, -2)}</strong>;
    }
    if (fragment.startsWith("`") && fragment.endsWith("`")) {
      return <code key={index}>{fragment.slice(1, -1)}</code>;
    }
    return <span key={index}>{fragment}</span>;
  });
}
