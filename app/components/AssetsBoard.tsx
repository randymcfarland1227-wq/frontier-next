/**
 * Balances → Assets: the Toyota, Ableton and the phone — what's paid, what's owed, payments left,
 * payoff date, (car) value + equity, and tasks / notes. Progress comes from the same Paid marks as the
 * rest of Money (lib/assets.ts), so a payment marked Paid anywhere moves it. Tasks are the SAME items as
 * Current liabilities (Outstanding): links to their line keys, checked off with the same marks.
 */

import { useState } from 'react';
import { FinanceDrawer as Modal, FinanceName, FinanceType } from './FinanceDrawer';
import { loanRows, type LoanRow } from './MoneyBoards';
import { outstandingParts, type OwedLine } from './OutstandingView';
import { ASSETS, assetKey, loanSeenKey, assetProgress, duePrefix, paidMonths, pct, planTerms, type AssetDef, type AssetId, type AssetProgress } from '../../lib/assets';
import { metaName, setMeta, useMoneyMeta, type MetaEntry } from '../../lib/moneyMeta';
import { fromDayKey, money, type BillDue } from '../../lib/schedule';
import type { MoneyModel } from '../../lib/money';
import { isLedgerPaid } from '../../lib/moneyLedger';
import { useDebtFile } from '../../lib/debtFile';
import { setOwedDone, useOwedDone } from '../../lib/owedComplete';
import { addOwnItem, setFinding } from '../../lib/finFindings';

type Get = (key: string) => MetaEntry | undefined;
type Parts = ReturnType<typeof outstandingParts>;

export type AssetView = {
  def: AssetDef;
  meta?: MetaEntry;
  loan?: LoanRow;
  prefix?: string;
  billName?: string;
  payment?: number;
  total?: number;
  /** Where the balance comes from */
  balFrom?: 'sheet' | 'typed';
  bal?: number;
  asOf?: string;
  start?: string;
  progress: AssetProgress;
  nextDue?: BillDue;
  history: Array<{ month: string; due: string }>;
  value?: number;
  equity?: number;
  links: string[];
};

const today = () => new Date().toLocaleDateString('en-CA');
/** A typed day stays as is; a sheet-change time becomes its local day. */
const localDay = (v?: string) => (v && v.length > 10 ? new Date(v).toLocaleDateString('en-CA') : v);
const shortDate = (d?: string) => (d ? fromDayKey(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const monthYear = (d?: string) => (d ? fromDayKey(d).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '—');
const nameOf = (d: BillDue) => d.bill.nameBeforeLabel ?? d.bill.origName ?? d.bill.name;
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/[$,]/g, '')));

/** The repair rows of Current liabilities (sheet "Repair" table): the Toyota's tasks until Randy picks his own. */
function repairKeys(model: MoneyModel): string[] {
  const t = model.nonCredit.find(x => /repair/i.test(x.title));
  return (t?.rows || []).filter(r => r.some(c => c.text.trim())).map(r => `${r[0].tab}:${r[0].r}`);
}

