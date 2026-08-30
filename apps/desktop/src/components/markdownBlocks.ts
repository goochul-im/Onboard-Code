export function replaceMarkdownRange(value: string, start: number, end: number, text: string): string {
  return `${value.slice(0, start)}${text}${value.slice(end)}`;
}
