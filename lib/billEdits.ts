/**
 * Bill changes logged on Life Hub, one due date at a time: skip it ("shopping for cheaper
 * insurance"), move it to another day, or a different amount this time — with a note. Keyed by the
 * due's id (`bill:…` / `money:…` / plan ids), which never changes, so Paid and Pin keep working
 * after a move. Cloud-synced as `billEdits` (newest change per bill wins). The sheet isn't written.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export type BillEdit = {
  /** Not paying this one */
  skip?: boolean;
  /** Taken off every list on Life Hub (a duplicate or a bill that's gone); the sheet isn't touched */
  removed?: boolean;
  /** New due date for this one — YYYY-MM-DD */
  moveTo?: string;
  /** Amount for this one */
  amount?: number;
  note?: string;
  /** Non Critical set on Life Hub (overrides the sheet's Item Flags): orange when overdue, not red */
  nonCritical?: boolean;
  /** Pay-by day set on Life Hub (YYYY-MM-DD; '' = cleared, overriding the sheet) */
  payBy?: string;
  at: string;
};

export type BillEdits = Record<string, BillEdit>;

export const BILL_EDITS_EVENT = 'lifehub:bill-edits';
export const BILL_DAYS_EVENT = 'lifehub:bill-days';

/**
 * A bill's new day every month ("Progressive is due on the 20th now"), from a month on. Keyed by
 * kind + name, so it covers the sheet's dates for every month, not just one occurrence. Payment
 * keys don't change, so Paid / Pin / Change keep working. Cloud-synced as `billDays`.
 */
export type BillDay = {
  day: number | null;
  /** YYYY-MM it starts */
  from: string;
  at: string;
  /** New usual amount (price changed), from `amountFrom` (YYYY-MM) on; set on Life Hub */
  amount?: number;
  amountFrom?: string;
  /** Deleted for good on Life Hub: no payments from this month (YYYY-MM) on. The sheet isn't written. */
  endFrom?: string;
  /** Display name kept so a deleted one can be listed and restored */
  endName?: string;
  /** Renamed on Life Hub: every payment shows this name (the sheet keeps its own) */
  rename?: string;
  /** The sheet's name before the rename (the rule key is built from it) */
  renamedFrom?: string;
  /** Every payment of this bill: Non critical (orange) or Priority (red, first). Set on Life Hub. */
  nonCritical?: boolean;
  priority?: boolean;
};
export type BillDays = Record<string, BillDay>;

export function billRuleKey(bill: { name: string; kind?: string; origName?: string; ruleDay?: string }): string {
  return `${bill.kind || 'bill'}:${(bill.origName ?? bill.name).toLowerCase().replace(/[^a-z0-9]+/g, '')}${bill.ruleDay ? `@${bill.ruleDay}` : ''}`;
}

export function loadBillDays(): BillDays {
  return readSaved<BillDays>(STORAGE_KEYS.billDays, {});
}

/** Set a bill's day for every month from `from` (YYYY-MM) on; `null` goes back to the sheet's day. */
export function setBillDay(ruleKey: string, day: number | null, from: string) {
  const all = loadBillDays();
  all[ruleKey] = { ...all[ruleKey], day, from, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billDays, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_DAYS_EVENT));
}

/** A new usual amount from `from` (YYYY-MM) on — the price changed; `null` goes back to the sheet's amount. */
export function setBillAmount(ruleKey: string, amount: number | null, from: string) {
  const all = loadBillDays();
  const prev = all[ruleKey] || { day: null, from };
  all[ruleKey] = { ...prev, amount: amount ?? undefined, amountFrom: amount === null ? undefined : from, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billDays, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_DAYS_EVENT));
}

/** Mark every payment of a bill Non critical, Priority, or normal (both off). Per-payment Non critical overrides are cleared. */
export function setBillLevel(ruleKey: string, level: 'normal' | 'noncritical' | 'priority', dueKeys: string[] = []) {
  const all = loadBillDays();
  const prev = all[ruleKey] || { day: null, from: '' };
  all[ruleKey] = { ...prev, nonCritical: level === 'noncritical', priority: level === 'priority' || undefined, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billDays, all);
  const edits = loadBillEdits();
  let touched = false;
  for (const k of dueKeys) if (edits[k]?.nonCritical !== undefined) { delete edits[k].nonCritical; edits[k].at = new Date().toISOString(); touched = true; }
  if (touched) writeSaved(STORAGE_KEYS.billEdits, edits);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_DAYS_EVENT));
}

