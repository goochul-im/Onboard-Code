export interface GraphNodeBox {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface GraphNodeActionPosition {
  left: number;
  top: number;
  placement: "right" | "left" | "below";
}

const EDGE_PADDING = 10;
const NODE_GAP = 12;

export function placeGraphNodeAction(
  node: GraphNodeBox,
  containerWidth: number,
  containerHeight: number,
  actionWidth: number,
  actionHeight: number,
): GraphNodeActionPosition | null {
  if (node.x2 <= 0 || node.x1 >= containerWidth || node.y2 <= 0 || node.y1 >= containerHeight) {
    return null;
  }
  const centeredTop = clamp(
    (node.y1 + node.y2 - actionHeight) / 2,
    EDGE_PADDING,
    containerHeight - actionHeight - EDGE_PADDING,
  );

  if (node.x2 + NODE_GAP + actionWidth <= containerWidth - EDGE_PADDING) {
    return { left: node.x2 + NODE_GAP, top: centeredTop, placement: "right" };
  }
  if (node.x1 - NODE_GAP - actionWidth >= EDGE_PADDING) {
    return { left: node.x1 - NODE_GAP - actionWidth, top: centeredTop, placement: "left" };
  }

  return {
    left: clamp(
      (node.x1 + node.x2 - actionWidth) / 2,
      EDGE_PADDING,
      containerWidth - actionWidth - EDGE_PADDING,
    ),
    top: clamp(
      node.y2 + NODE_GAP,
      EDGE_PADDING,
      containerHeight - actionHeight - EDGE_PADDING,
    ),
    placement: "below",
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
