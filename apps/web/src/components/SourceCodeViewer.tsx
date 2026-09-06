import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { SourceFile, SymbolRecord } from "../core";
import { isLineReferenceGesture, type LineReferenceModifier } from "./sourceLineGesture";
import { detectSourceLanguage, tokenizeSource } from "./syntaxHighlight";

interface LineRange {
  start: number;
  end: number;
}

interface SourceCodeViewerProps {
  sourceFile: SourceFile;
  selectedSymbol: SymbolRecord;
  modifier: LineReferenceModifier;
  onInsertLineReference: (reference: string) => void;
}

export function SourceCodeViewer({ sourceFile, selectedSymbol, modifier, onInsertLineReference }: SourceCodeViewerProps) {
  const dragStart = useRef<number | null>(null);
  const dragEnd = useRef<number | null>(null);
  const [referenceRange, setReferenceRange] = useState<LineRange | null>(null);
  const syntaxLines = useMemo(
    () => tokenizeSource(sourceFile.source, detectSourceLanguage(sourceFile.relativePath)),
    [sourceFile.relativePath, sourceFile.source],
  );

  useEffect(() => setReferenceRange(null), [sourceFile.relativePath, selectedSymbol.id]);

  const lineNumberFromElement = (element: Element | null): number | null => {
    const codeLine = element?.closest<HTMLElement>("code[data-line-number]");
    const lineNumber = Number(codeLine?.dataset.lineNumber);
    return Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : null;
  };

  const lineNumberAtPointer = (event: PointerEvent<HTMLPreElement>): number | null => {
    const elementAtPointer = document.elementFromPoint(event.clientX, event.clientY);
    return lineNumberFromElement(elementAtPointer)
      ?? lineNumberFromElement(event.target instanceof Element ? event.target : null);
  };

  const startSelection = (event: PointerEvent<HTMLPreElement>) => {
    if (!isLineReferenceGesture(event)) return;
    const lineNumber = lineNumberAtPointer(event);
    if (!lineNumber) return;
    event.preventDefault();
    dragStart.current = lineNumber;
    dragEnd.current = lineNumber;
    setReferenceRange({ start: lineNumber, end: lineNumber });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateSelection = (event: PointerEvent<HTMLPreElement>) => {
    if (!dragStart.current) return;
    event.preventDefault();
    const lineNumber = lineNumberAtPointer(event);
    if (!lineNumber) return;
    dragEnd.current = lineNumber;
    setReferenceRange(normalizeRange(dragStart.current, lineNumber));
  };

  const finishSelection = (event: PointerEvent<HTMLPreElement>) => {
    const start = dragStart.current;
    if (!start) return;
    event.preventDefault();
    const end = lineNumberAtPointer(event) ?? dragEnd.current;
    dragStart.current = null;
    dragEnd.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!end) return;
    const range = normalizeRange(start, end);
    setReferenceRange(range);
    onInsertLineReference(range.start === range.end
      ? `[line:${range.start}]`
      : `[line:${range.start}-${range.end}]`);
  };

  const suppressModifiedClickMenu = (event: MouseEvent<HTMLPreElement>) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };

  return (
    <>
      <p className="source-selection-guide">
        일반 드래그로 코드를 선택·복사합니다. <kbd>{modifier.label}</kbd>+클릭은 <code>[line:30]</code>, <kbd>{modifier.label}</kbd>+드래그는 <code>[line:30-35]</code> 참조를 노트에 넣습니다.
      </p>
      <pre
        className="code-preview full-source selectable-source"
        aria-label={`소스 코드. 일반 드래그로 복사할 코드를 선택하고, ${modifier.name}을 누른 채 클릭하거나 드래그해 노트에 줄 참조를 추가할 수 있습니다.`}
        onPointerDown={startSelection}
        onPointerMove={updateSelection}
        onPointerUp={finishSelection}
        onPointerCancel={() => {
          dragStart.current = null;
          dragEnd.current = null;
        }}
        onContextMenu={suppressModifiedClickMenu}
      >
        {syntaxLines.map((tokens, index) => {
          const lineNumber = index + 1;
          const isSelected = lineNumber >= selectedSymbol.startLine && lineNumber <= selectedSymbol.endLine;
          const isReference = Boolean(referenceRange
            && lineNumber >= referenceRange.start
            && lineNumber <= referenceRange.end);
          return (
            <code
              className={`code-line${isSelected ? " selected" : ""}${isReference ? " line-reference" : ""}`}
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
    </>
  );
}

function normalizeRange(start: number, end: number): LineRange {
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
