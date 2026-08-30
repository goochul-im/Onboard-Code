interface SourceScrollTarget {
  shouldCenter: boolean;
  savedScrollTop: number;
  selectedLineTop: number;
  selectedLineHeight: number;
  viewportHeight: number;
  scrollHeight: number;
}

export function resolveSourceScrollTop({
  shouldCenter,
  savedScrollTop,
  selectedLineTop,
  selectedLineHeight,
  viewportHeight,
  scrollHeight,
}: SourceScrollTarget): number {
  const maximum = Math.max(0, scrollHeight - viewportHeight);
  if (!shouldCenter) {
    return clamp(savedScrollTop, 0, maximum);
  }
  const centered = selectedLineTop - (viewportHeight - selectedLineHeight) / 2;
  return clamp(centered, 0, maximum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