/** Rename every payment of a bill on Life Hub; `null` / '' goes back to the sheet's name. */
export function setBillName(ruleKey: string, name: string | null, sheetName?: string) {
  const all = loadBillDays();
  const prev = all[ruleKey] || { day: null, from: '' };
  const n = name?.trim();
  all[ruleKey] = { ...prev, rename: n || undefined, renamedFrom: n ? sheetName ?? prev.renamedFrom : undefined, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billDays, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_DAYS_EVENT));
}

/** A bill's level: Priority, Non critical, or normal. */
export function billLevel(bill: { nonCritical?: boolean; priority?: boolean }): 'normal' | 'noncritical' | 'priority' {
  return bill.priority ? 'priority' : bill.nonCritical ? 'noncritical' : 'normal';
}

/** Delete a bill / subscription for good (every payment from `from` on) or bring it back with `null`. */
export function setBillEnd(ruleKey: string, from: string | null, name?: string) {
  const all = loadBillDays();
  const prev = all[ruleKey] || { day: null, from: from || '' };
  all[ruleKey] = { ...prev, endFrom: from ?? undefined, endName: from ? name : undefined, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billDays, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_DAYS_EVENT));
}

/** True when the rule deleted this due date's month (or any earlier one). */
export function isEnded(due: string, rule?: BillDay): boolean {
  return Boolean(rule?.endFrom && due.slice(0, 7) >= rule.endFrom);
}

