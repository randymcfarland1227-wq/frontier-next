"use client";

import type { ReactNode } from "react";

/** The one row of tabs: Today's tabs, the site tabs, split-pane tabs. Pressed state is announced, not just coloured. */
export function SegTabs<T extends string>({
  items,
  value,
  onPick,
  label,
  className = "",
}: {
  items: Array<{ id: T; label: ReactNode; count?: number }>;
  value: T;
  onPick: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`sk-seg sk-today-tabs ${className}`.trim()} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" aria-pressed={value === it.id} onClick={() => onPick(it.id)}>
          {it.label}
          {it.count ? <span className="sk-tabn">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
