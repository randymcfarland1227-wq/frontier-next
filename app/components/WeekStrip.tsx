"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  dayKey,
  eventStart,
  fromDayKey,
  onDay,
  rangeLabel,
  startOfDay,
  startOfWeek,
  timeLabel,
} from "../../lib/schedule";
import type { CalItem } from "./CalendarView";

function weekTitle(a: Date, b: Date) {
  const left = a.toLocaleDateString([], { month: "short", day: "numeric" });
  const right =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : b.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/**
 * Week view: the seven days in a row, each a column listing what's on it (all-day first, then by
 * time). No hour grid — it matches the month's scene and glass cells, past days grayed out.
 */
export function WeekStrip({
  items,
  focus,
  onSelect,
  selectedId,
}: {
  items: CalItem[];
  /** Jump here (e.g. when you pick a plan in the list) */
  focus?: { date: string; nonce: number };
  onSelect: (item: CalItem | null) => void;
  selectedId?: string;
}) {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    if (!focus) return;
    // Jumping to the date of a plan picked in the list (an outside event).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchor(fromDayKey(focus.date));
  }, [focus]);

  const days = useMemo(() => {
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [anchor]);
  const today = dayKey(new Date());
  const mid = days[3];

  return (
    <div className="sk-month sk-weekview" data-month={mid.getMonth()}>
      <div className="sk-mtop">
        <h3 className="sk-mtitle" aria-live="polite">
          {weekTitle(days[0], days[6])}
        </h3>
        <div className="sk-mnav">
          <button
            type="button"
            className="sk-btn is-small is-icon"
            onClick={() => setAnchor((a) => addDays(a, -7))}
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            type="button"
            className="sk-btn is-small"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            className="sk-btn is-small is-icon"
            onClick={() => setAnchor((a) => addDays(a, 7))}
            aria-label="Next week"
          >
            ›
          </button>
        </div>
      </div>
      <div className="sk-wgrid">
        {days.map((d) => {
          const k = dayKey(d);
          const list = items
            .filter((it) => onDay(it, d))
            .sort(
              (a, b) =>
                Number(b.allDay) - Number(a.allDay) ||
                eventStart(a).getTime() - eventStart(b).getTime(),
            );
          return (
            <section
              key={k}
              className={`sk-wday${k === today ? " is-today" : ""}${k < today ? " is-past" : ""}`}
              aria-label={d.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            >
              <header>
                <span>{d.toLocaleDateString([], { weekday: "short" })}</span>
                <b>{d.getDate()}</b>
              </header>
              {list.length ? (
                <ul>
                  {list.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        className={`sk-wit kind-${it.kind}${selectedId === it.id ? " is-selected" : ""}`}
                        style={
                          it.color
                            ? ({ "--ev": it.color } as React.CSSProperties)
                            : undefined
                        }
                        onClick={() => onSelect(it)}
                        title={[
                          it.title,
                          it.allDay ? "All day" : rangeLabel(it),
                          it.sub,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {it.allDay ? null : (
                          <small>{timeLabel(eventStart(it))}</small>
                        )}
                        <span>
                          {it.kind === "bill"
                            ? "$ "
                            : it.kind === "task"
                              ? it.task?.done
                                ? "✓ "
                                : "☐ "
                              : ""}
                          {it.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sk-wnone">—</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
