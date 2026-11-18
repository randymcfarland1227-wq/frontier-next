"use client";

import { useMemo, useState } from "react";
import { addSelfItems, type SelfItem } from "../../lib/adapters/self";
import { MOVE_TARGETS } from "../../lib/siteMoves";
import { parseBulkLine } from "../../lib/bulkAdd";

/**
 * Self › Bulk add: paste or type several tasks, one per line. Each line can go to another site
 * (pick it per line, or end the line with @resale / start it with "Role:"); after adding, those tasks
 * move to that site's card right away — the same move as a row's Move to….
 */
export function BulkAdd({ onDone }: { onDone: (items: SelfItem[], summary: string) => void }) {
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState("self");
  const [picked, setPicked] = useState<Record<number, string>>({});
  const lines = useMemo(() => text.split("\n").map(parseBulkLine).map((l, i) => ({ ...l, i })).filter((l) => l.title), [text]);
  const homeOf = (l: { i: number; home?: string }) => picked[l.i] || l.home || fallback;
  const add = () => {
    if (!lines.length) return;
    const list = lines.map((l) => ({ title: l.title, home: homeOf(l) }));
    const items = addSelfItems(list);
    const counts = new Map<string, number>();
    for (const x of list) counts.set(x.home, (counts.get(x.home) || 0) + 1);
    const summary = [...counts].map(([h, n]) => `${n} → ${MOVE_TARGETS.find(([id]) => id === h)?.[1] || h}`).join(" · ");
    setText("");
    setPicked({});
    onDone(items, summary);
  };
  return (
    <div className="sk-bulk">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"One task per line. Pick a site for each below, or tag it:\nFinish Vinted listings @resale\nRole: follow up with recruiter"}
        aria-label="Tasks to add, one per line"
      />
      {lines.length ? (
        <ul aria-label="Where each task goes">
          {lines.map((l) => (
            <li key={l.i}>
              <span>{l.title}</span>
              <select value={homeOf(l)} onChange={(e) => setPicked({ ...picked, [l.i]: e.target.value })} aria-label={`Site for ${l.title}`}>
                {MOVE_TARGETS.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sk-bulk-foot">
        <button type="button" className="sk-btn is-small" disabled={!lines.length} onClick={add}>
          Add {lines.length || ""} task{lines.length === 1 ? "" : "s"}
        </button>
        <label>
          <small>Untagged lines go to </small>
          <select value={fallback} onChange={(e) => setFallback(e.target.value)} aria-label="Site for untagged lines">
            {MOVE_TARGETS.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
