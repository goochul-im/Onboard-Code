interface PointerGesture {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function isLineReferenceGesture(gesture: PointerGesture): boolean {
  return (gesture.metaKey || gesture.ctrlKey) && gesture.button === 0;
}

export interface LineReferenceModifier {
  label: "⌘" | "Ctrl";
  name: "Command" | "Control";
}

export function lineReferenceModifierForUserAgent(userAgent: string): LineReferenceModifier {
  return /Macintosh|Mac OS X/i.test(userAgent)
    ? { label: "⌘", name: "Command" }
    : { label: "Ctrl", name: "Control" };
}
