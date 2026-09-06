import type { SymbolRecord } from "../core";
import { presentSymbol } from "./symbolPresentation";

export function SelectedSymbolHeading({ symbol }: { symbol: SymbolRecord | null }) {
  if (!symbol) return <h2>함수를 선택하세요</h2>;
  const presentation = presentSymbol(symbol.fqn);
  return (
    <div className="selected-symbol-heading" title={`${symbol.fqn}${symbol.signature}`}>
      <h2>{presentation.methodName}</h2>
      <p>{presentation.className}</p>
    </div>
  );
}
