import { useEffect, useMemo, useRef, useState } from "react";
import type { Core } from "cytoscape";
import type { GraphData } from "../core";
import { placeGraphNodeAction, type GraphNodeActionPosition } from "./graphNodeAction";
import { presentSymbol } from "./symbolPresentation";

interface CallGraphProps {
  graph: GraphData | null;
  selectedSymbolId: string | null;
  onSelectSymbol: (symbolId: string) => void;
  canOpenDetail?: boolean;
  onOpenDetail?: () => void;
}

const ACTION_WIDTH = 126;
const ACTION_HEIGHT = 34;

export function CallGraph({
  graph,
  selectedSymbolId,
  onSelectSymbol,
  canOpenDetail = false,
  onOpenDetail,
}: CallGraphProps) {
  const container = useRef<HTMLDivElement>(null);
  const [actionPosition, setActionPosition] = useState<GraphNodeActionPosition | null>(null);
  const positionedSymbolId = useRef<string | null>(null);
  const selectSymbol = useRef(onSelectSymbol);
  const openDetail = useRef(onOpenDetail);
  selectSymbol.current = onSelectSymbol;
  openDetail.current = onOpenDetail;

  const graphKey = useMemo(() => JSON.stringify({
    nodes: graph?.nodes.map((node) => node.id),
    edges: graph?.edges.map((edge) => [edge.source, edge.target]),
    selectedSymbolId,
  }), [graph, selectedSymbolId]);

  useEffect(() => {
    if (!container.current || !graph) return undefined;
    let destroyed = false;
    let instance: Core | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let positionFrame: number | null = null;

    void import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !container.current) return;
      instance = cytoscape({
        container: container.current,
        minZoom: 0.25,
        maxZoom: 1.25,
        elements: [
          ...graph.nodes.map((node) => ({
            data: { id: node.id, label: formatNodeLabel(node.fqn), language: node.language },
            classes: node.id === selectedSymbolId ? "selected" : "",
          })),
          ...graph.edges.filter((edge) => edge.target).map((edge) => ({
            data: { id: `e-${edge.id}`, source: edge.source, target: edge.target },
            classes: edge.confidence,
          })),
        ],
        style: [
          {
            selector: "node",
            style: {
              "background-color": "#314662",
              "border-color": "#82a8e8",
              "border-width": 1,
              color: "#f2f5fb",
              label: "data(label)",
              "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
              "font-size": 11,
              "text-halign": "center",
              "text-valign": "center",
              "text-wrap": "wrap",
              "text-max-width": "166px",
              width: 196,
              height: 84,
              shape: "round-rectangle",
            },
          },
          { selector: "node[language = 'python']", style: { "background-color": "#264e45", "border-color": "#79d4c0" } },
          { selector: "node[language = 'php']", style: { "background-color": "#3d3b63", "border-color": "#aaa6df" } },
          { selector: "node[language = 'typescript']", style: { "background-color": "#254963", "border-color": "#5fc3e7" } },
          { selector: "node.selected", style: { "border-color": "#f5c979", "border-width": 3, "background-color": "#5f4524" } },
          {
            selector: "edge",
            style: {
              width: 2,
              "line-color": "#62748f",
              "target-arrow-color": "#62748f",
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
            },
          },
        ],
        layout: { name: "breadthfirst", directed: true, padding: 32, spacingFactor: 1.15, animate: false },
      });

      instance.on("tap", "node", (event) => selectSymbol.current(event.target.id()));

      const updateActionPosition = () => {
        if (!instance || !container.current || !selectedSymbolId || !openDetail.current) {
          positionedSymbolId.current = null;
          setActionPosition(null);
          return;
        }
        const selectedNode = instance.getElementById(selectedSymbolId);
        if (selectedNode.empty()) {
          positionedSymbolId.current = null;
          setActionPosition(null);
          return;
        }
        const box = selectedNode.renderedBoundingBox();
        const position = placeGraphNodeAction(
          box,
          container.current.clientWidth,
          container.current.clientHeight,
          ACTION_WIDTH,
          ACTION_HEIGHT,
        );
        positionedSymbolId.current = position ? selectedSymbolId : null;
        setActionPosition(position);
      };

      instance.on("zoom pan resize render", updateActionPosition);
      resizeObserver = new ResizeObserver(updateActionPosition);
      resizeObserver.observe(container.current);
      positionFrame = requestAnimationFrame(updateActionPosition);
    });

    return () => {
      destroyed = true;
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      resizeObserver?.disconnect();
      instance?.destroy();
    };
  }, [graphKey, selectedSymbolId]);

  if (!graph) return <div className="graph-empty">함수를 선택하면 호출 그래프가 여기에 표시됩니다.</div>;
  if (graph.nodes.length === 0) return <div className="graph-empty">선택한 함수를 현재 분석에서 찾지 못했습니다.</div>;
  return (
    <div className="call-graph-shell">
      <div ref={container} className="call-graph" aria-label="선택한 함수 호출 그래프" />
      {actionPosition && positionedSymbolId.current === selectedSymbolId && openDetail.current && (
        <button
          className={`graph-node-action placement-${actionPosition.placement}`}
          type="button"
          style={{ left: actionPosition.left, top: actionPosition.top }}
          onClick={() => openDetail.current?.()}
          disabled={!canOpenDetail}
          aria-label="선택한 함수의 소스와 노트 열기"
        >
          소스·노트 열기
        </button>
      )}
    </div>
  );
}

function formatNodeLabel(fqn: string): string {
  const presentation = presentSymbol(fqn);
  return [truncate(presentation.className, 21), ...wrapIdentifier(presentation.methodName, 18).slice(0, 2)]
    .filter(Boolean)
    .join("\n");
}

function wrapIdentifier(value: string, maxLength: number): string[] {
  const words = value.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) ?? [value];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length > maxLength) {
      lines.push(line);
      line = word;
    } else line += word;
  }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0], `${lines[1]}…`] : lines;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
