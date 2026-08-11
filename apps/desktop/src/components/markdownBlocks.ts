export interface MarkdownBlock {
  start: number;
  end: number;
  raw: string;
  content: string;
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  if (!value) {
    return [{ start: 0, end: 0, raw: "", content: "" }];
  }

  const lines = value.split("\n");
  const blocks: MarkdownBlock[] = [];
  let blockStart = 0;
  let offset = 0;
  let inCodeFence = false;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const lineStart = offset;
    const hasNewline = lineIndex < lines.length - 1;
    const lineEnd = lineStart + line.length + (hasNewline ? 1 : 0);
    const isFence = line.trimStart().startsWith("```");
    if (isFence) {
      inCodeFence = !inCodeFence;
    }

    if (!inCodeFence && !isFence && hasNewline && line.trim() === "") {
      let separatorEnd = lineEnd;
      let nextIndex = lineIndex + 1;
      while (nextIndex < lines.length && lines[nextIndex].trim() === "") {
        separatorEnd += lines[nextIndex].length + (nextIndex < lines.length - 1 ? 1 : 0);
        nextIndex += 1;
      }
      const raw = value.slice(blockStart, separatorEnd);
      const content = value.slice(blockStart, lineStart).replace(/\n$/, "");
      if (content || raw) {
        blocks.push({ start: blockStart, end: separatorEnd, raw, content });
      }
      blockStart = separatorEnd;
      offset = separatorEnd;
      lineIndex = nextIndex;
      continue;
    }

    offset = lineEnd;
    lineIndex += 1;
  }

  if (blockStart < value.length) {
    const raw = value.slice(blockStart);
    blocks.push({ start: blockStart, end: value.length, raw, content: raw });
  } else {
    blocks.push({ start: value.length, end: value.length, raw: "", content: "" });
  }
  return blocks;
}

export function findMarkdownBlock(blocks: MarkdownBlock[], offset: number): MarkdownBlock {
  const safeOffset = Math.max(0, offset);
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (safeOffset >= block.start && safeOffset <= block.end) {
      return block;
    }
  }
  return blocks.at(-1) ?? { start: 0, end: 0, raw: "", content: "" };
}

export function replaceMarkdownRange(value: string, start: number, end: number, text: string): string {
  return `${value.slice(0, start)}${text}${value.slice(end)}`;
}
