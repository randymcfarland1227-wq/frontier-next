'use client';

import { useState } from 'react';
import type { CellEdit, EditResult } from '../../lib/money';

type Save = (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cents = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
};

function useRun(onSave: Save) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (edits: CellEdit[], soft = 0) => {
    setBusy(true);
    setErr('');
    const res = await onSave(edits);
    setBusy(false);
    // The first edits must land; the last `soft` ones (a provider's copy table) may be missing without failing.
    const must = res.results.slice(0, res.results.length - soft);
    const bad = !res.ok || must.length < edits.length - soft || must.some(x => !x.ok);
    if (bad) setErr(`The sheet didn’t take it (${res.error || must.find(x => !x.ok)?.error || 'error'}). Nothing was saved on Life Hub; check the sheet and try again.`);
    return !bad;
  };
  return { busy, err, run };
}

/** "+ Add cash advance": writes a row to the Cash Advances block on the Randy tab (logged on "Life Hub edits"). */
export function CashAdvanceAdd({ onSave }: { onSave: Save }) {
  const [open, setOpen] = useState(false);
  const blank = { name: '', amount: '', due: today() };
  const [f, setF] = useState(blank);
  const { busy, err, run } = useRun(onSave);
  if (!open)
    return (
      <div className="tp-add">
        <button type="button" className="sk-btn is-small is-prominent" onClick={() => setOpen(true)}>+ Add cash advance</button>
      </div>
    );
  return (
    <form
      className="sub-form"
      onSubmit={async e => {
        e.preventDefault();
        const amount = cents(f.amount);
        if (!f.name.trim() || !amount || !f.due) return;
        const ok = await run([{ tab: 'Randy', addRows: true, title: 'Cash Advances', width: 3, moveWidth: 4, rows: [[f.due, f.name.trim(), amount]] }]);
        if (ok) {
          setF(blank);
          setOpen(false);
        }
      }}
      onKeyDown={e => e.key === 'Escape' && setOpen(false)}
    >
      <label className="sub-form-wide">
        <span>Who</span>
        <input autoFocus list="cash-adv-names" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Dave, MoneyLion, Cleo…" required />
        <datalist id="cash-adv-names">
          {['Dave', 'MoneyLion', 'Cleo', 'Brigit', 'EarnIn', 'Klover', 'Albert', 'Chime SpotMe'].map(n => <option key={n} value={n} />)}
        </datalist>
      </label>
      <label><span>Pay back</span><input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="$" required /></label>
      <label><span>Due</span><input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} required /></label>
      <div className="sub-form-actions">
        <button type="submit" className="sk-btn is-small is-prominent" disabled={busy}>{busy ? 'Adding…' : 'Add to sheet'}</button>
        <button type="button" className="sk-btn is-small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err ? <p className="mb-late sub-form-wide" style={{ gridColumn: '1 / -1' }}>{err}</p> : null}
    </form>
  );
}

const PROVIDERS = ['Klarna', 'Afterpay', 'Affirm', 'Zip'] as const;
/** Providers with their own copy table on the Paylater tab (titled "<Provider> Sum"); Afterpay's total reads the ledger. */
const COPY_TABLE: Record<string, boolean> = { Klarna: true, Affirm: true, Zip: true };

function addStep(iso: string, i: number, every: 'week2' | 'month'): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = every === 'month' ? new Date(y, m - 1 + i, 1) : new Date(y, m - 1, d + 14 * i);
  if (every === 'month') at.setDate(Math.min(d, new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()));
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/**
 * "+ Add pay later": one row per payment left in the Paylater tab's Full Ledger, and the same rows in that
 * provider's table (Klarna / Affirm / Zip are copies of the ledger, so both get them).
 */
export function PayLaterAdd({ onSave }: { onSave: Save }) {
  const [open, setOpen] = useState(false);
  const blank = { name: '', provider: 'Klarna', amount: '', count: '4', from: '1', first: today(), every: 'week2' as 'week2' | 'month' };
  const [f, setF] = useState(blank);
  const { busy, err, run } = useRun(onSave);
  const count = Math.max(1, Math.min(12, Number(f.count) || 1));
  const from = Math.max(1, Math.min(count, Number(f.from) || 1));
  const amount = cents(f.amount);
  const rows = Array.from({ length: count - from + 1 }, (_, i) => [addStep(f.first, i, f.every), f.name.trim(), `${from + i} of ${count}`, amount, f.provider]);
  if (!open)
    return (
      <div className="tp-add">
        <button type="button" className="sk-btn is-small is-prominent" onClick={() => setOpen(true)}>+ Add pay later</button>
      </div>
    );
  return (
    <form
      className="sub-form"
      onSubmit={async e => {
        e.preventDefault();
        if (!f.name.trim() || !amount || !f.first) return;
        const edits: CellEdit[] = [{ tab: 'Paylater', addRows: true, title: 'Full Ledger', width: 5, rows }];
        if (COPY_TABLE[f.provider]) edits.push({ tab: 'Paylater', addRows: true, title: `${f.provider} Sum`, width: 5, rows });
        if (await run(edits, edits.length - 1)) {
          setF(blank);
          setOpen(false);
        }
      }}
      onKeyDown={e => e.key === 'Escape' && setOpen(false)}
    >
      <label className="sub-form-wide"><span>Purchase</span><input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Amazon, Instacart…" required /></label>
      <label>
        <span>Provider</span>
        <select value={f.provider} onChange={e => setF({ ...f, provider: e.target.value, every: e.target.value === 'Affirm' ? 'month' : 'week2' })}>
          {PROVIDERS.map(p => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label><span>Each payment</span><input inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="$" required /></label>
      <label><span>Payments in all</span><input type="number" min={1} max={12} value={f.count} onChange={e => setF({ ...f, count: e.target.value })} /></label>
      <label><span>Next one is #</span><input type="number" min={1} max={count} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
      <label><span>Next one due</span><input type="date" value={f.first} onChange={e => setF({ ...f, first: e.target.value })} required /></label>
      <label>
        <span>Then every</span>
        <select value={f.every} onChange={e => setF({ ...f, every: e.target.value as 'week2' | 'month' })}>
          <option value="week2">2 weeks</option>
          <option value="month">month</option>
        </select>
      </label>
      {amount && f.name.trim() ? (
        <p className="mb-dim" style={{ gridColumn: '1 / -1', margin: 0 }}>
          Adds {rows.length} row{rows.length === 1 ? '' : 's'}: {rows.map(r => `${r[0].slice(5).replace('-', '/')} (${r[2]})`).join(', ')} · ${amount} each
          {COPY_TABLE[f.provider] ? `, to the Full Ledger and the ${f.provider} table` : ', to the Full Ledger'}.
        </p>
      ) : null}
      <div className="sub-form-actions">
        <button type="submit" className="sk-btn is-small is-prominent" disabled={busy}>{busy ? 'Adding…' : 'Add to sheet'}</button>
        <button type="button" className="sk-btn is-small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err ? <p className="mb-late sub-form-wide" style={{ gridColumn: '1 / -1' }}>{err}</p> : null}
    </form>
  );
}
