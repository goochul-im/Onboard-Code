import type { SymbolRecord } from "../core";
import { presentSymbol } from "./symbolPresentation";

export interface SymbolGroup {
  key: string;
  ownerName: string;
  relativePath: string;
  symbols: SymbolRecord[];
}

export function groupSymbolsByOwner(symbols: SymbolRecord[]): SymbolGroup[] {
  const groups = new Map<string, SymbolGroup>();
  for (const symbol of symbols) {
    const ownerName = presentSymbol(symbol.fqn).className;
    const key = `${symbol.language}:${symbol.relativePath}:${ownerName}`;
    const group = groups.get(key);
    if (group) group.symbols.push(symbol);
    else groups.set(key, { key, ownerName, relativePath: symbol.relativePath, symbols: [symbol] });
  }
  return [...groups.values()].sort((left, right) =>
    left.ownerName.localeCompare(right.ownerName, undefined, { sensitivity: "base" })
      || left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: "base" }));
}
