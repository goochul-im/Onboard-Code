export interface SymbolPresentation {
  methodName: string;
  className: string;
}

export function presentSymbol(fqn: string): SymbolPresentation {
  const parts = fqn.split(/[.\\]/).filter(Boolean);
  return {
    methodName: parts.at(-1) ?? fqn,
    className: parts.at(-2) ?? "전역 함수",
  };
}
