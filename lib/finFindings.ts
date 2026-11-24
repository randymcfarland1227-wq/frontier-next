'use client';

/**
 * Finance findings: what Randy found out about a Finance thing, typed on Life Hub.
 *  - the amount (fills a "?" like the MDTA flag or the registration renewal fee),
 *  - whether a payment plan is available, and its details (monthly, months, down payment, terms, who to call).
 * Keyed by the Finance link key (`item:md-tax`, `src:ccu`, …). A key starting `own:` is a money item typed in
 * by hand (e.g. "Registration renewal fee") that isn't in the debt file yet; its name lives here too.
 * Map key → finding, newest change wins in the cloud (same pattern as lib/groupLog). `gone` = removed.
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';
import type { FocusRef } from './focusRefs';
import { daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export const FINDINGS_KEY = 'lifehub-finance-findings';
export const FINDINGS_EVENT = 'lifehub:finance-findings';

/** yes = a plan is available · ask = maybe, ask them · none = pay in full only · unknown = not checked yet */
export type PlanState = 'yes' | 'ask' | 'none' | 'unknown';
export const PLAN_STATES: Array<[PlanState, string]> = [
  ['unknown', 'Not checked yet'],
  ['yes', 'Payment plan available'],
  ['ask', 'Maybe — have to ask'],
  ['none', 'Pay in full only'],
];
export const planShort = (s: PlanState) => ({ unknown: 'Plan ?', yes: 'Plan ✓', ask: 'Plan: ask', none: 'Pay in full' })[s];

export type Finding = {
  key: string;
  /** own: items only */
  name?: string;
  /** Display name for a non-own item (a sheet line / debt item), used for its nested payments in the to-pay list */
  label?: string;
  /** Amount found (null = still unknown). Undefined = use what Finance has. */
  amount?: number | null;
  plan?: PlanState;
  monthly?: number;
  months?: number;
  down?: number;
  terms?: string;
  /** Where to set it up / who to call */
  contact?: string;
  note?: string;
  /** own: items: pay-by steps (amount owed if paid by each date), e.g. a county tax ticket that adds interest monthly */
  schedule?: Array<{ by: string; amount: number }>;
  /** own: items: paid off (a task purchase: bought) */
  paid?: boolean;
  /** own: items: 'project' = lands in Current liabilities → Projects / required (an asset task), else Taxes / Legal */
  group?: 'project';
  /** own: items: a task-based purchase (Money › Spend › Purchases › Task-based) */
  buy?: boolean;
  /** Task purchases: the focus / task it belongs to, and where to buy it */
  task?: string;
  where?: string;
  /** own: items: a plain purchase that sits in Money › Purchases › Needed or Wants (not task-based) */
  wish?: 'need' | 'want';
  /** Research pop-out record to open for this item when it isn't its own key (e.g. the Self task it came from) */
  rkey?: string;
  /** Day (YYYY-MM-DD) it was last checked */
  checked?: string;
  /** Letters, notices and links filed on this item (same files as focus-card refs: lib/focusRefs) */
  refs?: FocusRef[];
  /** Payments due on this item (e.g. a $75 minimum by 11/30). Each one shows in the pop-out and in the to-pay list. */
  payments?: FindingPayment[];
  /** A separate advance draw; provider account survives repayment. Each draw has its own record. */
  cashAdvance?: { provider: string; received: number; takenOn: string };
  at: string;
  gone?: boolean;
};
export type FindingStore = Record<string, Finding>;

export type FindingPayment = { id: string; amount: number; due: string; note?: string; paid?: boolean };

/** Due key of a nested payment in the to-pay list: `money:find:<payment id>:<due>` (paid marks use it). */
export const findingDueKey = (p: FindingPayment) => `money:find:${p.id}:${p.due}`;

/**
 * Nested payments as bill dues, so they sit in the full to-pay list (Week board, month view, Daily Brief) like any bill.
 * Paid ones (ticked in the pop-out, or marked paid in the list) are left out unless `keepPaid`.
 */
export function findingPaymentDues(store: FindingStore, paid: Set<string>, today = new Date(), back = 45, ahead = 120, keepPaid = false): BillDue[] {
  const t = startOfDay(today);
  const out: BillDue[] = [];
  for (const f of Object.values(store)) {
    if (!f || f.gone || !f.payments?.length) continue;
    const name = f.name || f.label || 'Payment';
    for (const p of f.payments) {
      const key = findingDueKey(p);
      const days = daysBetween(t, fromDayKey(p.due));
      if (!f.cashAdvance && (days < -back || days > ahead)) continue;
      if (!keepPaid && (p.paid || paid.has(key))) continue;
      out.push({ bill: { id: key, name, amount: p.amount, kind: f.cashAdvance ? 'cash' : 'bill', notes: [p.note, f.cashAdvance ? 'cash advance repayment · added on Life Hub' : 'payment on a money item · added on Life Hub'].filter(Boolean).join(' · ') }, due: p.due, days, key });
    }
  }
  return out;
}

