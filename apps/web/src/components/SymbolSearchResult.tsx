import type { SymbolRecord } from "../core";
import { presentSymbol } from "./symbolPresentation";

interface SymbolSearchResultProps {
  symbol: SymbolRecord;
  selected: boolean;
  disabled: boolean;
  onSelect: (symbolId: string) => void;
}

export function SymbolSearchResult({ symbol, selected, disabled, onSelect }: SymbolSearchResultProps) {
  const presentation = presentSymbol(symbol.fqn);
  return (
    <button
      type="button"
      className={`symbol-row compact${selected ? " active" : ""}`}
      onClick={() => onSelect(symbol.id)}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className={`language-dot ${symbol.language}`} aria-hidden="true" />
      <span className="symbol-copy">
        <strong className="symbol-method" title={`${symbol.fqn}${symbol.signature}`}>
          {presentation.methodName}
        </strong>
      </span>
    </button>
  );
}
