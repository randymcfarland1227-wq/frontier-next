/**
 * Repeating Self tasks (2026-11-25). Each rule makes one Self task on its day (weekly on a weekday, or monthly
 * on a day of the month), due that day. Only the current occurrence is made, never a backlog.
 *
 * The task id is fixed per occurrence (`self-rep-<rule>-<YYYY-MM-DD>`), so two devices making it merge into one
 * in the cloud backup, and its `updatedAt` is that day's midnight, so any real edit (done, moved) always wins
 * the merge. A device remembers what it already made, so deleting one doesn't bring it back.
 */
import { localDayKey } from './dayKey';
import { readSaved, writeSaved } from './storage';
import { loadSelfItems, saveSelfItems, SELF_ITEMS_EVENT, type SelfItem } from './adapters/self';

type RepeatRule = { id: string; title: string; detail: string; home?: string } & (
  | { weekday: number } // 0 = Sunday … 5 = Friday
  | { monthDay: number }
);

export const SELF_REPEATS: RepeatRule[] = [
  {
    id: 'paylater-verify',
    title: 'Paylater Date/Amount Verification',
    detail: 'Check what Money › Pay later says against each pay-later app (Zip, Afterpay, Klarna, Affirm…): next date and amount.',
    weekday: 5,
  },
  {
    id: 'card-verify',
    title: 'Credit Card Update / Next Payment Amount Verification',
    detail: 'For each card: check the next payment date and amount, then update the site with the current balance, available credit and upcoming payment.',
    monthDay: 23,
  },
];

const MADE_KEY = 'lifehub-self-repeats-made';

/** The most recent day (today or earlier) this rule falls on. */
function lastOccurrence(rule: RepeatRule, today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if ('weekday' in rule) {
    d.setDate(d.getDate() - ((d.getDay() - rule.weekday + 7) % 7));
    return d;
  }
  const clamp = (y: number, m: number) => Math.min(rule.monthDay, new Date(y, m + 1, 0).getDate());
  if (d.getDate() >= clamp(d.getFullYear(), d.getMonth())) return new Date(d.getFullYear(), d.getMonth(), clamp(d.getFullYear(), d.getMonth()));
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = (d.getMonth() + 11) % 12;
  return new Date(y, m, clamp(y, m));
}

/** Make any repeating Self task that's due and missing. Returns true when something was added. */
export function makeDueSelfRepeats(today = new Date()): boolean {
  const made = new Set(readSaved<string[]>(MADE_KEY, []));
  const items = loadSelfItems();
  const have = new Set(items.map(i => i.id));
  const add: SelfItem[] = [];
  for (const rule of SELF_REPEATS) {
    const day = lastOccurrence(rule, today);
    const key = localDayKey(day);
    const id = `self-rep-${rule.id}-${key}`;
    if (made.has(id)) continue;
    made.add(id);
    if (have.has(id)) continue;
    const at = day.toISOString();
    add.push({ id, title: rule.title, detail: rule.detail, done: false, starred: false, createdAt: at, updatedAt: at, due: key, ...(rule.home ? { home: rule.home } : {}) });
  }
  writeSaved(MADE_KEY, [...made].slice(-60));
  if (!add.length) return false;
  saveSelfItems([...add, ...items]);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SELF_ITEMS_EVENT));
  return true;
}