export const loadFindings = (): FindingStore => readSaved<FindingStore>(FINDINGS_KEY, {});
function put(next: FindingStore) {
  writeSaved(FINDINGS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FINDINGS_EVENT));
}

export function findingOf(store: FindingStore, key: string): Finding | undefined {
  const f = store[key];
  return f && !f.gone ? f : undefined;
}

/** Save (merge) what was found. Empty strings clear a field. */
export function setFinding(key: string, patch: Partial<Omit<Finding, 'key' | 'at'>>) {
  const s = loadFindings();
  const prev = s[key] && !s[key].gone ? s[key] : { key, at: '' };
  const next: Finding = { ...prev, ...patch, key, at: new Date().toISOString(), gone: undefined };
  for (const k of ['terms', 'contact', 'note', 'name'] as const) if (typeof next[k] === 'string' && !next[k]!.trim()) delete next[k];
  put({ ...s, [key]: next });
}

/** A money item typed in by hand; returns its key (`own:…`). Pass `id` for a fixed key (seeded items). */
export function addOwnItem(name: string, init: Partial<Omit<Finding, 'key' | 'at' | 'name'>> = {}, id?: string): string {
  const key = `own:${id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`}`;
  const s = loadFindings();
  if (s[key] && !s[key].gone) return key;
  put({ ...s, [key]: { key, name: name.trim(), amount: null, plan: 'unknown', ...init, at: new Date().toISOString() } });
  return key;
}

const WV_PAY = 'Pay online at monongalia.softwaresystems.com (Pay your taxes online) or call the Sheriff\'s Tax Office (304) 291-7244';
const WV_TICKETS: Array<{ id: string; name: string; note: string; steps: number[] }> = [
  { id: 'wv-pp-2023', name: 'Monongalia Co. personal property tax 2023', note: 'Ticket 1100000037 S · acct 20242760 · 17 Toyota Corolla · delinquent, none paid', steps: [302.37, 304.05, 305.73, 307.41, 309.08, 310.76, 312.43, 314.11, 315.79, 317.47, 319.15] },
  { id: 'wv-pp-2024', name: 'Monongalia Co. personal property tax 2024', note: 'Ticket 316186 · acct 20242760 · 17 Toyota Corolla · delinquent, none paid', steps: [238.43, 239.83, 241.23, 242.63, 244.03, 245.43, 246.82, 248.21, 249.61, 251.01, 252.41] },
];
const WV_BY = ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31', '2027-08-31', '2027-09-30'];

/** Randy's two WV personal property tax tickets → Taxes / Legal (once; never brought back after he removes one). */
export function seedCountyTaxes() {
  const s = loadFindings();
  let next = s;
  for (const t of WV_TICKETS) {
    const key = `own:${t.id}`;
    if (next[key]) continue;
    next = { ...next, [key]: { key, name: t.name, amount: t.steps[0], plan: 'none', terms: 'Pay the full total — no halves once delinquent', contact: WV_PAY, note: t.note, schedule: t.steps.map((amount, i) => ({ by: WV_BY[i], amount })), at: new Date().toISOString() } };
  }
  if (next !== s) put(next);
}

/** The step that applies today (first pay-by date not yet passed; the last one after that). */
export function scheduleNow(steps: Array<{ by: string; amount: number }>, today = new Date().toLocaleDateString('en-CA')) {
  return steps.find(x => x.by >= today) || steps[steps.length - 1];
}

export function removeFinding(key: string) {
  const s = loadFindings();
  if (s[key]) put({ ...s, [key]: { ...s[key], gone: true, at: new Date().toISOString() } });
}

export const ownItems = (store: FindingStore): Finding[] =>
  Object.values(store).filter(f => f && !f.gone && f.key.startsWith('own:'));

export function useFindings(): FindingStore {
  const [s, setS] = useState(loadFindings);
  useEffect(() => {
    const on = () => setS(loadFindings());
    window.addEventListener(FINDINGS_EVENT, on);
    window.addEventListener('lifehub:synced', on);
    return () => {
      window.removeEventListener(FINDINGS_EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return s;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });

/** One line of plan details, e.g. "$50/mo × 6 · $25 down · call CCU". */
export function planLine(f?: Pick<Finding, 'monthly' | 'months' | 'down' | 'terms' | 'contact'>): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.monthly) parts.push(`${money(f.monthly)}/mo${f.months ? ` × ${f.months}` : ''}`);
  else if (f.months) parts.push(`${f.months} months`);
  if (f.down) parts.push(`${money(f.down)} down`);
  if (f.terms) parts.push(f.terms);
  if (f.contact) parts.push(f.contact);
  return parts.join(' · ');
}
