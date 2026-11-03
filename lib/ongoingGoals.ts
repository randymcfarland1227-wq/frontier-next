'use client';

/**
 * Ongoing goals: directions, not one-time tasks ("sourcing income" for Move OS). Created from Self's
 * capture box, they live in Today → Short-term focus as cards, coloured by the site they belong to.
 * Stored in the same typed-list shape the focus lists use, under their own key.
 */

import { readSaved, writeSaved } from './storage';
import { addTomb, EPOCH } from './focusSync';

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
    at: new Date().toISOString(),
  };
  writeSaved(ONGOING_KEY, { scope: state.scope, items: [...state.items, item] });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: ONGOING_KEY }));
}

/** Ids currently in the ongoing list (used to tuck away the originals a goal replaced, per device). */
export function readOngoingIds(): string[] {
  return readSaved<{ items?: Array<{ id?: string }> }>(ONGOING_KEY, { items: [] }).items?.map(i => String(i.id)) ?? [];
}

const SEEDED_KEY = 'lifehub-seeded-goals';
type Seed = { id: string; title: string; note?: string; why?: string; site?: string; section?: string; lists?: unknown[] };

/**
 * One-time moves of things Randy already had (Move OS goals, the physical goals) into focus lists.
 * Each id is remembered, so deleting the card later never brings it back.
 */
function seedInto(storageKey: string, shape: 'list' | 'array', seeds: Seed[]): boolean {
  const seeded = readSaved<string[]>(SEEDED_KEY, []);
  const raw = readSaved<unknown>(storageKey, shape === 'list' ? { scope: '', items: [] } : []);
  const items: Array<Record<string, unknown>> = shape === 'list' ? ((raw as { items?: Array<Record<string, unknown>> }).items ?? []) : (raw as Array<Record<string, unknown>>);
  const fresh = seeds.filter(s => !seeded.includes(s.id) && !items.some(i => i.id === s.id));
  if (!fresh.length) return false;
  // Seeds carry the epoch, so they never beat a later edit or delete from any device.
  const added = fresh.map(s => ({ ...s, ongoing: true, added: todayKey(), at: EPOCH }));
  const next = [...items, ...added];
  writeSaved(storageKey, shape === 'list' ? { scope: (raw as { scope?: string }).scope ?? '', items: next } : next);
  writeSaved(SEEDED_KEY, [...seeded, ...fresh.map(s => s.id)]);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: storageKey }));
  return true;
}
export const seedOngoingGoals = (seeds: Seed[]) => seedInto(ONGOING_KEY, 'list', seeds);
/** The fitness focus list is a plain array under its own key. */
export const seedFitnessFocus = (seeds: Seed[]) => seedInto('lifehub-focus-fit-areas', 'array', seeds);

/** The fitness card used to live in the fitness list; it's an ongoing goal (still shown under Fitness focus). */
export function moveFitnessToOngoing(id: string): boolean {
  const fit = readSaved<Array<Record<string, unknown>>>('lifehub-focus-fit-areas', []);
  const hit = fit.find(i => i.id === id);
  if (!hit) return false;
  writeSaved('lifehub-focus-fit-areas', fit.filter(i => i.id !== id));
  addTomb('lifehub-focus-fit-areas', id);
  const ongoing = readSaved<{ scope: string; items: Array<Record<string, unknown>> }>(ONGOING_KEY, { scope: '', items: [] });
  if (!ongoing.items.some(i => i.id === id)) writeSaved(ONGOING_KEY, { scope: ongoing.scope, items: [...ongoing.items, { ...hit, ongoing: true, section: 'fitness', at: new Date().toISOString() }] });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: 'lifehub-focus-fit-areas' }));
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: ONGOING_KEY }));
  }
  return true;
}
