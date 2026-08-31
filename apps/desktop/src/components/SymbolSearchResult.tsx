import type { SymbolRecord } from "../types";
import { presentSymbol } from "./symbolPresentation";

interface SymbolSearchResultProps {
  symbol: SymbolRecord;
  selected: boolean;
  disabled: boolean;
  compact?: boolean;
  onSelect: (symbolId: string) => void;
}

export function SymbolSearchResult({ symbol, selected, disabled, compact = false, onSelect }: SymbolSearchResultProps) {
  const presentation = presentSymbol(symbol.fqn);
  return (
    <button
      type="button"
      className={`symbol-row${compact ? " compact" : ""}${selected ? " active" : ""}`}
      onClick={() => onSelect(symbol.id)}
      disabled={disabled}
    >
      <span className={`language-dot ${symbol.language}`} />
      <span className="symbol-copy">
        <strong className="symbol-method" title={`${symbol.fqn}${symbol.signature}`}>
          {presentation.methodName}
        </strong>
        {!compact && (
          <>
            <span className="symbol-class" title={presentation.className}>
              {presentation.className}
            </span>
            <small className="symbol-location" title={symbol.relativePath}>
              {symbol.relativePath}
            </small>
          </>
        )}
      </span>
    </button>
  );
}
