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
