/**
 * Daily Rhythm / Short-term / ongoing focus cards in the cloud backup.
 *
 * Each card is one synced record, keyed "<list key>::<card id>", carrying the card itself and when
 * it last changed; newest change wins (the same rule as every other synced map). Deleting a card
 * leaves a tombstone (`entry: null`) so the delete reaches other devices instead of the card
 * coming back. Seeded cards are stamped with the epoch so a seed never beats a real edit or delete.
 */

import { readSaved, writeSaved } from './storage';

export const FOCUS_LIST_KEYS = [
  'lifehub-focus-now2',
  'lifehub-focus-weeks2',
  'lifehub-focus-ongoing',
  'lifehub-focus-nut2',
  'lifehub-focus-marvel-goals',
  'lifehub-focus-fit-areas',
] as const;
export const FOCUS_TOMBS_KEY = 'lifehub-focus-tombs';
export const EPOCH = '1970-01-01T00:00:00.000Z';
/** The fitness list is a plain array; every other list is `{ scope, items }`. */
const ARRAY_KEY = 'lifehub-focus-fit-areas';

export type FocusRecord = { entry: Record<string, unknown> | null; at: string };
export type FocusSynced = Record<string, FocusRecord>;
type Card = Record<string, unknown> & { id: string; at?: string };

const recKey = (list: string, id: string) => `${list}::${id}`;

function itemsOf(list: string): Card[] {
  const raw = readSaved<unknown>(list, list === ARRAY_KEY ? [] : { scope: '', items: [] });
  const items = list === ARRAY_KEY ? raw : (raw as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Card[]).filter(i => i && typeof i.id === 'string') : [];
}

function save(list: string, items: Card[]) {
  if (list === ARRAY_KEY) return writeSaved(list, items);
  const raw = readSaved<{ scope?: string }>(list, { scope: '' });
  writeSaved(list, { scope: raw?.scope ?? '', items });
}

export const readTombs = () => readSaved<Record<string, string>>(FOCUS_TOMBS_KEY, {});

export function addTomb(list: string, id: string) {
  writeSaved(FOCUS_TOMBS_KEY, { ...readTombs(), [recKey(list, id)]: new Date().toISOString() });
}

const same = (a: Card, b: Card) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

/**
 * Called whenever a list is saved by the UI: stamps cards that were added or edited with "now" and
 * leaves a tombstone for cards that were removed. Returns the list to store.
 */
export function stampChanges<T extends { id: string; at?: string }>(list: string, prev: T[], next: T[]): T[] {
  const before = new Map(prev.map(i => [i.id, i]));
  const now = new Date().toISOString();
  const out = next.map(i => (before.has(i.id) && same(before.get(i.id) as unknown as Card, i as unknown as Card) ? i : { ...i, at: now }));
  const kept = new Set(next.map(i => i.id));
  const tombs = readTombs();
  let tombed = false;
  for (const id of before.keys()) {
    if (!kept.has(id)) {
      tombs[recKey(list, id)] = now;
      tombed = true;
    }
  }
  for (const i of next) {
    if (tombs[recKey(list, i.id)]) {
      delete tombs[recKey(list, i.id)];
      tombed = true;
    }
  }
  if (tombed) writeSaved(FOCUS_TOMBS_KEY, tombs);
  return out;
}

export function readFocusState(): FocusSynced {
  const out: FocusSynced = {};
  for (const [key, at] of Object.entries(readTombs())) out[key] = { entry: null, at };
  for (const list of FOCUS_LIST_KEYS)
    for (const card of itemsOf(list)) {
      const k = recKey(list, card.id);
      const at = typeof card.at === 'string' ? card.at : EPOCH;
      // A card newer than its own tombstone (re-added after a delete) wins.
      if (!out[k] || at > out[k].at) out[k] = { entry: card, at };
    }
  return out;
}

/** Write the merged records back into the lists; returns true if anything changed. */
export function writeFocusState(next: FocusSynced): boolean {
  let changed = false;
  const tombs: Record<string, string> = {};
  for (const [k, rec] of Object.entries(next)) if (rec && rec.entry === null && typeof rec.at === 'string') tombs[k] = rec.at;
  if (JSON.stringify(tombs) !== JSON.stringify(readTombs())) {
    writeSaved(FOCUS_TOMBS_KEY, tombs);
    changed = true;
  }
  for (const list of FOCUS_LIST_KEYS) {
    const local = itemsOf(list);
    const live = new Map<string, Card>();
    for (const [k, rec] of Object.entries(next))
      if (k.startsWith(`${list}::`) && rec?.entry) live.set(k.slice(list.length + 2), rec.entry as Card);
    const ordered: Card[] = [];
    for (const item of local) {
      const merged = live.get(item.id);
      if (merged) {
        ordered.push(merged);
        live.delete(item.id);
      }
    }
    for (const rest of live.values()) ordered.push(rest);
    if (JSON.stringify(ordered) !== JSON.stringify(local)) {
      save(list, ordered);
      changed = true;
    }
  }
  return changed;
}
