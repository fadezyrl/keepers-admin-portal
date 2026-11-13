"use client";

import { useEffect, useRef, useState } from "react";

export type RowAction = {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  hidden?: boolean;
};

export function RowActions({
  actions,
  label = "Actions",
}: {
  actions: RowAction[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (visible.length === 0) return null;

  if (visible.length <= 2) {
    return (
      <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {visible.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`btn btn-sm ${action.tone === "danger" ? "btn-danger" : "btn-secondary"}`}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="menu-root" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="menu-panel" role="menu">
          {visible.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={`menu-item ${action.tone === "danger" ? "is-danger" : ""}`}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
