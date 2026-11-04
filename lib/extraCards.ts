/**
 * Cards added on Life Hub that aren't in the Radall sheet (yet) — e.g. a placeholder for a card whose figures
 * aren't known. Cloud-synced as `extraCards` (union by id, newest edit wins — never deleted, only `removed`).
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { cardSummaries, type MoneyModel } from './money';
import { metaName, type MoneyMeta } from './moneyMeta';
import { addDays, dayKey, daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export type ExtraCard = {
  id: string;
  name: string;
  /** Credit limit, balance and monthly fee are all optional placeholders until real figures arrive */
  limit?: number;
  balance?: number;
  fee?: number;
  /** Payment due day each month (1–31) and the minimum payment */
  dueDay?: number;
  min?: number;
  note?: string;
  removed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const EXTRA_CARDS_EVENT = 'lifehub:extra-cards';

export function loadExtraCards(): ExtraCard[] {
  return readSaved<ExtraCard[]>(STORAGE_KEYS.extraCards, []);
}

function save(list: ExtraCard[]) {
  writeSaved(STORAGE_KEYS.extraCards, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EXTRA_CARDS_EVENT));
}

export function addExtraCard(input: Omit<ExtraCard, 'id' | 'createdAt' | 'updatedAt'>) {
  const at = new Date().toISOString();
  save([{ ...input, name: input.name.trim(), id: `card-${Date.now()}`, createdAt: at, updatedAt: at }, ...loadExtraCards()]);
}

export function updateExtraCard(id: string, patch: Partial<Omit<ExtraCard, 'id' | 'createdAt'>>) {
  const at = new Date().toISOString();
  save(loadExtraCards().map(c => (c.id === id ? { ...c, ...patch, updatedAt: at } : c)));
}

export function useExtraCards(): ExtraCard[] {
  const [cards, setCards] = useState<ExtraCard[]>(() => loadExtraCards());
  useEffect(() => {
    const reload = () => setCards(loadExtraCards());
    window.addEventListener(EXTRA_CARDS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(EXTRA_CARDS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return cards.filter(c => !c.removed);
}

/** Due-key prefix of a card payment made on Life Hub (card added here, or a sheet card given a due day here). */
export const hubCardPrefix = (name: string) => `money:hubcard:${metaName(name)}:`;

/**
 * Card payments Life Hub makes: cards added here with a due day, and sheet cards with no due date in
 * the sheet that were given one here (meta `card:<name>` dueDay / min). Monthly, in the calendar's bill shape.
 */
export function hubCardDues(model: MoneyModel | null, meta: MoneyMeta, cards: ExtraCard[], paid: Set<string>, today = new Date(), back = 45, ahead = 120, keepPaid = false): BillDue[] {
  const sums = cardSummaries(model);
  const sheetNames = new Set(sums.map(c => metaName(c.name)));
  const list: Array<{ name: string; day: number; min?: number }> = [];
  for (const c of cards) if (!c.removed && c.dueDay && !sheetNames.has(metaName(c.name))) list.push({ name: c.name, day: c.dueDay, min: c.min });
  for (const c of sums) {
    const m = meta[`card:${metaName(c.name)}`];
    if (m?.dueDay && !c.minDate?.text?.trim()) list.push({ name: c.name.replace(/\s+/g, ' '), day: m.dueDay, min: m.min ?? (Number((c.min?.text || '').replace(/[$,\s]/g, '')) || undefined) });
  }
  const t = startOfDay(today);
  const from = addDays(t, -back);
  const to = addDays(t, ahead);
  const out: BillDue[] = [];
  for (const c of list) {
    for (let i = -2; i <= 5; i++) {
      const last = new Date(t.getFullYear(), t.getMonth() + i + 1, 0).getDate();
      const d = new Date(t.getFullYear(), t.getMonth() + i, Math.min(c.day, last));
      if (d < from || d > to) continue;
      const due = dayKey(d);
      const key = `${hubCardPrefix(c.name)}${due}`;
      if (!keepPaid && paid.has(key)) continue;
      out.push({ bill: { id: key, name: c.name, amount: c.min, kind: 'card', notes: 'Card payment · due day set on Life Hub' }, due, days: daysBetween(t, fromDayKey(due)), key });
    }
  }
  return out;
}
