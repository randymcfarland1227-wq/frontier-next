/**
 * Credit card carrying cost and payoff projections (pure math, no React).
 *
 * Conventions (shown in the UI too):
 *  - Monthly models (A: minimum only, B: fixed payment): each month interest = balance × APR / 12,
 *    plus the card's monthly fee, then the payment. No new purchases.
 *  - By-date model (C): interest accrues daily on each day's ending balance × APR / 365 and is posted
 *    to the balance on the 1st of each month (and on the target date). The monthly fee is charged on
 *    the 1st of each month. Payments land on their date before that day's interest accrues.
 */

export type CardInput = {
  bal: number;
  /** APR in percent (e.g. 29.99) */
  apr?: number;
  /** Monthly fee in dollars */
  fee?: number;
  limit?: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export type MonthlyCost = { interest: number; fee: number; total: number };

/** What carrying this balance costs for one month right now (interest at APR/12 plus the fee). */
export function monthlyCost(c: CardInput): MonthlyCost {
  const bal = Math.max(0, c.bal || 0);
  const interest = cents((bal * (c.apr || 0)) / 100 / 12);
  const fee = cents(c.fee || 0);
  return { interest, fee, total: cents(interest + fee) };
}

export const utilOf = (bal: number, limit?: number) => (limit ? (Math.max(0, bal) / limit) * 100 : undefined);

/** YYYY-MM-DD in local time */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Same day of month `n` months after `d` (clamped: Jan 31 + 1 → Feb 28). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last));
}

export type MonthRow = {
  /** 1 = first payment */
  n: number;
  date: string;
  start: number;
  interest: number;
  fee: number;
  payment: number;
  end: number;
  util?: number;
  avail?: number;
};

export type MonthlyPlan = {
  rows: MonthRow[];
  /** First month at or under 30% used (n = 0 means it already is) */
  hit30?: { n: number; date: string };
  /** Month the balance reaches $0 */
  hit0?: { n: number; date: string };
  /** The payment never gets ahead of interest + fees, so the balance never reaches 0 */
  neverPays: boolean;
  /** Interest + fee in the first month, to compare against the payment */
  firstCost: number;
  totalInterest: number;
  totalFees: number;
  totalPaid: number;
};

/**
 * Pay the same `payment` every month starting on `firstDate`. Stops at $0 or after `maxMonths`.
 * Model A passes the minimum; Model B passes the typed amount.
 */
export function payMonthly(c: CardInput, payment: number, firstDate: Date, maxMonths = 600): MonthlyPlan {
  let bal = cents(Math.max(0, c.bal || 0));
  const first = monthlyCost({ ...c, bal });
  const rows: MonthRow[] = [];
  const startUtil = utilOf(bal, c.limit);
  let hit30: MonthlyPlan['hit30'] = startUtil !== undefined && startUtil <= 30 ? { n: 0, date: ymd(new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate())) } : undefined;
  let hit0: MonthlyPlan['hit0'] = bal <= 0 ? { n: 0, date: ymd(firstDate) } : undefined;
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  const pay = Math.max(0, payment || 0);
  // If the payment doesn't beat the first month's interest + fee, the balance never falls (no purchases).
  const neverPays = bal > 0 && pay <= first.total;
  const cap = neverPays ? Math.min(maxMonths, 24) : maxMonths;
  for (let n = 1; n <= cap && bal > 0; n++) {
    const { interest, fee } = monthlyCost({ ...c, bal });
    const owed = cents(bal + interest + fee);
    const p = cents(Math.min(pay, owed));
    const end = cents(owed - p);
    const date = ymd(addMonths(firstDate, n - 1));
    const util = utilOf(end, c.limit);
    rows.push({ n, date, start: bal, interest, fee, payment: p, end, util, avail: c.limit !== undefined ? cents(c.limit - end) : undefined });
    totalInterest += interest;
    totalFees += fee;
    totalPaid += p;
    bal = end;
    if (!hit30 && util !== undefined && util <= 30) hit30 = { n, date };
    if (!hit0 && bal <= 0) hit0 = { n, date };
  }
  return { rows, hit30, hit0, neverPays: neverPays || !hit0, firstCost: first.total, totalInterest: cents(totalInterest), totalFees: cents(totalFees), totalPaid: cents(totalPaid) };
}

/** Smallest whole-dollar monthly payment that clears the balance within `months`. */
export function paymentToClear(c: CardInput, months: number, firstDate: Date): number {
  let lo = 0;
  let hi = Math.ceil(Math.max(0, c.bal) + monthlyCost(c).total * months + 1);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = payMonthly(c, mid, firstDate, months);
    if (r.hit0 && r.hit0.n <= months) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export type PlannedPayment = { date: string; amount: number };

export type DateEvent = { date: string; kind: 'pay' | 'interest' | 'fee'; amount: number; bal: number };

export type DatePlan = {
  target: string;
  balance: number;
  avail?: number;
  util?: number;
  /** Carrying cost per month at the target balance */
  carry: MonthlyCost;
  interest: number;
  fees: number;
  paid: number;
  /** Paid beyond the balance (would sit as a credit on the card) */
  overpaid: number;
  /** Payments dated before the start or after the target, left out */
  skipped: PlannedPayment[];
  events: DateEvent[];
};

/** Balance on `target` after the listed payments, with daily interest posted monthly (see top). */
export function payByDate(c: CardInput, payments: PlannedPayment[], from: Date, target: Date): DatePlan {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const s = ymd(start);
  const t = ymd(end);
  const valid = payments.filter(p => p.date && Number.isFinite(p.amount) && p.amount > 0);
  const used = valid.filter(p => p.date >= s && p.date <= t);
  const skipped = valid.filter(p => !(p.date >= s && p.date <= t));
  const byDay = new Map<string, number>();
  for (const p of used) byDay.set(p.date, (byDay.get(p.date) || 0) + p.amount);
  let bal = Math.max(0, c.bal || 0);
  let accrued = 0;
  let interest = 0;
  let fees = 0;
  let paid = 0;
  let overpaid = 0;
  const events: DateEvent[] = [];
  const daily = (c.apr || 0) / 100 / 365;
  const post = (date: string) => {
    const amt = cents(accrued);
    accrued = 0;
    if (amt > 0) {
      bal = cents(bal + amt);
      interest += amt;
      events.push({ date, kind: 'interest', amount: amt, bal });
    }
  };
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = ymd(d);
    if (d.getDate() === 1 && k !== s) {
      post(k);
      const fee = cents(c.fee || 0);
      if (fee > 0) {
        bal = cents(bal + fee);
        fees += fee;
        events.push({ date: k, kind: 'fee', amount: fee, bal });
      }
    }
    const p = byDay.get(k);
    if (p) {
      const applied = cents(Math.min(p, bal));
      overpaid = cents(overpaid + (p - applied));
      bal = cents(bal - applied);
      paid += cents(p);
      events.push({ date: k, kind: 'pay', amount: cents(p), bal });
    }
    if (k < t) accrued += bal * daily;
  }
  post(t);
  return {
    target: t,
    balance: bal,
    avail: c.limit !== undefined ? cents(c.limit - bal) : undefined,
    util: utilOf(bal, c.limit),
    carry: monthlyCost({ ...c, bal }),
    interest: cents(interest),
    fees: cents(fees),
    paid: cents(paid),
    overpaid,
    skipped,
    events,
  };
}
