/**
 * Loan balance log (Credit › Loans, e.g. Fortiva, Nelnet). The sheet's Bal cell stays the one balance:
 * marking a loan's payment Paid, or logging a credit / adjustment in the loan pop-out, writes the new
 * balance into that cell (guarded by `expect`, so a cell that changed elsewhere is left alone) and keeps
 * a line in synced moneyMeta `loanlog:<loan>` saying why it moved. Undo Paid puts the amount back.
 *
 * Asset loans (the Toyota) are skipped: their progress already comes from Paid marks (lib/assets.ts),
 * so writing the sheet too would count each payment twice.
 */
import { ASSETS } from './assets';
import { amountOf, type Cell, type CellEdit, type MoneyModel } from './money';
import { loadLifeSubs } from './lifeSubs';
import { loadMoneyMeta, metaName, setMeta, type LoanLogEntry } from './moneyMeta';
import type { BillDue } from './schedule';

export const LOAN_ADJUST_EVENT = 'lifehub:loan-adjust';
export type LoanAdjust = { loan: string; amount: number; date: string; note?: string };
/** Ask Life Hub to log a credit / adjustment on a sheet loan and write its new balance. */
export const requestLoanAdjust = (d: LoanAdjust) => window.dispatchEvent(new CustomEvent(LOAN_ADJUST_EVENT, { detail: d }));

export const loanLogKey = (loan: string) => `loanlog:${metaName(loan)}`;
export const loanLog = (loan: string): LoanLogEntry[] => loadMoneyMeta()[loanLogKey(loan)]?.log || [];

const isAssetLoan = (name: string) => ASSETS.some((a) => a.loan && (metaName(name).startsWith(metaName(a.loan)) || metaName(a.loan).startsWith(metaName(name))));

/** Sheet loan rows (Credit › Current accounts) that this log looks after. */
export function sheetLoans(model: MoneyModel): Cell[][] {
  return (model.creditAccounts?.rows || []).filter((r) => r[0]?.text.trim() && r[2] && !isAssetLoan(r[0].text));
}

export function loanRowByName(model: MoneyModel, name: string): Cell[] | undefined {
  const k = metaName(name);
  return sheetLoans(model).find((r) => metaName(r[0].text) === k);
}

/** The sheet loan a bill payment belongs to (bill "Fortiva" → loan "Fortiva Retail Credit"). */
export function loanRowOfDue(model: MoneyModel, due: BillDue): Cell[] | undefined {
  if ((due.bill.kind || 'bill') !== 'bill') return undefined;
  const k = metaName(due.bill.origName ?? due.bill.nameBeforeLabel ?? due.bill.name);
  if (!k) return undefined;
  return sheetLoans(model).find((r) => {
    const o = metaName(r[0].text);
    return o === k || o.startsWith(k) || k.startsWith(o);
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Bal cell edit that takes `amount` off (a negative amount puts it back). */
export function balanceEdit(row: Cell[], amount: number): { edit: CellEdit; before: number; after: number } | undefined {
  const cell = row[2];
  const before = amountOf(cell?.text || '');
  if (!cell || before === undefined || cell.formula) return undefined;
  const after = Math.max(0, round2(before - amount));
  return { edit: { tab: cell.tab, r: cell.r, c: cell.c, expect: cell.text, value: String(after) }, before, after };
}

export function addLoanLog(loan: string, entry: LoanLogEntry) {
  setMeta(loanLogKey(loan), { log: [...loanLog(loan).filter((e) => e.id !== entry.id), entry] });
}
export function removeLoanLog(loan: string, id: string) {
  setMeta(loanLogKey(loan), { log: loanLog(loan).filter((e) => e.id !== id) });
}

/**
 * Loans added on Life Hub (lifesubs kind 'loan') have no sheet cell: their balance is moneyMeta
 * `loan:<name>.bal`. A Paid mark on one of their dues (`money:lhsub:<id>:<day>`) takes the payment
 * off that balance and logs it as a payment; Undo Paid puts it back. Returns true when it moved.
 */
const hubLoanOfKey = (key: string) => {
  const m = /^money:lhsub:(.+):\d{4}-\d{2}-\d{2}$/.exec(key);
  return m ? loadLifeSubs().find((x) => x.id === m[1] && x.kind === 'loan' && !x.removed) : undefined;
};
export function payHubLoan(key: string, amount: number | undefined, day: string, sheetNames: Set<string>): boolean {
  const loan = hubLoanOfKey(key);
  if (!loan || !(amount && amount > 0) || sheetNames.has(metaName(loan.name)) || loanLog(loan.name).some((e) => e.due === key)) return false;
  const metaKey = `loan:${metaName(loan.name)}`;
  const before = loadMoneyMeta()[metaKey]?.bal;
  if (typeof before !== 'number') {
    // No balance typed yet: still keep the payment in the log, nothing to subtract from.
    addLoanLog(loan.name, { id: `pay:${key}`, date: day, kind: 'payment', amount, due: key, sheet: false });
    return true;
  }
  const after = Math.max(0, round2(before - amount));
  setMeta(metaKey, { bal: after });
  addLoanLog(loan.name, { id: `pay:${key}`, date: day, kind: 'payment', amount, due: key, before, after });
  return true;
}
export function unpayHubLoan(key: string): boolean {
  const loan = hubLoanOfKey(key);
  const logged = loan ? loanLog(loan.name).find((e) => e.due === key && e.kind === 'payment') : undefined;
  if (!loan || !logged) return false;
  removeLoanLog(loan.name, logged.id);
  if (logged.sheet !== false) {
    const metaKey = `loan:${metaName(loan.name)}`;
    const bal = loadMoneyMeta()[metaKey]?.bal;
    if (typeof bal === 'number') setMeta(metaKey, { bal: round2(bal + logged.amount) });
  }
  return true;
}

export type Payoff = { months: number; date: Date; interest: number } | null;

/**
 * Month-by-month payoff at a fixed monthly payment. 0% (a closed account like Fortiva) is plain division;
 * with an APR (Nelnet) each month's interest is added first. null when the payment never gets ahead.
 */
export function loanPayoff(bal: number, payment: number, aprPct = 0, first = new Date()): Payoff {
  if (!(bal > 0) || !(payment > 0)) return null;
  const r = aprPct > 0 ? aprPct / 100 / 12 : 0;
  if (r && payment <= bal * r) return null;
  let left = bal;
  let months = 0;
  let interest = 0;
  while (left > 0.005 && months < 600) {
    const i = round2(left * r);
    interest += i;
    left = round2(left + i - payment);
    months++;
  }
  const date = new Date(first.getFullYear(), first.getMonth() + months - 1, Math.min(first.getDate(), 28));
  return { months, date, interest: round2(interest) };
}
