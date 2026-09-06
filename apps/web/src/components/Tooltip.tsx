import { useId, useState, type FocusEvent, type ReactNode } from "react";

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  function closeWhenFocusLeaves(event: FocusEvent<HTMLSpanElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <span className={open ? "tooltip open" : "tooltip"} onBlur={closeWhenFocusLeaves}>
      <button
        className="help-button"
        type="button"
        aria-label={`${label} 도움말`}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      <span id={tooltipId} className="tooltip-panel" role="tooltip">
        {children}
      </span>
    </span>
  );
}
