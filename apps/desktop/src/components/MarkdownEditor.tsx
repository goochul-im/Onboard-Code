import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";

interface MarkdownEditorProps {
  value: string;
  tags: string;
  disabled: boolean;
  isSaving: boolean;
  onChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onSave: () => void;
}

type EditorMode = "write" | "preview";

export interface MarkdownEditorHandle {
  insertAtCursor: (text: string) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  value,
  tags,
  disabled,
  isSaving,
  onChange,
  onTagsChange,
  onSave,
}, ref) {
  const [mode, setMode] = useState<EditorMode>("write");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const selection = useRef({ start: value.length, end: value.length });
  valueRef.current = value;

  const updateValue = (nextValue: string) => {
    valueRef.current = nextValue;
    onChange(nextValue);
  };

  const rememberSelection = () => {
    const element = textarea.current;
    if (element) {
      selection.current = { start: element.selectionStart, end: element.selectionEnd };
    }
  };

  const focusAt = (position: number) => {
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
      selection.current = { start: position, end: position };
    });
  };

  const wrapSelection = (prefix: string, suffix = prefix, placeholder = "텍스트") => {
    rememberSelection();
    const { start, end } = selection.current;
    const selected = valueRef.current.slice(start, end) || placeholder;
    const next = `${valueRef.current.slice(0, start)}${prefix}${selected}${suffix}${valueRef.current.slice(end)}`;
    updateValue(next);
    const selectionEnd = start + prefix.length + selected.length;
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start + prefix.length, selectionEnd);
      selection.current = { start: start + prefix.length, end: selectionEnd };
    });
  };

  const prefixCurrentLine = (prefix: string) => {
    rememberSelection();
    const selectionStart = selection.current.start;
    const lineStart = valueRef.current.lastIndexOf("\n", selectionStart - 1) + 1;
    updateValue(`${valueRef.current.slice(0, lineStart)}${prefix}${valueRef.current.slice(lineStart)}`);
    focusAt(selectionStart + prefix.length);
  };

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const { start, end } = selection.current;
      const next = `${valueRef.current.slice(0, start)}${text}${valueRef.current.slice(end)}`;
      updateValue(next);
      setMode("write");
      focusAt(start + text.length);
    },
  }));

  return (
    <section className="markdown-editor" aria-label="Markdown 노트 편집기">
      <div className="markdown-editor-header">
        <div>
          <p className="eyebrow">YOUR NOTE</p>
          <h2>직접 작성한 설명</h2>
        </div>
        <button className="primary-button small" onClick={onSave} disabled={disabled || isSaving}>
          {isSaving ? "저장 중…" : "저장"}
        </button>
      </div>

      <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 서식">
        <button type="button" onClick={() => prefixCurrentLine("## ")} disabled={disabled}>제목</button>
        <button type="button" onClick={() => wrapSelection("**")} disabled={disabled}><strong>굵게</strong></button>
        <button type="button" onClick={() => prefixCurrentLine("- ")} disabled={disabled}>목록</button>
        <button type="button" onClick={() => wrapSelection("`", "`", "코드")} disabled={disabled}>코드</button>
        <button type="button" onClick={() => wrapSelection("\n```\n", "\n```\n", "코드 블록")} disabled={disabled}>블록</button>
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
            rememberSelection();
          }}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onClick={rememberSelection}
          onBlur={rememberSelection}
          placeholder={"## 이 함수의 역할\n\n- 입력과 출력\n- 호출 순서\n- 주의할 점"}
          disabled={disabled}
          aria-label="Markdown으로 함수 설명 작성"
        />
      ) : (
        <MarkdownPreview value={value} />
      )}

      <label className="field-label" htmlFor="note-tags">태그</label>
      <input
        id="note-tags"
        value={tags}
        onChange={(event) => onTagsChange(event.target.value)}
        placeholder="예: 핵심 흐름, 인증, 개선 필요"
        disabled={disabled}
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
