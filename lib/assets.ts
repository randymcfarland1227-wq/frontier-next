/**
 * Balances → Assets: things Randy owns that are still being paid off (the Toyota, Ableton, the phone).
 * Nothing new is stored for the payments themselves: progress is worked out from the same Paid marks
 * the Week board, ledger and Daily Brief write (paidAt / sheet cross-offs), so marking a payment Paid
 * anywhere moves the balance, % paid, payments left and payoff date here.
 *
 * Hand-typed details live in synced moneyMeta (lib/moneyMeta.ts):
 *   asset:<id> → { value, valueAt, note, links, total, payment, bal, asOf, paymentsLeft, start, billKey }
 *   The Toyota keeps its loan terms under loan:toyota (principal / paymentsLeft / apr) like the Loans table.
 * Nothing personal is hard-coded here: amounts come from the sheet or from what Randy types.
 */

import type { BillDue } from './schedule';

export type AssetId = 'toyota' | 'ableton' | 'phone';

export type AssetDef = {
  id: AssetId;
  name: string;
  what: string;
  /** Matches the monthly payment's bill name in the ledger */
  bill?: RegExp;
  /** Loan row in the sheet's credit accounts (its pop-out is the loan pop-out) */
  loan?: string;
  /** Payoff table in the sheet (model.plans title) */
  plan?: RegExp;
  vehicle?: boolean;
};

export const ASSETS: AssetDef[] = [
  { id: 'toyota', name: 'Toyota', what: '2017 Corolla', bill: /^toyota\b/i, loan: 'Toyota', vehicle: true },
  { id: 'ableton', name: 'Ableton', what: 'Live, financed', bill: /^ab[el]{2}ton\b/i, plan: /^ableton/i },
  { id: 'phone', name: 'Phone', what: 'financed' },
];

