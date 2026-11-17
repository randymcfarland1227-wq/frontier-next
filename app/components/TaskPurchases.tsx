"use client";

import { useState } from "react";
import { ownItems, setFinding, useFindings, type Finding } from "../../lib/finFindings";

const usd = (n?: number | null) =>
  typeof n === "number" ? `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : "";

/**
 * Money › Spend › Purchases › Task-based: things bought for one task or focus (a repair kit for the
 * Power Beats fix…), not wants, needs or restock. Made from a sub-task's 🛒 in the focus / task pop-out;
 * ticking Bought here checks it off there too (same item), and the reverse.
 */
export function useTaskPurchases() {
  const store = useFindings();
  const all = ownItems(store).filter((f) => f.buy);
  return { open: all.filter((f) => !f.paid), bought: all.filter((f) => f.paid) };
}

function Row({ f }: { f: Finding }) {
  const [amt, setAmt] = useState(f.amount != null ? String(f.amount) : "");
  const [where, setWhere] = useState(f.where || "");
  return (
    <li className={`tp-row${f.paid ? " is-bought" : ""}`}>
      <label className="tp-check" title={f.paid ? "Bought — tap to undo" : "Mark bought (checks it off in the task too)"}>
        <input type="checkbox" checked={Boolean(f.paid)} onChange={(e) => setFinding(f.key, { paid: e.target.checked })} />
        <span>{f.name}</span>
      </label>
      <input
        className="tp-amt"
        inputMode="decimal"
        placeholder="$ cost"
        value={amt}
        onChange={(e) => setAmt(e.target.value)}
        onBlur={() => {
          const n = Number(amt.replace(/[^0-9.]/g, ""));
          setFinding(f.key, { amount: amt.trim() && Number.isFinite(n) ? n : null });
        }}
        aria-label={`Cost of ${f.name}`}
      />
      <input
        className="tp-where"
        placeholder="Where (store / link)"
        value={where}
        onChange={(e) => setWhere(e.target.value)}
        onBlur={() => setFinding(f.key, { where: where.trim() || undefined })}
        aria-label={`Where to buy ${f.name}`}
      />
    </li>
  );
}

export function TaskPurchaseList({ items }: { items: Finding[] }) {
  const groups = new Map<string, Finding[]>();
  for (const f of items) {
    const k = f.task || "Other tasks";
    groups.set(k, [...(groups.get(k) || []), f]);
  }
  if (!items.length) return <p className="mny-empty">Nothing yet. In a task or focus pop-out, tap 🛒 on a sub-task to add it here.</p>;
  return (
    <div className="tp">
      {[...groups].map(([task, list]) => (
        <div key={task} className="tp-group">
          <div className="tp-task">
            <span>🛒 {task}</span>
            <b>{usd(list.reduce((s, f) => s + (f.amount || 0), 0))}</b>
          </div>
          <ul>
            {list.map((f) => (
              <Row key={f.key} f={f} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
