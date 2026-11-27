/**
 * Short-term focus card tasks in Doing Now (2026-11-06). A whole card list or a single task inside a
 * card can be sent to Doing Now. They pin under Self with ids `flist:<code>:<card>:<list>` and
 * `ftask:<code>:<card>:<list>:<task>`; the card stays the only record, so checking one off in
 * Doing Now marks it done on the card (saved like the card's own editor saves: change stamp + event,
 * so the cloud backup merges it).
 */
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { FOCUS_LIST_EVENT, ONGOING_KEY } from './ongoingGoals';
import { stampChanges } from './focusSync';
import type { FeaturedItem } from './types';
import { isProject } from './selfProjects';

type Task = { id: string; text: string; done: boolean; fin?: unknown; note?: string; due?: string };
type List = { id: string; name: string; tasks: Task[]; kind?: string };
type Card = { id: string; title: string; site?: string; done?: boolean; inFocus?: boolean; lists?: List[]; at?: string };
type Saved = { scope: string; items: Card[] };

/** The lists whose cards show in Focus tasks: code → storage key + label. */
export const FOCUS_PIN_LISTS = [
  { code: 'n', key: 'lifehub-focus-now2', tag: 'Right now' },
  { code: 'w', key: 'lifehub-focus-weeks2', tag: 'Next few weeks' },
  { code: 'o', key: ONGOING_KEY, tag: 'Ongoing' },
] as const;

export const focusCardId = (code: string, cardId: string) => `fcard:${code}:${cardId}`;
export const focusListId = (code: string, cardId: string, listId: string) => `flist:${code}:${cardId}:${listId}`;
export const focusTaskId = (code: string, cardId: string, listId: string, taskId: string) =>
  `ftask:${code}:${cardId}:${listId}:${taskId}`;
export const isFocusPinId = (id: string) => id.startsWith('fcard:') || id.startsWith('flist:') || id.startsWith('ftask:') || id.startsWith('brief:');
/** Daily Brief rows with no site item (calendar appointments) pin as `self:brief:<id>`; the title lives on the pin itself. */
function briefPinItems(): Array<FeaturedItem & { id: string }> {
  const lanes = readSaved<Record<string, { lane?: string | null; title?: string }>>(STORAGE_KEYS.priorityLanes, {});
  return Object.entries(lanes)
    .filter(([k, e]) => k.startsWith('self:brief:') && e?.lane && e.title)
    .map(([k, e]) => ({ id: k.slice(5), title: e.title!, detail: 'From the Daily Brief', meta: 'Appointment', completable: true, tag: 'Brief' }) as FeaturedItem & { id: string });
}

const load = (key: string) => readSaved<Saved>(key, { scope: '', items: [] });
const shown = (code: string, c: Card) => !c.done && (code !== 'o' || Boolean(c.inFocus) || isProject(c));
const real = (t: Task) => !t.fin;

