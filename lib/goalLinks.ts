import type { CompletionLedger } from './completions';
import { localDayKey } from './dayKey';
import type { SourceSnapshot, TaskItem } from './types';

/** A TickTick habit or recurring task tied to an ongoing goal. `id` is the TickTick feed id (habits: `habit-<id>`). */
export type GoalLink = { id: string; title: string; kind: 'habit' | 'task' };

export type GoalLinkStatus = { doneToday: boolean; last7: number; lastAt?: string };

const norm = (s: string) => s.trim().toLowerCase();

/** What can be linked: every habit and task in the last TickTick pull, plus habits known from the schedule. */
export function linkOptions(ticktick: SourceSnapshot | undefined, habits: Array<{ id: string; title: string }> = []): GoalLink[] {
  const out = new Map<string, GoalLink>();
  for (const t of ticktick?.tasks || []) {
    if (!t.title) continue;
    const kind = t.kind === 'habit' || t.id.startsWith('habit-') ? 'habit' : 'task';
    out.set(norm(t.title), { id: t.id, title: t.title, kind });
  }
  for (const h of habits) {
    if (!out.has(norm(h.title))) out.set(norm(h.title), { id: `habit-${h.id}`, title: h.title, kind: 'habit' });
  }
  return [...out.values()].sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'habit' ? -1 : 1));
}

/**
 * Has the linked habit/task been done today, and how often in the last 7 days? Matched in the completion log by
 * id, or by title (a recurring TickTick task gets a new id for each finished copy).
 */
export function linkStatus(link: GoalLink, ledger: CompletionLedger | undefined, now = new Date()): GoalLinkStatus {
  const today = localDayKey(now);
  const since = now.getTime() - 7 * 86400000;
  const days = new Set<string>();
  let lastAt: string | undefined;
  for (const e of Object.values(ledger?.entries || {})) {
    if (e.source !== 'ticktick') continue;
    if (e.taskId !== link.id && !(e.title && norm(e.title) === norm(link.title))) continue;
    const at = Date.parse(e.completedAt);
    if (!Number.isFinite(at)) continue;
    if (!lastAt || e.completedAt > lastAt) lastAt = e.completedAt;
    if (at >= since) days.add(localDayKey(new Date(at)));
  }
  return { doneToday: days.has(today), last7: days.size, lastAt };
}

/** One Venture Lab item shown under Active Pursuits. */
export type Pursuit = { id: string; title: string; status?: string; open: number; url?: string };

/**
 * Venture Lab ideas marked active or Building. Newer Venture Lab snapshots send them as the `pursuits` shelf;
 * older ones only send tasks on active items, so those are grouped by item name instead.
 */
export function activePursuits(income: SourceSnapshot | undefined): Pursuit[] {
  if (!income) return [];
  const openBy = new Map<string, number>();
  for (const t of income.tasks || []) {
    if (t.status === 'done' || !t.detail) continue;
    openBy.set(t.detail, (openBy.get(t.detail) || 0) + 1);
  }
  const shelf = income.shelves?.find((s) => s.id === 'pursuits');
  if (shelf) {
    return shelf.items.map((i: TaskItem) => ({ id: i.id, title: i.title, status: i.tag, open: openBy.get(i.title) || 0, url: i.originUrl }));
  }
  const seen = new Map<string, Pursuit>();
  for (const t of income.tasks || []) {
    if (!t.detail || seen.has(t.detail)) continue;
    seen.set(t.detail, { id: `name:${t.detail}`, title: t.detail, open: openBy.get(t.detail) || 0, url: t.originUrl });
  }
  return [...seen.values()];
}
