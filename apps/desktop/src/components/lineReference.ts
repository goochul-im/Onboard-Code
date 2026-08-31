export interface ParsedLineReference {
  start: number;
  end: number;
}

export function parseLineReference(value: string): ParsedLineReference | null {
  const match = /^\[line:(\d+)(?:-(\d+))?\]$/.exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2] ?? match[1]);
  if (first < 1 || second < 1) return null;
  return { start: Math.min(first, second), end: Math.max(first, second) };
}

export function findLineReferenceAt(value: string, offset: number): ParsedLineReference | null {
  const pattern = /\[line:\d+(?:-\d+)?\]/g;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      return parseLineReference(match[0]);
    }
  }
  return null;
}