/** Every open focus task and every focus list with open tasks, as Doing Now items (source self). */
export function focusPinItems(): Array<FeaturedItem & { id: string }> {
  const out: Array<FeaturedItem & { id: string }> = [];
  for (const { code, key, tag } of FOCUS_PIN_LISTS) {
    for (const card of load(key).items || []) {
      if (!card || card.done) continue;
      // The whole card: every task in all its lists. Every open project, short-term focus card and goal can be
      // pinned (and found by Doing Now's search) as a whole, even with no open steps.
      const all = (card.lists || []).filter((l) => l.kind !== 'notes' && l.kind !== 'habits').flatMap((l) => l.tasks.filter(real));
      const allOpen = all.filter((t) => !t.done);
      const project = isProject(card);
      const goal = !project && code === 'o' && !card.inFocus;
      const kind = project ? 'Project' : goal ? 'Goal' : 'Short-term focus';
      out.push({
        id: focusCardId(code, card.id),
        title: card.title,
        detail: project ? 'Project · open to see lists, bills and details'
          : allOpen.length ? `${kind} · ${all.length - allOpen.length} of ${all.length} done · next: ${allOpen[0].text}`
          : `${kind} · open to add steps`,
        meta: project ? 'Project' : goal ? 'Goal' : 'Focus goal',
        completable: !project && !goal && allOpen.length > 0,
        tag: kind,
        steps: project || !all.length ? undefined : all.map((t) => ({ id: t.id, text: t.text, done: t.done })),
      } as FeaturedItem & { id: string });
      // Lists and single steps stay limited to what shows in Short-term focus / projects.
      if (!shown(code, card)) continue;
      for (const l of card.lists || []) {
        if (l.kind === 'notes' || l.kind === 'habits') continue;
        const tasks = l.tasks.filter(real);
        const open = tasks.filter((t) => !t.done);
        if (!open.length) continue;
        out.push({
          id: focusListId(code, card.id, l.id),
          title: `${card.title} · ${l.name}`,
          detail: `${tasks.length - open.length} of ${tasks.length} done · next: ${open[0].text}`,
          meta: 'Focus list',
          completable: true,
          tag: 'List',
          steps: tasks.map((t) => ({ id: t.id, text: t.text, done: t.done })),
        } as FeaturedItem & { id: string });
        for (const t of open) {
          out.push({
            id: focusTaskId(code, card.id, l.id, t.id),
            title: t.text,
            detail: [`${card.title} · ${l.name}`, t.note || ''].filter(Boolean).join(' — '),
            meta: 'Focus task',
            completable: true,
            tag: tag,
          } as FeaturedItem & { id: string });
        }
      }
    }
  }
  return [...out, ...briefPinItems()];
}

/** Resolve an existing card's pin identity; never create a second task or guess its list. */
export function focusCardPinKey(cardId: string): string | undefined {
  const available = new Set(focusPinItems().map(item => item.id));
  for (const { code } of FOCUS_PIN_LISTS) {
    const id = focusCardId(code, cardId);
    if (available.has(id)) return `self:${id}`;
  }
}

/** Pin key (`self:ftask:…`) for one open step on a card, when Doing Now can show it; never guesses. */
export function focusTaskPinKey(cardId: string, listId: string, taskId: string, available = new Set(focusPinItems().map(item => item.id))): string | undefined {
  for (const { code } of FOCUS_PIN_LISTS) {
    const id = focusTaskId(code, cardId, listId, taskId);
    if (available.has(id)) return `self:${id}`;
  }
}

/**
 * Mark a focus task (or every open task in a focus list) done on its card.
 * Returns true when it found the card record.
 */
export function completeFocusPin(id: string, done = true): boolean {
  if (id.startsWith('brief:')) return true;
  for (const { code, key } of FOCUS_PIN_LISTS) {
    const saved = load(key);
    const items = saved.items || [];
    let hit = false;
    const next = items.map((card) => {
      if (!card?.lists) return card;
      let changed = false;
      const whole = focusCardId(code, card.id) === id;
      const lists = card.lists.map((l) => {
        if (whole) {
          changed = true;
          return { ...l, tasks: l.tasks.map((t) => (real(t) ? { ...t, done } : t)) };
        }
        if (focusListId(code, card.id, l.id) === id) {
          changed = true;
          return { ...l, tasks: l.tasks.map((t) => (real(t) ? { ...t, done } : t)) };
        }
        if (!id.startsWith(`ftask:${code}:${card.id}:${l.id}:`)) return l;
        const tasks = l.tasks.map((t) => {
          if (focusTaskId(code, card.id, l.id, t.id) !== id) return t;
          changed = true;
          return { ...t, done };
        });
        return { ...l, tasks };
      });
      if (!changed) return card;
      hit = true;
      return { ...card, lists };
    });
    if (!hit) continue;
    const stamped = stampChanges(key, items, next);
    writeSaved(key, { ...saved, items: stamped });
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: key }));
    return true;
  }
  return false;
}
