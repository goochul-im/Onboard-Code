import type { GraphData, GraphEdge, SymbolRecord } from "./types";

export function buildGraph(symbols: SymbolRecord[], edges: GraphEdge[], rootSymbolId: string, depth: number): GraphData {
  const boundedDepth = Math.max(1, Math.min(3, Math.floor(depth)));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const selected = byId.get(rootSymbolId);
  if (!selected) return { nodes: [], edges: [] };

  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    pushMap(adjacency, edge.source, edge);
    if (edge.target) pushMap(adjacency, edge.target, edge);
  }

  const visited = new Set([rootSymbolId]);
  const queue: Array<{ id: string; distance: number }> = [{ id: rootSymbolId, distance: 0 }];
  const graphEdges = new Map<number, GraphEdge>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.distance >= boundedDepth) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      graphEdges.set(edge.id, edge);
      for (const nextId of [edge.source, edge.target].filter(Boolean) as string[]) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({ id: nextId, distance: current.distance + 1 });
        }
      }
    }
  }

  return {
    nodes: [...visited].map((id) => byId.get(id)).filter(Boolean) as SymbolRecord[],
    edges: [...graphEdges.values()].filter((edge) => visited.has(edge.source) && (!edge.target || visited.has(edge.target))),
  };
}

export function buildRestrictedGraph(symbols: SymbolRecord[], edges: GraphEdge[], symbolIds: string[]): GraphData {
  const allowed = new Set(symbolIds);
  return {
    nodes: symbols.filter((symbol) => allowed.has(symbol.id)),
    edges: edges.filter((edge) => allowed.has(edge.source) && edge.target !== null && allowed.has(edge.target)),
  };
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

