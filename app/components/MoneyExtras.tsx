"use client";

/**
 * What's filed on a money item, in its pop-out: the letters / notices (files on the Worker, same as focus-card
 * refs) and the payments due on it. Keyed by the Finance link key (`item:<id>`, `own:…`, a sheet line `Randy:<r>:<c>`).
 * Payments also land in the full to-pay list (lib/finFindings findingPaymentDues), so ticking one here or marking
 * it paid there is the same thing.
 */
import { useRef, useState } from "react";
import { Icon } from "../sticker/Icon";
import { docTag, formatSize, openRef, sortRefs, uploadRef, type FocusRef } from "../../lib/focusRefs";
import { findingDueKey, findingOf, setFinding, useFindings, type FindingPayment } from "../../lib/finFindings";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0 });
const md = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const todayKey = () => new Date().toLocaleDateString("en-CA");

/** Small row badges: how many files, and the next unpaid payment. */
export function useExtrasBadge(fkey: string, paidAt: Record<string, string> = {}) {
  const store = useFindings();
  const f = findingOf(store, fkey);
  const files = f?.refs?.length || 0;
  const next = (f?.payments || []).filter((p) => !p.paid && !paidAt[findingDueKey(p)]).sort((a, b) => a.due.localeCompare(b.due))[0];
  return { files, next };
}

export function MoneyExtras({ fkey, label, paidAt = {} }: { fkey: string; label: string; paidAt?: Record<string, string> }) {
  const store = useFindings();
  const f = findingOf(store, fkey);
  const refs = sortRefs(f?.refs || []);
  const pays = [...(f?.payments || [])].sort((a, b) => a.due.localeCompare(b.due));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [amt, setAmt] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const keep = { label: f?.name ? undefined : label };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr("");
    const added: FocusRef[] = [];
    for (const file of Array.from(list)) {
      setBusy(`Uploading ${file.name}…`);
      try {
        added.push(await uploadRef(file));
      } catch (e) {
        setErr(String((e as Error).message || e));
      }
    }
    setBusy("");
    if (added.length) setFinding(fkey, { ...keep, refs: [...(findingOf(store, fkey)?.refs || []), ...added] });
    if (input.current) input.current.value = "";
  };
  const removeRef = (r: FocusRef) => {
    if (!window.confirm(`Take “${r.title}” off ${label}?`)) return;
    setFinding(fkey, { refs: (f?.refs || []).filter((x) => x.id !== r.id) });
  };
  const putPays = (next: FindingPayment[]) => setFinding(fkey, { ...keep, payments: next });
  const addPay = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amt.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setErr("Type an amount and pick a due day.");
      return;
    }
    setErr("");
    putPays([...(f?.payments || []), { id: crypto.randomUUID().slice(0, 8), amount: n, due, ...(note.trim() ? { note: note.trim() } : {}) }]);
    setAmt("");
    setDue("");
    setNote("");
  };
  const isPaid = (p: FindingPayment) => Boolean(p.paid || paidAt[findingDueKey(p)]);

  return (
    <section className="mx-extras" aria-label={`Files and payments for ${label}`}>
      <div className="mx-block">
        <h4>
          Payments due <small className="mb-dim">also in the list of items to pay</small>
        </h4>
        {pays.length ? (
          <ul className="mx-pays">
            {pays.map((p) => {
              const paid = isPaid(p);
              const late = !paid && p.due < todayKey();
              return (
                <li key={p.id} className={paid ? "is-paid" : late ? "is-late" : ""}>
                  <label>
                    <input type="checkbox" checked={paid} disabled={!p.paid && paid} onChange={(e) => putPays((f?.payments || []).map((x) => (x.id === p.id ? { ...x, paid: e.target.checked || undefined } : x)))} />
                    <b>{usd(p.amount)}</b>
                    <span>{paid ? "paid" : late ? "late ·" : "due"} {md(p.due)}</span>
                    {p.note ? <small>{p.note}</small> : null}
                  </label>
                  <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Remove the ${usd(p.amount)} payment`} title="Remove" onClick={() => window.confirm(`Remove the ${usd(p.amount)} payment due ${md(p.due)}?`) && putPays((f?.payments || []).filter((x) => x.id !== p.id))}>
                    <Icon name="close" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-dim mx-empty">No payments set.</p>
        )}
        <form className="mx-payadd" onSubmit={addPay}>
          <input inputMode="decimal" placeholder="$ amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Payment amount" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due day" />
          <input placeholder="Note (minimum, plan…)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Payment note" maxLength={80} />
          <button type="submit" className="sk-btn is-small">
            <Icon name="plus" size={12} /> Add
          </button>
        </form>
      </div>

      <div className="mx-block">
        <h4>Letters &amp; files</h4>
        {refs.length ? (
          <ul className="sk-ref-rows">
            {refs.map((r) => (
              <li key={r.id}>
                <Icon name={r.kind === "link" ? "link" : "file"} size={13} />
                <button type="button" className="sk-fd-taskopen" title="Open it" onClick={() => openRef(r).catch((e) => setErr(String(e.message || e)))}>
                  <span>{r.title}</span>
                  <small>{r.kind === "link" ? r.url : `${docTag(r.title, r.type)} · ${formatSize(r.size)}`}</small>
                </button>
                <span className="sk-ref-tools">
                  <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Remove ${r.title}`} title="Remove" onClick={() => removeRef(r)}>
                    <Icon name="close" size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-dim mx-empty">No letters filed yet.</p>
        )}
        <div className="sk-ref-btns">
          <button type="button" className="sk-btn is-small" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
            <Icon name="plus" size={13} /> Add a letter or file
          </button>
          <input ref={input} type="file" hidden multiple accept="application/pdf,image/*,.heic,.doc,.docx,.txt" onChange={(e) => addFiles(e.target.files)} />
          {busy ? <small className="mb-dim">{busy}</small> : null}
        </div>
      </div>
      {err ? <p className="mx-err" role="alert">{err}</p> : null}
    </section>
  );
}
