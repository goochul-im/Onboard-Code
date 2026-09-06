import type { ReactNode } from "react";

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className="tooltip">
      <button className="help-button" type="button" aria-label={`${label} 도움말`}>
        ?
      </button>
      <span className="tooltip-panel" role="tooltip">
        {children}
      </span>
    </span>
  );
}
