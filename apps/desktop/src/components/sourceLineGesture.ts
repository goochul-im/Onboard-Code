interface PointerGesture {
  button: number;
  ctrlKey: boolean;
}

export function isLineReferenceGesture(gesture: PointerGesture): boolean {
  return gesture.ctrlKey && gesture.button === 0;
}