/** The bill's due date moved to its new day, within the same month. */
function withBillDay(due: string, rule?: BillDay): string {
  if (!rule?.day || due.slice(0, 7) < rule.from) return due;
  const [y, m] = due.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${due.slice(0, 8)}${String(Math.min(rule.day, last)).padStart(2, '0')}`;
}

/**
 * Overdue tracking starts here: anything due earlier was from before Life Hub watched for it
 * (likely paid without a tap), so it never lands in Overdue.
 */
export const OVERDUE_SINCE = '2026-10-08';


export function loadBillEdits(): BillEdits {
  return readSaved<BillEdits>(STORAGE_KEYS.billEdits, {});
}

/** Save a change for one due; `null` (or nothing left in it) puts it back to normal. */
export function setBillEdit(key: string, edit: Omit<BillEdit, 'at'> | null) {
  const all = loadBillEdits();
  const at = new Date().toISOString();
  const clean = edit
    ? {
        ...(edit.removed ? { removed: true } : {}),
        ...(edit.skip ? { skip: true } : {}),
        ...(edit.moveTo && !edit.skip ? { moveTo: edit.moveTo } : {}),
        ...(edit.amount !== undefined && Number.isFinite(edit.amount) ? { amount: edit.amount } : {}),
        ...(edit.note?.trim() ? { note: edit.note.trim() } : {}),
      }
    : {};
  // Non Critical / Pay by are set separately (setBillFlags) and survive a change or an undo.
  const prev = all[key];
  const flags = {
    ...(prev?.nonCritical !== undefined ? { nonCritical: prev.nonCritical } : {}),
    ...(prev?.payBy !== undefined ? { payBy: prev.payBy } : {}),
  };
  // A cleared change is kept as an empty, newer entry so other devices drop theirs too.
  all[key] = { ...clean, ...flags, at };
  writeSaved(STORAGE_KEYS.billEdits, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_EDITS_EVENT));
}

/** Set Non Critical / Pay by for one due (keeps any skip / move / amount / note). */
export function setBillFlags(key: string, flags: { nonCritical?: boolean; payBy?: string }) {
  const all = loadBillEdits();
  all[key] = { ...(all[key] || {}), ...flags, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.billEdits, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_EDITS_EVENT));
}

/** Life Hub's Non Critical / Pay by on top of the sheet's Item Flags. */
export function withBillFlags(d: BillDue, e?: BillEdit): BillDue {
  if (!e || (e.nonCritical === undefined && e.payBy === undefined)) return d;
  const bill = { ...d.bill };
  if (e.nonCritical !== undefined) bill.nonCritical = e.nonCritical || undefined;
  if (e.payBy !== undefined) bill.payBy = e.payBy || undefined;
  return { ...d, bill };
}

/** Overdue, and not marked Non Critical: shown red (Non Critical overdue is orange). */
export function isCriticalOverdue(d: BillDue): boolean {
  return isOverdue(d) && !d.bill.nonCritical;
}

export function useBillEdits(): BillEdits {
  const [edits, setEdits] = useState<BillEdits>(() => loadBillEdits());
  useEffect(() => {
    const reload = () => setEdits(loadBillEdits());
    window.addEventListener(BILL_EDITS_EVENT, reload);
    window.addEventListener(BILL_DAYS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(BILL_EDITS_EVENT, reload);
      window.removeEventListener(BILL_DAYS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return edits;
}

export function hasEdit(e?: BillEdit): boolean {
  return Boolean(e && (e.skip || e.removed || e.moveTo || e.amount !== undefined || e.note));
}

/**
 * Dues with Life Hub changes applied: a moved one counts down to its new day (and keeps its
 * original day in `orig`), a skipped one stays visible until its day passes, then drops off.
 */
export function applyBillEdits(dues: BillDue[], edits: BillEdits, today = new Date(), days: BillDays = loadBillDays()): BillDue[] {
  const t = startOfDay(today);
  // A rename already written to the sheet: those rows carry the new name, but the rule is still keyed by the old one.
  const alias = new Map<string, string>();
  for (const [k, r] of Object.entries(days)) if (r.rename && r.renamedFrom) alias.set(`${k.split(':')[0]}:${r.rename.toLowerCase().replace(/[^a-z0-9]+/g, '')}`, k);
  if (alias.size) {
    dues = dues.map(d => {
      if (d.bill.origName || days[billRuleKey(d.bill)]) return d;
      const k = alias.get(billRuleKey(d.bill));
      const r = k ? days[k] : undefined;
      return k && r ? { ...d, bill: { ...d.bill, origName: r.renamedFrom, ruleDay: k.split('@')[1] ?? d.bill.ruleDay } } : d;
    });
  }
  return dues
    .filter(d => !edits[d.key]?.removed && !isEnded(d.due, days[billRuleKey(d.bill)]))
    .map(d => {
      // A new day every month (set on Life Hub) first; a one-off change below still wins.
      const rule = days[billRuleKey(d.bill)];
      const ruled = withBillDay(d.due, rule);
      if (ruled !== d.due) d = { ...d, due: ruled, days: daysBetween(t, fromDayKey(ruled)), everyMonth: rule!.day! };
      if (rule?.amount !== undefined && rule.amountFrom && d.due.slice(0, 7) >= rule.amountFrom) d = { ...d, bill: { ...d.bill, amount: rule.amount } };
      if (rule && (rule.nonCritical !== undefined || rule.priority !== undefined)) d = { ...d, bill: { ...d.bill, nonCritical: rule.priority ? undefined : rule.nonCritical ?? d.bill.nonCritical, priority: rule.priority || undefined } };
      if (rule?.rename && rule.rename !== d.bill.name) d = { ...d, bill: { ...d.bill, name: rule.rename, origName: d.bill.origName ?? d.bill.name } };
      const e = edits[d.key];
      d = withBillFlags(d, e);
      if (!hasEdit(e)) return d;
      const due = e!.moveTo || d.due;
      return {
        ...d,
        bill: e!.amount !== undefined ? { ...d.bill, amount: e!.amount } : d.bill,
        due,
        days: daysBetween(t, fromDayKey(due)),
        orig: e!.moveTo && e!.moveTo !== d.due ? d.due : undefined,
        skipped: e!.skip || undefined,
        editNote: e!.note,
      };
    })
    .filter(d => !(d.skipped && d.days < 0))
    .sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * Past its day, not paid, not skipped — any kind, subscriptions and pay later included: nothing is
 * assumed charged (only Paid on Life Hub or the sheet's cross-off counts). A Pay by date never lifts
 * it out of overdue; it only adds the "Pay by" badge. Sheet rows (money:*) carry their real due date, so they're
 * overdue whatever the date; hub-made monthly bills only count from when overdue tracking began.
 */
export function isOverdue(d: BillDue): boolean {
  return d.days < 0 && !d.skipped && !d.bill.autopay && (d.bill.id.startsWith('money:') || (d.orig || d.due) >= OVERDUE_SINCE);
}
