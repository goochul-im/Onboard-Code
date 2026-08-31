import { useEffect, useRef, useState } from "react";
import type { Core } from "cytoscape";
import type { GraphData } from "../types";
import { placeGraphNodeAction, type GraphNodeActionPosition } from "./graphNodeAction";

interface CallGraphProps {
  graph: GraphData | null;
  selectedSymbolId: string | null;
  onSelectSymbol: (symbolId: string) => void;
  viewport: GraphViewport | null;
  onViewportChange: (viewport: GraphViewport) => void;
  canOpenDetail: boolean;
  isSelectionLoading: boolean;
  onOpenDetail: () => void;
}

export interface GraphViewport { zoom: number; panX: number; panY: number }

const ACTION_WIDTH = 126;
const ACTION_HEIGHT = 34;

export function CallGraph({
  graph,
  selectedSymbolId,
  onSelectSymbol,
  viewport,
  onViewportChange,
  canOpenDetail,
  isSelectionLoading,
  onOpenDetail,
}: CallGraphProps) {
  const container = useRef<HTMLDivElement>(null);
  const [actionPosition, setActionPosition] = useState<GraphNodeActionPosition | null>(null);
  const positionedSymbolId = useRef<string | null>(null);
  const selectSymbol = useRef(onSelectSymbol);
  const viewportChanged = useRef(onViewportChange);
  selectSymbol.current = onSelectSymbol;
  viewportChanged.current = onViewportChange;

  useEffect(() => {
    if (!container.current || !graph) {
      return undefined;
    }

    let destroyed = false;
    let graphInstance: Core | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let positionFrame: number | undefined;

    void import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !container.current) {
        return;
      }
      graphInstance = cytoscape({
        container: container.current,
        elements: [
          ...graph.nodes.map((node) => ({
            data: {
              id: node.id,
              label: formatNodeLabel(node.fqn),
              fullLabel: `${node.fqn}${node.signature}`,
              language: node.language,
            },
            classes: node.id === selectedSymbolId ? "selected" : "",
          })),
          ...graph.edges
            .filter((edge) => edge.target)
            .map((edge) => ({
              data: {
                id: `edge-${edge.id}`,
                source: edge.source,
                target: edge.target,
                label: edge.confidence === "resolved" ? "" : edge.confidence,
              },
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
            "font-size": 11,
            "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
            "text-wrap": "wrap",
            "text-max-width": "166px",
            "text-valign": "center",
            "text-halign": "center",
            width: 196,
            height: 84,
            shape: "round-rectangle",
          },
        },
        {
          selector: "node[language = 'python']",
          style: {
            "background-color": "#264e45",
            "border-color": "#79d4c0",
          },
        },
        {
          selector: "node[language = 'php']",
          style: {
            "background-color": "#3d3b63",
            "border-color": "#aaa6df",
          },
        },
        {
          selector: "node[language = 'typescript']",
          style: {
            "background-color": "#254963",
            "border-color": "#5fc3e7",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": "#f5c979",
            "border-width": 3,
            "background-color": "#5f4524",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#62748f",
            "target-arrow-color": "#62748f",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            color: "#f5c979",
            label: "data(label)",
            "font-size": 9,
          },
        },
        {
          selector: "edge.ambiguous",
          style: {
            "line-style": "dashed",
            "line-color": "#f5c979",
            "target-arrow-color": "#f5c979",
          },
        },
        ],
        layout: {
          name: "breadthfirst",
          directed: true,
          padding: 32,
          spacingFactor: 1.15,
          animate: false,
        },
        wheelSensitivity: 0.18,
      });

      graphInstance.on("tap", "node", (event) => {
        selectSymbol.current(event.target.id());
      });

      const updateActionPosition = () => {
        if (!graphInstance || !container.current || !selectedSymbolId) {
          positionedSymbolId.current = null;
          setActionPosition(null);
          return;
        }
        const selectedNode = graphInstance.getElementById(selectedSymbolId);
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

      if (viewport) {
        graphInstance.zoom(viewport.zoom);
        graphInstance.pan({ x: viewport.panX, y: viewport.panY });
      }
      graphInstance.on("zoom pan", () => {
        const pan = graphInstance?.pan() ?? { x: 0, y: 0 };
        viewportChanged.current({ zoom: graphInstance?.zoom() ?? 1, panX: pan.x, panY: pan.y });
      });
      graphInstance.on("zoom pan resize render", updateActionPosition);
      resizeObserver = new ResizeObserver(updateActionPosition);
      resizeObserver.observe(container.current);
      positionFrame = requestAnimationFrame(updateActionPosition);
    });

    return () => {
      destroyed = true;
      if (positionFrame !== undefined) cancelAnimationFrame(positionFrame);
      resizeObserver?.disconnect();
      graphInstance?.destroy();
    };
  }, [graph, selectedSymbolId]);

  if (!graph) {
    return <div className="graph-empty">함수를 선택하면 호출 그래프가 여기에 표시됩니다.</div>;
  }

  return (
    <div className="call-graph-shell">
      <div ref={container} className="call-graph" aria-label="함수 호출 그래프" />
      {actionPosition && positionedSymbolId.current === selectedSymbolId && (
        <button
          className={`graph-node-action placement-${actionPosition.placement}`}
          type="button"
          style={{ left: actionPosition.left, top: actionPosition.top }}
          onClick={onOpenDetail}
          disabled={!canOpenDetail}
          aria-label="선택한 메서드의 소스와 노트 열기"
        >
          {isSelectionLoading ? "불러오는 중…" : "소스·노트 열기"}
        </button>
      )}
    </div>
  );
}

function formatNodeLabel(fqn: string): string {
  const parts = fqn.split(".");
  const owner = parts.length > 1 ? parts.at(-2) ?? "" : "함수";
  const method = parts.at(-1) ?? fqn;
  const methodLines = wrapIdentifier(method, 18).slice(0, 2);
  return [truncate(owner, 21), ...methodLines].filter(Boolean).join("\n");
}

function wrapIdentifier(value: string, maxLength: number): string[] {
  const words = value.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) ?? [value];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line += word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 2 ? [lines[0], `${lines[1]}…`] : lines;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