export const assetKey = (id: AssetId) => `asset:${id}`;
/** moneyMeta key remembering when a loan's sheet balance last changed ({ sig, seenAt }) */
export const loanSeenKey = (loan: string) => `figs:loan:${loan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** The due key without its date: `money:bill:toyota:2026-10-26` → `money:bill:toyota:` */
export const duePrefix = (key: string) => key.replace(/\d{4}-\d{2}-\d{2}$/, '');

/** One paid payment: its month, due day, and when it was marked paid on Life Hub (none = crossed off in the sheet). */
export type PaidMonth = { month: string; due: string; at?: string };

/**
 * Every payment of this bill marked paid, one per month (a bill moved within a month can leave two keys).
 * Sources: Life Hub Paid marks (paidAt keys carry the due date) + sheet cross-offs in the current dues.
 */
export function paidMonths(prefix: string, paidAt: Record<string, string>, dues: BillDue[]): PaidMonth[] {
  const byMonth = new Map<string, PaidMonth>();
  const add = (due: string, at?: string) => {
    const month = due.slice(0, 7);
    const cur = byMonth.get(month);
    if (!cur) byMonth.set(month, { month, due, ...(at ? { at } : {}) });
    else byMonth.set(month, { month, due: due < cur.due ? due : cur.due, ...(cur.at || at ? { at: [cur.at, at].filter(Boolean).sort()[0] } : {}) });
  };
  for (const k of Object.keys(paidAt)) {
    if (k.startsWith(prefix) && /\d{4}-\d{2}-\d{2}$/.test(k)) add(k.slice(-10), paidAt[k]);
  }
  for (const d of dues) {
    if (duePrefix(d.key) === prefix && (d.bill.id.startsWith('crossed:') || paidAt[d.key])) add(d.due, paidAt[d.key]);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type AssetInput = {
  /** Original amount financed */
  total?: number;
  /** Monthly payment */
  payment?: number;
  /** Balance owed as of `asOf` (sheet Bal cell or typed) */
  bal?: number;
  /** When the balance / payments-left figures were true (YYYY-MM-DD typed, or an ISO time the sheet balance changed).
   *  Payments marked paid on Life Hub at or after it come off; sheet cross-offs don't (the sheet is updated by hand). */
  asOf?: string;
  /** Payments left as of `asOf` (typed) */
  paymentsLeft?: number;
  /** First payment month YYYY-MM (schedule mode, when no balance is known) */
  start?: string;
  /** Day of the month it's due */
  dueDay?: number;
  /** Next unpaid due date from the ledger, if there is one */
  nextDue?: string;
  paid: PaidMonth[];
  /** Months with a due that's past and still unpaid */
  missed?: string[];
};

export type AssetProgress = {
  mode: 'balance' | 'schedule' | 'unknown';
  owed?: number;
  paidAmt?: number;
  /** 0–100 */
  paidPct?: number;
  owedPct?: number;
  left?: number;
  /** YYYY-MM-DD of the last payment */
  payoff?: string;
  /** Payments marked paid since the balance was typed / read */
  paidSince: number;
  /** Payments counted as made (schedule mode) */
  made?: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const out = new Date(y, m - 1 + n, Math.min(d, last));
  return out.toLocaleDateString('en-CA');
}

export function assetProgress(a: AssetInput, today = new Date()): AssetProgress {
  const pay = a.payment && a.payment > 0 ? a.payment : undefined;
  const thisMonth = ym(today);
  let mode: AssetProgress['mode'] = 'unknown';
  let owed: number | undefined;
  let left: number | undefined;
  let made: number | undefined;
  let paidSince = 0;
  if (a.bal !== undefined) {
    mode = 'balance';
    paidSince = a.asOf ? a.paid.filter(p => p.at && p.at >= a.asOf!).length : 0;
    owed = Math.max(0, r2(a.bal - paidSince * (pay || 0)));
    if (a.paymentsLeft !== undefined) left = Math.max(0, a.paymentsLeft - paidSince);
    else if (pay) left = Math.ceil(owed / pay - 0.001);
  } else if (a.total !== undefined && pay && a.start) {
    mode = 'schedule';
    const count = Math.ceil(a.total / pay - 0.001);
    const missed = new Set(a.missed || []);
    const paid = new Set(a.paid.map(p => p.month));
    made = 0;
    for (let i = 0; i < count; i++) {
      const m = addMonths(`${a.start}-01`, i).slice(0, 7);
      if (m > thisMonth) break;
      if (m < thisMonth ? !missed.has(m) || paid.has(m) : paid.has(m)) made++;
    }
    owed = Math.max(0, r2(a.total - made * pay));
    left = Math.max(0, count - made);
  } else if (a.paymentsLeft !== undefined) {
    left = a.paymentsLeft;
  }
  const paidAmt = a.total !== undefined && owed !== undefined ? Math.max(0, r2(a.total - owed)) : undefined;
  const paidPct = a.total && paidAmt !== undefined ? Math.min(100, (paidAmt / a.total) * 100) : undefined;
  let payoff: string | undefined;
  if (left !== undefined) {
    if (left === 0) payoff = a.paid.length ? a.paid[a.paid.length - 1].due : undefined;
    else {
      const first = a.nextDue
        ? a.nextDue
        : a.dueDay
          ? (() => {
              const lastPaid = a.paid[a.paid.length - 1]?.month;
              const base = lastPaid && monthsBetween(lastPaid, thisMonth) <= 0 ? addMonths(`${lastPaid}-01`, 1).slice(0, 7) : thisMonth;
              return `${base}-${String(a.dueDay).padStart(2, '0')}`;
            })()
          : undefined;
      if (first) payoff = addMonths(first, left - 1);
    }
  }
  return {
    mode,
    owed,
    paidAmt,
    paidPct,
    owedPct: paidPct !== undefined ? 100 - paidPct : undefined,
    left,
    payoff,
    paidSince,
    made,
  };
}

/** Sheet payoff table → total / monthly payment / first month. Title like "Plan · $600 total", rows [Apr-2026, -$30, …]. */
export function planTerms(title: string, rows: Array<Array<{ text: string }>>): { total?: number; payment?: number; start?: string } {
  const t = title.match(/\$([\d,]+(?:\.\d+)?)/);
  const total = t ? Number(t[1].replace(/,/g, '')) : undefined;
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (const r of rows) {
    const m = (r[0]?.text || '').trim().match(/^([a-z]{3})[a-z]*[-\s]+(\d{4})$/i);
    const amt = Number((r[1]?.text || '').replace(/[^0-9.]/g, ''));
    if (m && MON.includes(m[1].toLowerCase())) {
      return { total, payment: amt > 0 ? amt : undefined, start: `${m[2]}-${String(MON.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}` };
    }
  }
  return { total };
}

export const pct = (n?: number) => (n === undefined ? '—' : `${n >= 99.5 || n < 1 ? Math.round(n) : n.toFixed(n < 10 ? 1 : 0)}%`);
