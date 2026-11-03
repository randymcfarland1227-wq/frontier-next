"use client";

import { useState } from "react";

export type Opt = { key: string; label: string; sub?: string; group?: string };

/** A search box with a pop-up of matches: type to filter, pick one. */
export function SearchPick({
  options,
  onPick,
  placeholder,
  label,
  disabled,
}: {
  options: Opt[];
  onPick: (o: Opt) => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const needle = q.trim().toLowerCase();
  const matches = options
    .filter(
      (o) =>
        !needle || `${o.label} ${o.sub || ""} ${o.group || ""}`.toLowerCase().includes(needle),
    )
    .slice(0, 40);
  const groups = [...new Set(matches.map((m) => m.group || ""))];
  return (
    <div className="sk-fd-search">
      <input
        type="search"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => window.setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setFocus(false))}
        placeholder={placeholder}
        aria-label={label}
      />
      {focus && !disabled ? (
        <div className="sk-fd-pop" role="listbox">
          {matches.length ? (
            groups.map((g) => (
              <div key={g}>
                {g ? <p className="sk-cap">{g}</p> : null}
                {matches
                  .filter((m) => (m.group || "") === g)
                  .map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onPick(m);
                        setQ("");
                        setFocus(false);
                      }}
                    >
                      <span>{m.label}</span>
                      {m.sub ? <small>{m.sub}</small> : null}
                    </button>
                  ))}
              </div>
            ))
          ) : (
            <p className="sk-empty">Nothing matches “{q.trim()}”.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

