"use client";

/**
 * Log what you found about a Finance thing, right from a focus card: the amount, whether a payment plan is
 * available, and its details. Opened from a Finance row's plan tag, or when a research task that "fills" a
 * Finance item is checked off (saving then checks the task off too).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../sticker/Icon";
import { findingOf, PLAN_STATES, removeFinding, setFinding, useFindings, type PlanState } from "../../lib/finFindings";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const num = (s: string) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : undefined;
};

export type FindingTarget = {
  /** Finance link key the plan is logged on (item:, src:, own:) */
  key: string;
  label: string;
  /** Where the amount is saved (one item); none for a group of several tickets */
  amountKey?: string;
  /** Amount Finance has now (null = unknown) */
  amount?: number | null;
  /** What the letters say about a plan, from the debt file */
  onFile?: { state?: string; terms?: string; enroll?: string | null } | null;
};

export function FindingPop({ target, doneTask, onSaved, close }: { target: FindingTarget; doneTask?: string; onSaved?: () => void; close: () => void }) {
  const store = useFindings();
  const f = findingOf(store, target.key);
  const fa = target.amountKey ? findingOf(store, target.amountKey) : undefined;
  const own = target.key.startsWith("own:");
  const startAmount = fa && fa.amount !== undefined ? fa.amount : target.amount;
  const [amount, setAmount] = useState(startAmount == null ? "" : String(startAmount));
  const [plan, setPlan] = useState<PlanState>(f?.plan || (target.onFile?.state === "yes" || target.onFile?.state === "ask" || target.onFile?.state === "none" ? (target.onFile.state as PlanState) : "unknown"));
  const [monthly, setMonthly] = useState(f?.monthly ? String(f.monthly) : "");
  const [months, setMonths] = useState(f?.months ? String(f.months) : "");
  const [down, setDown] = useState(f?.down ? String(f.down) : "");
  const [terms, setTerms] = useState(f?.terms || "");
  const [contact, setContact] = useState(f?.contact || "");
  const [note, setNote] = useState(f?.note || "");
  const [name, setName] = useState(f?.name || target.label);
  const [paid, setPaid] = useState(Boolean(f?.paid));
  const closeNow = useRef(close);
  useEffect(() => {
    closeNow.current = close;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeNow.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const save = () => {
    const a = num(amount);
    const checked = todayStr();
    if (target.amountKey && target.amountKey !== target.key) {
      if (a !== startAmount) setFinding(target.amountKey, { amount: a ?? null, checked });
    }
    setFinding(target.key, {
      ...(own ? { name: name.trim() || target.label, paid } : {}),
      ...(target.amountKey === target.key ? { amount: a ?? null } : {}),
      plan,
      monthly: plan === "yes" ? num(monthly) : undefined,
      months: plan === "yes" ? num(months) : undefined,
      down: plan === "yes" ? num(down) : undefined,
      terms,
      contact,
      note,
      checked,
    });
    onSaved?.();
    close();
  };

  return (
    <div className="sk-subpop-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sk-subpop sk-findpop" role="dialog" aria-modal="true" aria-label={`What you found: ${target.label}`}>
        <header className="sk-subpop-head">
          <Icon name="wallet" size={15} />
          {own ? (
            <input className="sk-subpop-title" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={120} />
          ) : (
            <b className="sk-subpop-title">{target.label}</b>
          )}
          <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={close} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        {doneTask ? <p className="sk-subpop-from">Saving checks off “{doneTask}”.</p> : <p className="sk-subpop-from">What you found — it updates this item everywhere on the focus card.</p>}

        <div className="sk-subpop-row">
          {target.amountKey ? (
            <label className="sk-subpop-field">
              <span className="sk-cap">Amount</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Unknown" aria-label="Amount" data-autofocus />
            </label>
          ) : (
            <p className="sk-fd-hint">Amount comes from its tickets — open one to change it.</p>
          )}
          {own ? (
            <label className="sk-findpop-check">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Paid
            </label>
          ) : null}
        </div>

        <label className="sk-subpop-field">
          <span className="sk-cap">Payment plan</span>
          <select value={plan} onChange={(e) => setPlan(e.target.value as PlanState)} aria-label="Payment plan">
            {PLAN_STATES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {target.onFile?.terms ? <p className="sk-fd-hint">On file: {target.onFile.terms}{target.onFile.enroll ? ` · ${target.onFile.enroll}` : ""}</p> : null}
        {plan === "yes" ? (
          <div className="sk-subpop-row sk-findpop-nums">
            <label className="sk-subpop-field">
              <span className="sk-cap">Monthly $</span>
              <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label="Monthly payment" />
            </label>
            <label className="sk-subpop-field">
              <span className="sk-cap">Months</span>
              <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Number of months" />
            </label>
            <label className="sk-subpop-field">
              <span className="sk-cap">Down $</span>
              <input inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} aria-label="Down payment" />
            </label>
          </div>
        ) : null}
        {plan !== "unknown" ? (
          <label className="sk-subpop-field">
            <span className="sk-cap">Plan terms / what they said</span>
            <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. no interest, auto-pay required, fee is waived" maxLength={240} />
          </label>
        ) : null}
        <label className="sk-subpop-field">
          <span className="sk-cap">Who / where</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone, site, person you talked to" maxLength={200} />
        </label>
        <label className="sk-subpop-field">
          <span className="sk-cap">Notes</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything else you found" />
        </label>
        <div className="sk-subpop-row">
          {own ? (
            <button
              type="button"
              className="sk-btn is-small is-quiet"
              onClick={() => {
                if (window.confirm(`Delete “${name || target.label}”? It comes off every list.`)) {
                  removeFinding(target.key);
                  close();
                }
              }}
            >
              Delete item
            </button>
          ) : null}
          <button type="button" className="sk-btn is-small is-quiet" onClick={close}>
            Cancel
          </button>
          <button type="button" className="sk-btn is-small is-on" onClick={save}>
            {doneTask ? "Save + check off" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
