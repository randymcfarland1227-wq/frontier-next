'use client';

/**
 * Task locks and habit-count goals.
 *
 * A task can be locked until (A) a site list is finished, (B) another task is done, or (C) a TickTick
 * habit has been checked in N times since a day. The lock sits on the task's priority entry
 * (`LaneEntry.lock`, cloud-synced with the rest of Priority). Habit counts come from the Worker
 * (`/api/ticktick/habit-count`) and are cached per browser so a lock shows its last known count offline.
 */

import { useEffect, useState } from 'react';
import { syncKeyHeader } from './cloudSync';
import { readSaved, writeSaved } from './storage';
import { getHabitSchedule } from './ticktickDone';
import { REFRESH_EVENT } from './syncNow';
import type { CompletionLedger } from './completions';
import { loadSiteLists, type SiteListStore } from './siteLists';
import { loadLedger } from './completions';
import { loadLanes, pinKey } from './priorityPins';
import type { SourceId } from './types';

const WORKER =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export type Lock =
  | { kind: 'task'; key: string; label: string }
  | { kind: 'list'; listId: string; label: string }
  | { kind: 'habit'; habitId: string; title: string; count: number; from: string };

/** A focus card that finishes itself after N check-ins of a TickTick habit. */
export type HabitGoal = { habitId: string; title: string; count: number; from: string; cleanupTaskId?: string };

const COUNTS_KEY = 'lifehub-habit-counts';
const HABITS_KEY = 'lifehub-habit-options';
const COUNTS_EVENT = 'lifehub:habit-counts';
type Counts = Record<string, { count: number; at: string }>;

const countKey = (habitId: string, from: string) => `${habitId.replace(/^habit-/, '')}@${from.replace(/-/g, '')}`;

/** Today as YYYY-MM-DD (the "since" a new count starts from). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function cachedHabitCount(habitId: string, from: string): number | undefined {
  return readSaved<Counts>(COUNTS_KEY, {})[countKey(habitId, from)]?.count;
}

const inflight = new Map<string, Promise<number | undefined>>();

/** Ask the Worker how many days the habit was completed since `from` (cached; one request at a time per habit). */
export function fetchHabitCount(habitId: string, from: string): Promise<number | undefined> {
  const k = countKey(habitId, from);
  const running = inflight.get(k);
  if (running) return running;
  const p = (async () => {
    try {
      const q = new URLSearchParams({ habitId: habitId.replace(/^habit-/, ''), from: from.replace(/-/g, '') });
      const res = await fetch(`${WORKER}/api/ticktick/habit-count?${q}`, { headers: syncKeyHeader(), cache: 'no-store' });
      if (!res.ok) return cachedHabitCount(habitId, from);
      const body = (await res.json()) as { ok?: boolean; count?: number };
      if (!body.ok || typeof body.count !== 'number') return cachedHabitCount(habitId, from);
      const all = readSaved<Counts>(COUNTS_KEY, {});
      if (all[k]?.count !== body.count) {
        writeSaved(COUNTS_KEY, { ...all, [k]: { count: body.count, at: new Date().toISOString() } });
        window.dispatchEvent(new CustomEvent(COUNTS_EVENT));
      }
      return body.count;
    } catch {
      return cachedHabitCount(habitId, from);
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/** Live check-in counts for the given habits (refetched on mount, on Refresh, and every 10 minutes). */
export function useHabitCounts(wanted: Array<{ habitId: string; from: string }>): (habitId: string, from: string) => number | undefined {
  const [, bump] = useState(0);
  const sig = wanted.map(w => countKey(w.habitId, w.from)).sort().join('|');
  useEffect(() => {
    if (!sig) return;
    const pull = () => wanted.forEach(w => void fetchHabitCount(w.habitId, w.from));
    pull();
    const on = () => bump(n => n + 1);
    const t = window.setInterval(pull, 10 * 60 * 1000);
    window.addEventListener(COUNTS_EVENT, on);
    window.addEventListener(REFRESH_EVENT, pull);
    window.addEventListener('lifehub:synced', pull);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(COUNTS_EVENT, on);
      window.removeEventListener(REFRESH_EVENT, pull);
      window.removeEventListener('lifehub:synced', pull);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return cachedHabitCount;
}

/** TickTick habits to pick from: the latest pull's list, remembered on this device. */
export function habitOptions(): Array<{ id: string; title: string }> {
  const live = (getHabitSchedule() || []).filter(h => h.id && h.title).map(h => ({ id: h.id, title: h.title! }));
  if (live.length) {
    writeSaved(HABITS_KEY, live);
    return live;
  }
  return readSaved<Array<{ id: string; title: string }>>(HABITS_KEY, []);
}

/** Is a task (pin key `source:id`) recorded as done in the completion log? */
export function taskDone(ledger: CompletionLedger | undefined, key: string): boolean {
  const i = key.indexOf(':');
  if (i < 0 || !ledger) return false;
  const prefix = `${key.slice(0, i)}::${key.slice(i + 1)}`;
  return Object.keys(ledger.entries).some(k => k === prefix || k.startsWith(`${prefix}::`));
}

export type LockState = { open: boolean; text: string; progress?: [number, number] };

/** Whether a lock has opened, and a plain line saying what it's waiting on. */
export function lockState(
  lock: Lock,
  ctx: { ledger?: CompletionLedger; lists?: SiteListStore; count?: (habitId: string, from: string) => number | undefined },
): LockState {
  if (lock.kind === 'task') {
    const open = taskDone(ctx.ledger, lock.key);
    return { open, text: open ? `Unlocked: “${lock.label}” is done` : `Locked until “${lock.label}” is done` };
  }
  if (lock.kind === 'list') {
    const list = ctx.lists?.[lock.listId];
    if (!list || list.gone) return { open: true, text: `Unlocked: the list “${lock.label}” is finished or gone` };
    const done = list.tasks.filter(id => taskDone(ctx.ledger, `${list.site}:${id}`)).length;
    const open = list.tasks.length > 0 && done >= list.tasks.length;
    return { open, text: open ? `Unlocked: “${lock.label}” is finished` : `Locked until the list “${lock.label}” is finished (${done} of ${list.tasks.length})`, progress: [done, list.tasks.length] };
  }
  const n = ctx.count?.(lock.habitId, lock.from);
  const open = n !== undefined && n >= lock.count;
  return {
    open,
    text: open
      ? `Unlocked: “${lock.title}” done ${lock.count} times`
      : `Locked until “${lock.title}” is done ${lock.count} times (${n ?? '?'} of ${lock.count} so far)`,
    progress: [n ?? 0, lock.count],
  };
}

/** The lock on a task right now, from what's saved on this device (used to refuse a check-off anywhere). */
export function lockNow(source: SourceId, id: string): LockState | undefined {
  const lock = loadLanes()[pinKey(source, id)]?.lock;
  return lock ? lockState(lock, { ledger: loadLedger(), lists: loadSiteLists(), count: cachedHabitCount }) : undefined;
}
