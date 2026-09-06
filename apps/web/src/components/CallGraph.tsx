import { useEffect, useMemo, useRef } from "react";
import type { Core } from "cytoscape";
import type { GraphData } from "../core";

interface CallGraphProps {
  graph: GraphData | null;
  selectedSymbolId: string | null;
  onSelectSymbol: (symbolId: string) => void;
}

export function CallGraph({ graph, selectedSymbolId, onSelectSymbol }: CallGraphProps) {
  const container = useRef<HTMLDivElement>(null);
  const selectSymbol = useRef(onSelectSymbol);
  selectSymbol.current = onSelectSymbol;

  const graphKey = useMemo(() => JSON.stringify({
    nodes: graph?.nodes.map((node) => node.id),
    edges: graph?.edges.map((edge) => [edge.source, edge.target]),
    selectedSymbolId,
  }), [graph, selectedSymbolId]);

  useEffect(() => {
    if (!container.current || !graph) return undefined;
    let destroyed = false;
    let instance: Core | null = null;

    void import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !container.current) return;
      instance = cytoscape({
        container: container.current,
        elements: [
          ...graph.nodes.map((node) => ({
            data: { id: node.id, label: node.fqn.split(".").slice(-2).join("\n"), language: node.language },
            classes: node.id === selectedSymbolId ? "selected" : "",
          })),
          ...graph.edges
            .filter((edge) => edge.target)
            .map((edge) => ({
              data: { id: `e-${edge.id}`, source: edge.source, target: edge.target, label: edge.confidence === "resolved" ? "" : edge.confidence },
              classes: edge.confidence,
            })),
        ],
        style: [
          {
            selector: "node",
            style: {
              "background-color": "#1e4d54",
              "border-color": "#7fd0c5",
              "border-width": 1,
              color: "#f4f7f8",
              label: "data(label)",
              "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
              "font-size": 11,
              "text-halign": "center",
              "text-valign": "center",
              "text-wrap": "wrap",
              "text-max-width": "150px",
              width: "178px",
              height: "76px",
              shape: "round-rectangle",
            },
          },
          { selector: "node[language = 'python']", style: { "background-color": "#344d2a", "border-color": "#a9d577" } },
          { selector: "node[language = 'php']", style: { "background-color": "#44396a", "border-color": "#b6a7ef" } },
          { selector: "node[language = 'typescript']", style: { "background-color": "#234760", "border-color": "#79c8ee" } },
          { selector: "node.selected", style: { "border-color": "#f2bd5f", "border-width": 3, "background-color": "#6b4a1f" } },
          {
            selector: "edge",
            style: {
              width: 2,
              "line-color": "#6e7d8c",
              "target-arrow-color": "#6e7d8c",
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              color: "#f2bd5f",
              label: "data(label)",
              "font-size": 9,
            },
          },
          { selector: "edge.ambiguous", style: { "line-style": "dashed", "line-color": "#f2bd5f", "target-arrow-color": "#f2bd5f" } },
        ],
        layout: { name: "breadthfirst", directed: true, padding: 28, spacingFactor: 1.08, animate: false },
      });
      instance.on("tap", "node", (event) => selectSymbol.current(event.target.id()));
    });

    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [graphKey]);

  if (!graph) return <div className="graph-empty">함수를 선택하면 호출 그래프가 표시됩니다.</div>;
  if (graph.nodes.length === 0) return <div className="graph-empty">연결된 호출 관계가 아직 없습니다.</div>;
  return <div ref={container} className="call-graph" aria-label="선택한 함수 호출 그래프" />;
}
