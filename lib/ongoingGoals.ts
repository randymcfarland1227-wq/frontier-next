'use client';

/**
 * Ongoing goals: directions, not one-time tasks ("sourcing income" for Move OS). Created from Self's
 * capture box, they live in Today → Short-term focus as cards, coloured by the site they belong to.
 * Stored in the same typed-list shape the focus lists use, under their own key.
 */

import { readSaved, writeSaved } from './storage';

export const ONGOING_KEY = 'lifehub-focus-ongoing';
/** Fired after any focus list is written elsewhere, so a mounted list re-reads its key. */
export const FOCUS_LIST_EVENT = 'lifehub:focus-list';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function addOngoingGoal(goal: { title: string; note?: string; why?: string; site?: string }) {
  const state = readSaved<{ scope: string; items: Array<Record<string, unknown>> }>(ONGOING_KEY, { scope: '', items: [] });
  const item = {
    id: `${Date.now()}`,
    title: goal.title.trim(),
    note: goal.note?.trim() || undefined,
    why: goal.why?.trim() || undefined,
    site: goal.site || undefined,
    ongoing: true,
    added: todayKey(),
  };
  writeSaved(ONGOING_KEY, { scope: state.scope, items: [...state.items, item] });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: ONGOING_KEY }));
}