/** Bills / subs / pay laters in the ledger, one per payment series, for the phone's "paid by" picker. */
export function billSeries(dues: BillDue[]): Array<{ prefix: string; name: string; amount?: number; kind: string }> {
  const seen = new Map<string, { prefix: string; name: string; amount?: number; kind: string }>();
  for (const d of dues) {
    const p = duePrefix(d.key);
    if (!p.startsWith('money:') || seen.has(p)) continue;
    seen.set(p, { prefix: p, name: nameOf(d), amount: d.bill.amount, kind: d.bill.kind || 'bill' });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function assetViews(model: MoneyModel, dues: BillDue[], monthDues: BillDue[], paidAt: Record<string, string>, get: Get): AssetView[] {
  const all = [...dues, ...monthDues];
  const loans = loanRows(model, monthDues, get);
  return ASSETS.map(def => {
    const meta = get(assetKey(def.id));
    const loan = def.loan ? loans.find(l => metaName(l.name) === metaName(def.loan!)) : undefined;
    // Which payment series pays it off: the loan's bill, a typed pick (phone), else the first bill whose name matches.
    const match = all.find(d => def.bill && def.bill.test(nameOf(d)));
    const prefix = meta?.billKey || (loan?.due ? duePrefix(loan.due.key) : match ? duePrefix(match.key) : undefined);
    const series = prefix ? all.filter(d => duePrefix(d.key) === prefix).sort((a, b) => a.due.localeCompare(b.due)) : [];
    const nextDue = series.find(d => !isLedgerPaid(d, paidAt) && !d.skipped);
    const missed = series.filter(d => d.days < 0 && !isLedgerPaid(d, paidAt) && !d.skipped).map(d => d.due.slice(0, 7));
    const history = prefix ? paidMonths(prefix, paidAt, all) : [];
    const plan = def.plan ? model.plans.find(p => def.plan!.test(p.title)) : undefined;
    const terms = plan ? planTerms(plan.title, plan.rows) : {};
    const payment = meta?.payment ?? loan?.payment ?? series[0]?.bill.amount ?? terms.payment;
    const total = meta?.total ?? loan?.principal ?? terms.total;
    const typedBal = meta?.bal;
    const bal = typedBal ?? (loan && !loan.hub ? loan.bal : undefined);
    const balFrom: AssetView['balFrom'] = typedBal !== undefined ? 'typed' : bal !== undefined ? 'sheet' : undefined;
    const asOf = meta?.asOf ?? (loan && !loan.hub ? get(loanSeenKey(loan.name))?.seenAt : undefined);
    const start = meta?.start ?? terms.start;
    const history0 = prefix ? paidMonths(prefix, paidAt, all) : [];
    // No upcoming bill in the sheet yet (e.g. only last month's Verizon): take the due day from the paid history.
    const dueDay = series[0] ? Number(series[0].due.slice(8, 10)) : history0.length ? Number(history0[history0.length - 1].due.slice(8, 10)) : undefined;
    const progress = assetProgress({
      total,
      payment,
      bal,
      asOf,
      paymentsLeft: meta?.paymentsLeft ?? loan?.paymentsLeft,
      start,
      dueDay,
      nextDue: nextDue?.due,
      paid: history,
      missed,
    });
    const value = def.vehicle ? meta?.value : undefined;
    return {
      def,
      meta,
      loan,
      prefix,
      billName: series[0] ? nameOf(series[0]) : undefined,
      payment,
      total,
      balFrom,
      bal,
      asOf,
      start,
      progress,
      nextDue,
      history,
      value,
      equity: value !== undefined && progress.owed !== undefined ? value - progress.owed : undefined,
      links: meta?.links ?? (def.vehicle ? repairKeys(model) : []),
    };
  });
}

export function useAssetViews(model: MoneyModel, dues: BillDue[], monthDues: BillDue[], paidAt: Record<string, string>): AssetView[] {
  const { get } = useMoneyMeta();
  return assetViews(model, dues, monthDues, paidAt, get);
}

/** Every Current liabilities line, labelled with its column (for linking). */
function owedLines(parts: Parts): Array<OwedLine & { group: string }> {
  const groups: Array<[string, OwedLine[]]> = [
    ['Projects / required', parts.projects],
    ['Taxes / legal', parts.taxes],
    ['Cash advances', [...parts.cashAdv, ...parts.advances]],
    ['Pay laters', parts.payLater],
  ];
  return groups.flatMap(([group, xs]) => xs.map(x => ({ ...x, group })));
}

function Bar({ p }: { p: AssetProgress }) {
  return (
    <div className="skm-as-bar" role="img" aria-label={p.paidPct !== undefined ? `${pct(p.paidPct)} paid off` : 'Progress unknown — add the amounts'}>
      <span style={{ width: `${Math.max(0, Math.min(100, p.paidPct ?? 0))}%` }} />
    </div>
  );
}

/** The figures every asset shows, in the pop-out and on the board. */
function Figs({ a }: { a: AssetView }) {
  const p = a.progress;
  return (
    <div className="mb-cp-figs skm-as-figs">
      <span><small>paid</small><b>{p.paidAmt !== undefined ? money(p.paidAmt) : '—'}</b><em>{pct(p.paidPct)}</em></span>
      <span><small>still owed</small><b>{p.owed !== undefined ? money(p.owed) : '—'}</b><em>{pct(p.owedPct)}</em></span>
      <span><small>payments left</small><b>{p.left ?? '—'}</b><em>{a.payment ? `${money(a.payment)}/mo` : 'payment ?'}</em></span>
      <span><small>payoff (est.)</small><b>{monthYear(p.payoff)}</b><em className={a.nextDue && a.nextDue.days < 0 ? 'is-late' : ''}>{a.nextDue ? `${a.nextDue.days < 0 ? 'overdue' : 'next'} ${shortDate(a.nextDue.due).replace(/, \d{4}$/, '')}` : p.left === 0 ? 'paid off' : '—'}</em></span>
      {a.def.vehicle ? (
        <>
          <span><small>car value</small><b>{a.value !== undefined ? money(a.value) : '—'}</b><em>{a.meta?.valueAt ? `as of ${shortDate(a.meta.valueAt).replace(/, \d{4}$/, '')}` : 'type it below'}</em></span>
          <span><small>equity</small><b className={a.equity !== undefined && a.equity < 0 ? 'is-neg' : ''}>{a.equity !== undefined ? money(a.equity) : '—'}</b><em>value − owed</em></span>
        </>
      ) : null}
    </div>
  );
}

function Missing({ a }: { a: AssetView }) {
  const need: string[] = [];
  if (a.total === undefined) need.push(a.def.vehicle ? 'original loan amount' : 'total financed');
  if (!a.payment) need.push('monthly payment');
  if (a.bal === undefined && !a.start) need.push('balance today (or first payment month)');
  if (!a.prefix) need.push('which bill pays it');
  return need.length ? <p className="skm-as-need">Needs: {need.join(' · ')}</p> : null;
}

/** Balances → Assets */
export function AssetsBoard({ model, dues, monthDues, paidAt, parts, onOpen }: { model: MoneyModel; dues: BillDue[]; monthDues: BillDue[]; paidAt: Record<string, string>; parts: Parts; onOpen: (a: AssetView) => void }) {
  const views = useAssetViews(model, dues, monthDues, paidAt);
  const lines = owedLines(parts);
  const owed = views.reduce((t, a) => t + (a.progress.owed || 0), 0);
  return (
    <section className="sk-group tone-save skm-sec" aria-label="Assets">
      <header className="sk-ghead skm-head">
        <div className="skm-titles">
          <h2 className="sk-hl">Assets</h2>
          <p className="sk-sec skm-hint">Things you own that are still being paid off. Mark a payment Paid anywhere and these move.</p>
        </div>
        <div className="skm-fig"><b>{money(owed)}</b><small>still owed</small></div>
      </header>
      <div className="sk-gbody skm-body">
        <div className="skm-as-grid">
          {views.map(a => {
            const open = a.links.map(k => lines.find(l => l.key === k || l.rowKey === k)).filter((l): l is OwedLine & { group: string } => !!l && !l.done);
            return (
              <button key={a.def.id} type="button" className={`skm-as-card is-${a.def.id}`} onClick={() => onOpen(a)} aria-label={`${a.def.name} details`}>
                <span className="skm-as-top">
                  <b className="skm-as-name">{a.def.name}</b>
                  <small>{a.meta?.name || a.def.what}</small>
                  <span className="skm-as-owed">{a.progress.owed !== undefined ? money(a.progress.owed) : 'enter amount'}</span>
                </span>
                <Bar p={a.progress} />
                <Figs a={a} />
                {open.length ? (
                  <span className="skm-as-tasks">
                    {open.slice(0, 3).map(l => (
                      <span key={l.key}>◻ {l.name}{l.amount ? ` · ${money(l.amount)}` : ''}</span>
                    ))}
                    {open.length > 3 ? <span>+{open.length - 3} more</span> : null}
                  </span>
                ) : null}
                {a.meta?.note ? <span className="skm-as-note">{a.meta.note}</span> : null}
                <Missing a={a} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Tasks (linked Current liabilities lines) + notes. The same item is checked off here and there. */
function AssetTasks({ a, model, monthDues, paidAt }: { a: AssetView; model: MoneyModel; monthDues: BillDue[]; paidAt: Record<string, string> }) {
  const debt = useDebtFile();
  const owedDone = useOwedDone();
  const parts = outstandingParts(model, debt.file, debt.marks, monthDues, paidAt, owedDone);
  const lines = owedLines(parts);
  const [name, setName] = useState('');
  const [amt, setAmt] = useState('');
  const key = assetKey(a.def.id);
  const save = (links: string[]) => setMeta(key, { links });
  const linked = a.links.map(k => lines.find(l => l.key === k || l.rowKey === k) || { key: k, name: 'Item no longer in Current liabilities', group: '', gone: true });
  const free = lines.filter(l => !a.links.includes(l.key) && !l.done);
  const toggle = (l: OwedLine) => {
    if (l.key.startsWith('own:')) setFinding(l.key, { paid: !l.done || undefined });
    else if (!l.itemId) {
      setOwedDone(l.key, !l.done, l.recurring);
      if (l.done && l.legacyKey) setOwedDone(l.legacyKey, false);
    }
  };
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const k = addOwnItem(n, { amount: num(amt) ?? null, note: `${a.def.name} task`, group: 'project' });
    save([...a.links, k]);
    setName('');
    setAmt('');
  };
  const note = a.meta?.note || '';
  return (
    <section className="bal-drw-sec skm-as-sec">
      <h4>Tasks <small className="mb-dim">same items as Current liabilities</small></h4>
      {linked.length ? (
        <ul className="skm-as-list">
          {linked.map(l => {
            const line = 'gone' in l ? undefined : (l as OwedLine & { group: string });
            const canCheck = line && (!line.itemId || line.key.startsWith('own:'));
            return (
              <li key={l.key} className={line?.done ? 'is-done' : ''}>
                {canCheck ? (
                  <button type="button" className="sk-btn is-small ob-check" onClick={() => toggle(line!)} aria-label={`${line!.done ? 'Reopen' : 'Complete'} ${line!.name}`}>{line!.done ? '↩' : '✓'}</button>
                ) : (
                  <span className="skm-as-dot" />
                )}
                <span className="skm-as-lname">{l.name}</span>
                <small>{line ? `${line.group}${line.amount ? ` · ${money(line.amount)}` : ''}` : ''}</small>
                <button type="button" className="skm-as-x" onClick={() => save(a.links.filter(k => k !== l.key))} aria-label={`Unlink ${l.name}`} title="Unlink (stays in Current liabilities)">✕</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mny-empty">No tasks linked yet.</p>
      )}
      <div className="skm-as-add">
        <select value="" onChange={e => e.target.value && save([...a.links, e.target.value])} aria-label="Link an item from Current liabilities">
          <option value="">Link an item from Current liabilities…</option>
          {free.map(l => (
            <option key={l.key} value={l.key}>{l.group}: {l.name}{l.amount ? ` (${money(l.amount)})` : ''}</option>
          ))}
        </select>
      </div>
      <div className="skm-as-add">
        <input type="text" value={name} placeholder="New task (adds to Projects / required too)" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} aria-label="New task" />
        <input type="text" inputMode="decimal" value={amt} placeholder="$ cost" onChange={e => setAmt(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} aria-label="Cost" className="is-amt" />
        <button type="button" className="sk-btn is-small" onClick={add} disabled={!name.trim()}>Add</button>
      </div>
      <h4>Notes</h4>
      <textarea
        key={`${key}:${note}`}
        className="mb-cp-note"
        rows={2}
        defaultValue={note}
        placeholder={a.def.vehicle ? 'Mileage, insurance, what the dealer said…' : 'Anything to remember'}
        aria-label={`${a.def.name} notes`}
        onBlur={e => e.target.value.trim() !== note && setMeta(key, { note: e.target.value.trim() || undefined })}
      />
    </section>
  );
}

/**
 * The asset part of a pop-out: progress, figures, the hand-typed fields, tasks + notes.
 * The Toyota's loan pop-out shows this too (one pop-out, not two).
 */
export function AssetBlock({ id, model, dues, monthDues, paidAt }: { id: AssetId; model: MoneyModel; dues: BillDue[]; monthDues: BillDue[]; paidAt: Record<string, string> }) {
  const { get } = useMoneyMeta();
  const a = assetViews(model, dues, monthDues, paidAt, get).find(x => x.def.id === id)!;
  const key = assetKey(id);
  const all = [...dues, ...monthDues];
  const series = billSeries(all);
  const p = a.progress;
  const balLine =
    p.mode === 'balance'
      ? `${a.balFrom === 'sheet' ? 'Sheet balance' : 'Balance you typed'} ${money(a.bal)}${a.asOf ? ` (${a.balFrom === 'sheet' ? 'changed' : 'as of'} ${shortDate(localDay(a.asOf))})` : ''}${p.paidSince ? ` − ${p.paidSince} payment${p.paidSince === 1 ? '' : 's'} marked paid since` : ' · no payments marked paid since'}`
      : p.mode === 'schedule'
        ? `${p.made} of ${(p.made || 0) + (p.left || 0)} payments made since ${monthYear(`${a.start}-01`)} (earlier months count as paid unless one is overdue)`
        : 'Add the amounts below to see progress.';
  return (
    <>
      <Bar p={p} />
      <Figs a={a} />
      <p className="mb-dim skm-as-how">{balLine}</p>
      <Missing a={a} />
      <h4 className="mb-cp-h">Yours to edit</h4>
      <div className="mb-cp-edit" key={`${a.meta?.at || ''}`}>
        {a.def.vehicle ? (
          <label>Car value today $<input type="number" step="1" defaultValue={a.value ?? ''} placeholder="enter amount" onBlur={e => { const v = num(e.target.value); if (v !== a.value) setMeta(key, { value: v, valueAt: v === undefined ? undefined : today() }); }} /></label>
        ) : null}
        {!a.loan ? (
          <>
            <label>Total financed $<input type="number" step="0.01" defaultValue={a.meta?.total ?? ''} placeholder={a.total !== undefined ? `${a.total} (sheet)` : 'enter amount'} onBlur={e => setMeta(key, { total: num(e.target.value) })} /></label>
            <label>Monthly payment $<input type="number" step="0.01" defaultValue={a.meta?.payment ?? ''} placeholder={a.payment !== undefined ? `${a.payment} (ledger)` : 'enter amount'} onBlur={e => setMeta(key, { payment: num(e.target.value) })} /></label>
            <label>First payment month<input type="month" defaultValue={a.meta?.start ?? ''} placeholder={a.start} onBlur={e => setMeta(key, { start: e.target.value || undefined })} /></label>
            <label>Payments left (today)<input type="number" step="1" defaultValue={a.meta?.paymentsLeft ?? ''} placeholder="optional" onBlur={e => { const v = num(e.target.value); if (v !== a.meta?.paymentsLeft) setMeta(key, { paymentsLeft: v, asOf: today() }); }} /></label>
          </>
        ) : null}
        <label>Balance owed today ${a.loan ? ' (overrides sheet)' : ''}<input type="number" step="0.01" defaultValue={a.meta?.bal ?? ''} placeholder={a.balFrom === 'sheet' ? `${a.bal} (sheet)` : 'enter amount'} onBlur={e => { const v = num(e.target.value); if (v !== a.meta?.bal) setMeta(key, { bal: v, asOf: v === undefined ? a.meta?.asOf : today() }); }} /></label>
        <label>Balance &amp; payments left true as of<input type="date" defaultValue={localDay(a.asOf) ?? ''} onBlur={e => e.target.value !== (localDay(a.asOf) ?? '') && setMeta(key, { asOf: e.target.value || undefined })} /></label>
        {!a.loan ? (
          <label className="is-wide">Paid by (ledger bill)
            <select className="mb-cp-sel" defaultValue={a.meta?.billKey ?? a.prefix ?? ''} onChange={e => setMeta(key, { billKey: e.target.value || undefined })}>
              <option value="">{a.prefix ? `Auto: ${a.billName}` : 'Not set'}</option>
              {series.map(s => (
                <option key={s.prefix} value={s.prefix}>{s.name}{s.amount ? ` · ${money(s.amount)}` : ''} ({s.kind})</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <AssetTasks a={a} model={model} monthDues={monthDues} paidAt={paidAt} />
    </>
  );
}

/** Pop-out for Ableton / the phone (the Toyota uses its loan pop-out, which shows AssetBlock). */
export function AssetPanel({ id, model, dues, monthDues, paidAt, onPaid, onBack, onClose }: { id: AssetId; model: MoneyModel; dues: BillDue[]; monthDues: BillDue[]; paidAt: Record<string, string>; onPaid: (d: BillDue) => void; onBack?: () => void; onClose: () => void }) {
  const { get } = useMoneyMeta();
  const a = assetViews(model, dues, monthDues, paidAt, get).find(x => x.def.id === id);
  if (!a) return null;
  return (
    <Modal label={a.def.name} onClose={onClose} onBack={onBack}>
      <div className="bal-drw-head">
        <FinanceType>Asset · financed</FinanceType>
        <FinanceName name={a.def.name} />
        <p className="mb-dim">{a.meta?.name || a.def.what}{a.billName ? ` · paid by ${a.billName}` : ''}</p>
      </div>
      <AssetBlock id={id} model={model} dues={dues} monthDues={monthDues} paidAt={paidAt} />
      {a.history.length ? (
        <section className="bal-drw-sec">
          <h4>Paid</h4>
          <p className="skm-as-paid">{a.history.slice(-12).map(h => <span key={h.month}>✓ {shortDate(h.due).replace(/, \d{4}$/, '')}</span>)}</p>
        </section>
      ) : null}
      <div className="bal-dlg-actions">
        {a.nextDue ? (
          <button type="button" className="sk-btn is-small is-prominent" onClick={() => onPaid(a.nextDue!)}>
            Mark {shortDate(a.nextDue.due).replace(/, \d{4}$/, '')} paid{a.nextDue.bill.amount ? ` · ${money(a.nextDue.bill.amount)}` : ''}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

