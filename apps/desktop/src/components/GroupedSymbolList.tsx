import { useEffect, useMemo, useRef, useState } from "react";
import type { SymbolRecord } from "../types";
import { groupSymbolsByOwner } from "./symbolGroups";
import { SymbolSearchResult } from "./SymbolSearchResult";

interface GroupedSymbolListProps {
  symbols: SymbolRecord[];
  query: string;
  selectedSymbolId: string | null;
  disabled: boolean;
  showEmptyMessage: boolean;
  onSelect: (symbolId: string) => void;
}

export function GroupedSymbolList({
  symbols,
  query,
  selectedSymbolId,
  disabled,
  showEmptyMessage,
  onSelect,
}: GroupedSymbolListProps) {
  const groups = useMemo(() => groupSymbolsByOwner(symbols), [symbols]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const previousQuery = useRef(query);

  useEffect(() => {
    const groupKeys = new Set(groups.map((group) => group.key));
    const selectedGroup = groups.find((group) =>
      group.symbols.some((symbol) => symbol.id === selectedSymbolId));
    const queryStarted = query.trim().length > 0;
    const queryCleared = previousQuery.current.trim().length > 0 && !queryStarted;
    previousQuery.current = query;

    setExpandedGroups((current) => {
      if (queryStarted) {
        return groupKeys;
      }
      if (queryCleared) {
        return new Set(selectedGroup ? [selectedGroup.key] : []);
      }
      const next = new Set([...current].filter((key) => groupKeys.has(key)));
      if (selectedGroup) next.add(selectedGroup.key);
      return next;
    });
  }, [groups, query, selectedSymbolId]);

  if (groups.length === 0) {
    return showEmptyMessage
      ? <p className="muted">분석 후 함수를 검색할 수 있습니다.</p>
      : null;
  }

  const setGroupExpanded = (key: string, expanded: boolean) => {
    setExpandedGroups((current) => {
      if (current.has(key) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <section className="grouped-symbols" aria-label="클래스별 함수 검색 결과">
      <div className="symbol-list-toolbar">
        <span>클래스/파일 {groups.length}개</span>
        <div>
          <button type="button" onClick={() => setExpandedGroups(new Set())}>전부 접기</button>
          <button type="button" onClick={() => setExpandedGroups(new Set(groups.map((group) => group.key)))}>전부 펼치기</button>
        </div>
      </div>
      <div className="symbol-list" aria-label="함수 검색 결과">
        {groups.map((group) => (
          <details
            className="symbol-group"
            open={expandedGroups.has(group.key)}
            onToggle={(event) => setGroupExpanded(group.key, event.currentTarget.open)}
            key={group.key}
          >
            <summary>
              <span className="symbol-group-copy">
                <strong title={group.ownerName}>{group.ownerName}</strong>
                <small title={group.relativePath}>{group.relativePath}</small>
              </span>
              <span className="symbol-group-count">{group.symbols.length}</span>
            </summary>
            <div className="symbol-group-items">
              {group.symbols.map((symbol) => (
                <SymbolSearchResult
                  symbol={symbol}
                  selected={selectedSymbolId === symbol.id}
                  disabled={disabled}
                  compact
                  onSelect={onSelect}
                  key={symbol.id}
                />
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
