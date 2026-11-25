"use client";

import { useState } from "react";
import { addOwnItem, ownItems, removeFinding, setFinding, useFindings, type Finding } from "../../lib/finFindings";
import { ResearchButton } from "./ResearchPanel";
import { openResearch } from "../../lib/research";

const usd = (n?: number | null) =>
  typeof n === "number" ? `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : "";

/**
 * Money › Spend › Purchases › Task-based: things bought for one task or focus (a repair kit for the
 * Power Beats fix…), not wants, needs or restock. Made from a sub-task's 🛒 in the focus / task pop-out;
 * ticking Bought here checks it off there too (same item), and the reverse.
 */
export function useTaskPurchases() {
  const store = useFindings();
  const all = ownItems(store).filter((f) => f.buy && !f.wish);
  return { open: all.filter((f) => !f.paid), bought: all.filter((f) => f.paid) };
}

/** Needs / wants typed on Life Hub (own: items with `wish`), shown under the sheet's Needed / Wants rows. */
export function useWishItems() {
  const store = useFindings();
  const all = ownItems(store).filter((f) => f.wish);
  return { need: all.filter((f) => f.wish === "need"), want: all.filter((f) => f.wish === "want") };
}

/** Life Hub needs or wants (not in the sheet): bought tick, cost, where, research, move to the other list. */
export function WishList({ kind, items }: { kind: "need" | "want"; items: Finding[] }) {
  const [name, setName] = useState("");
  const open = items.filter((f) => !f.paid);
  const bought = items.filter((f) => f.paid);
  const other = kind === "need" ? "want" : "need";
  const add = () => {
    if (!name.trim()) return;
    addOwnItem(name, { buy: true, wish: kind });
    setName("");
  };
  return (
    <div className="tp tp-wish">
      {open.length ? (
        <div className="mtable-wrap">
          <table className="mtable tp-wish-table">
            <tbody>
              {open.map((f) => (
                <WishRow key={f.key} f={f} extra={
                  <>
                    <button type="button" className="sk-btn is-small" title={`Move it to ${other === "need" ? "Needed" : "Wants"}`} onClick={() => setFinding(f.key, { wish: other })}>→ {other === "need" ? "Needed" : "Wants"}</button>
                    <button type="button" className="row-action ghost" aria-label={`Delete ${f.name}`} title="Delete" onClick={() => window.confirm(`Delete ${f.name}?`) && removeFinding(f.key)}>✕</button>
                  </>
                } />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <form className="tp-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "need" ? "＋ Add a need (on Life Hub)" : "＋ Add a want (on Life Hub)"} aria-label={kind === "need" ? "Add a need" : "Add a want"} />
        {name.trim() ? <button type="submit" className="sk-btn is-small">Add</button> : null}
      </form>
      {bought.length ? (
        <details className="tp-done">
          <summary>{bought.length} bought</summary>
          <div className="mtable-wrap"><table className="mtable tp-wish-table"><tbody>{bought.map((f) => <WishRow key={f.key} f={f} />)}</tbody></table></div>
        </details>
      ) : null}
    </div>
  );
}

/** A Life Hub need / want, laid out like the sheet's rows: Bought · item (tap for its details pop-out) · cost · tools. */
function WishRow({ f, extra }: { f: Finding; extra?: React.ReactNode }) {
  const [amt, setAmt] = useState(f.amount != null ? String(f.amount) : "");
  const sub = `Money › Purchases › ${f.wish === "need" ? "Needed" : "Wants"}`;
  const name = f.name || "Untitled";
  return (
    <tr className={f.paid ? "is-struck" : ""}>
      <td className="mtable-check">
        <input type="checkbox" checked={Boolean(f.paid)} aria-label={`Bought: ${name}`} title={f.paid ? "Bought — tap to undo" : "Mark bought"} onChange={(e) => setFinding(f.key, { paid: e.target.checked })} />
      </td>
      <td>
        <button type="button" className="mcell tp-wish-name" title="Open: notes, links and prices" onClick={() => openResearch(f.rkey || f.key, name, sub)}>
          {name}
          {f.where ? <small> · {f.where}</small> : null}
        </button>
      </td>
      <td className="num">
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
          aria-label={`Cost of ${name}`}
        />
      </td>
      <td className="mtable-act">
        <ResearchButton rkey={f.rkey || f.key} title={name} sub={sub} label="Details" />
        {extra}
      </td>
    </tr>
  );
}

function Row({ f, extra }: { f: Finding; extra?: React.ReactNode }) {
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
      <ResearchButton rkey={f.rkey || f.key} title={f.name || "Purchase"} sub={f.wish ? `Money › Purchases › ${f.wish === "need" ? "Needed" : "Wants"}` : `Task purchase${f.task ? ` · ${f.task}` : ""}`} />
      {extra}
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
