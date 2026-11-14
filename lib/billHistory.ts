/**
 * Payment history for one bill / subscription / loan payment: every occurrence Life Hub can see —
 * this and later months (dues), every row in the sheet (struck = paid), and every Mark paid tap
 * (paidAt, with the amount recorded in money meta `paid:<key>` from 2026-11-04 on).
 */
import type { BillDue } from './schedule';
import type { MoneyItem } from './money';
import type { MetaEntry } from './moneyMeta';

export type HistoryRow = {
  key: string;
  /** Due date YYYY-MM-DD */
  due: string;
  amount?: number;
  /** When Mark paid was tapped (ISO) */
  paidOn?: string;
  state: 'paid' | 'crossed' | 'open' | 'skipped';
};

export type BillHistory = {
  rows: HistoryRow[];
  lastPaid?: HistoryRow;
  /** Most common amount over the known payments (ties → the latest) */
  usual?: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ruleOf = (kind: string | undefined, name: string) => `${kind || 'bill'}:${norm(name)}`;

/** `money:<kind>:<slug>[-provider…]:<YYYY-MM-DD>` → kind, name part, date. */
function parseKey(key: string): { kind: string; slug: string; due: string } | undefined {
  const m = key.match(/^money:([a-z]+):([^:]+):(\d{4}-\d{2}-\d{2})$/);
  return m ? { kind: m[1], slug: m[2], due: m[3] } : undefined;
}

export function billHistory(
  bill: { name: string; kind?: string; origName?: string; nameBeforeLabel?: string; ruleDay?: string },
  dues: BillDue[],
  items: MoneyItem[],
  paidAt: Record<string, string>,
  meta: Record<string, MetaEntry>,
): BillHistory {
  const want = ruleOf(bill.kind, bill.origName ?? bill.name);
  // After a rename written to the sheet, newer rows carry the new name.
  const wants = new Set([want, ruleOf(bill.kind, bill.nameBeforeLabel ?? bill.name)]);
  const wantKind = bill.kind || 'bill';
  const wantName = norm(bill.origName ?? bill.name);
  const rows = new Map<string, HistoryRow>();
  // Two bills under one sheet name (two Verizons): only this one's day of the month counts.
  const day = bill.ruleDay;
  const dayOk = (due?: string) => !day || (due ? due.slice(8, 10) === day : false);
  const paidAmt = (key: string) => meta[`paid:${key}`]?.amount;
  for (const d of dues) {
    if (!wants.has(ruleOf(d.bill.kind, d.bill.origName ?? d.bill.name)) && !wants.has(ruleOf(d.bill.kind, d.bill.nameBeforeLabel ?? d.bill.name)) || (day && d.bill.ruleDay !== day)) continue;
    const paidOn = paidAt[d.key];
    rows.set(d.key, { key: d.key, due: d.orig || d.due, amount: paidOn ? paidAmt(d.key) ?? d.bill.amount : d.bill.amount, paidOn, state: paidOn ? 'paid' : d.skipped ? 'skipped' : 'open' });
  }
  for (const it of items) {
    if (!it.date || it.projected || !wants.has(ruleOf(it.kind, it.name)) || !dayOk(it.date)) continue;
    const paidOn = paidAt[it.id];
    const cur = rows.get(it.id);
    const state = paidOn ? 'paid' : it.skipped ? 'crossed' : cur?.state || 'open';
    rows.set(it.id, { key: it.id, due: cur?.due || it.date, amount: paidOn ? paidAmt(it.id) ?? it.amount : cur?.amount ?? it.amount, paidOn, state });
  }
  for (const [key, paidOn] of Object.entries(paidAt)) {
    if (rows.has(key)) continue;
    const m = meta[`paid:${key}`];
    const p = parseKey(key);
    const mine = m?.name ? wants.has(ruleOf(m.paidKind, m.name)) : p ? p.kind === wantKind && (norm(p.slug) === wantName || p.slug.startsWith(`${wantName}-`) || norm(p.slug.split('-')[0]) === wantName) : false;
    const due = m?.paidDue || p?.due;
    if (!mine || !due || !dayOk(due)) continue;
    rows.set(key, { key, due, amount: m?.amount, paidOn, state: 'paid' });
  }
  const list = [...rows.values()].sort((a, b) => b.due.localeCompare(a.due));
  const paid = list.filter(r => r.state === 'paid' || r.state === 'crossed');
  const lastPaid = [...paid].sort((a, b) => (b.paidOn || b.due).localeCompare(a.paidOn || a.due))[0];
  const counts = new Map<number, number>();
  for (const r of list) if (r.amount !== undefined && r.state !== 'skipped') counts.set(r.amount, (counts.get(r.amount) || 0) + 1);
  let usual: number | undefined;
  let best = 0;
  // list is newest first, so the first amount reaching the top count is the latest of a tie
  for (const r of list) {
    if (r.amount === undefined || r.state === 'skipped') continue;
    const n = counts.get(r.amount)!;
    if (n > best) {
      best = n;
      usual = r.amount;
    }
  }
  return { rows: list, lastPaid, usual };
}
