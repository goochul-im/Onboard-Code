import { useEffect, useRef } from "react";
import type { Core } from "cytoscape";
import type { GraphData } from "../types";

interface CallGraphProps {
  graph: GraphData | null;
  selectedSymbolId: string | null;
  onSelectSymbol: (symbolId: string) => void;
}

export function CallGraph({ graph, selectedSymbolId, onSelectSymbol }: CallGraphProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || !graph) {
      return undefined;
    }

    let destroyed = false;
    let graphInstance: Core | undefined;

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
              label: `${node.fqn}\n${node.signature}`,
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
            "font-size": 10,
            "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
            "text-wrap": "wrap",
            "text-max-width": "154px",
            "text-valign": "center",
            "text-halign": "center",
            width: 174,
            height: 66,
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
        onSelectSymbol(event.target.id());
      });
    });

    return () => {
      destroyed = true;
      graphInstance?.destroy();
    };
  }, [graph, onSelectSymbol, selectedSymbolId]);

  if (!graph) {
    return <div className="graph-empty">함수를 선택하면 호출 그래프가 여기에 표시됩니다.</div>;
  }

  return <div ref={container} className="call-graph" aria-label="함수 호출 그래프" />;
}
