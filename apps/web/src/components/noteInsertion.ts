export interface TextInsertion {
  value: string;
  cursor: number;
}

export function insertTextAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  text: string,
): TextInsertion {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return {
    value: `${value.slice(0, start)}${text}${value.slice(end)}`,
    cursor: start + text.length,
  };
}
