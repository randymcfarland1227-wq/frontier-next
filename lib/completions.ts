/** Completion ledger + review stats for Life Hub. */

import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { SOURCE_IDS, sourceById } from './sources';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { getFocusConfig, resolveFocusArea, type FocusAreaId } from './focusAreas';
import { collapseTickTickCopies, isRealCompletion, tickTickTitleKey } from './syncState';

export type CompletionEntry = {
  source: SourceId;
  taskId: string;
  completedAt: string; // ISO
  title?: string;
  /** Unchecked on the hub after it was done: the entry stays (so sync can't bring it back) but no
   *  longer counts, unless it was completed again after this. */
  reopenedAt?: string;
  /** Details needed to restore a locally dismissed task when its completion is undone. */
  task?: TaskItem;
  /** origin-done = the source reported it done; origin-snapshot = legacy "disappeared" (dropped) */
  via: 'hub' | 'origin-done' | 'origin-snapshot' | 'connector-diff' | 'self';
  /** Resolved via focus-areas.json at record time; persisted so history stays stable if maps change. */
  focusAreaId?: FocusAreaId;
  /** rulesVersion of focus-areas.json that produced focusAreaId (older → re-sorted) */
  focusRules?: number;
  /** Area was set explicitly (e.g. promoted idea) — never re-sorted */
  focusManual?: boolean;
  /** Timestamp of an explicit reviewed reclassification; newest wins across devices. */
  focusUpdatedAt?: string;
};

export type CompletionLedger = {
  /** key = `${source}::${taskId}`, or `${source}::${taskId}::${YYYY-MM-DD}` for daily habits */
  entries: Record<string, CompletionEntry>;
};

export type CompletionStats = {
  today: number;
  last7: number;
  month: number;
  allTime: number;
  bySource: Record<SourceId, number>;
  openAcrossSources: number;
  inventoryTasks: number;
};

function localDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * TickTick habits and recurring tasks keep one id forever, so TickTick completions count once
 * per day (not once all-time). Other sources: once per task.
 */
function ledgerKey(source: SourceId, taskId: string, at: string) {
  return source === 'ticktick' ? `${source}::${taskId}::${localDate(at)}` : `${source}::${taskId}`;
}

/**
 * Same task already recorded that day (covers older keys without a date). For TickTick, a
 * same-named task also counts as the same — overdue recurring copies share a name, not an id.
 */
function hasSameDay(ledger: CompletionLedger, source: SourceId, taskId: string, at: string, title?: string) {
  const day = localDate(at);
  const name = source === 'ticktick' ? tickTickTitleKey(title) : '';
  return Object.values(ledger.entries).some(
    e =>
      e.source === source &&
      localDate(e.completedAt) === day &&
      (e.taskId === taskId || (name !== '' && tickTickTitleKey(e.title) === name)),
  );
}

/** Done, or unchecked since (and not done again)? */
export const isReopened = (e: CompletionEntry) => Boolean(e.reopenedAt && e.reopenedAt >= e.completedAt);

/** Undo wins over an unchanged source status; only a dated new completion can supersede it. */
function reopenedEntries() {
  return Object.values(readSaved<CompletionLedger>(STORAGE_KEYS.completions, { entries: {} }).entries || {}).filter(entry => isRealCompletion(entry) && isReopened(entry));
}

export function restoreReopenedSnapshots(snapshots: Record<SourceId, SourceSnapshot>): Record<SourceId, SourceSnapshot> {
  let next = snapshots;
  for (const entry of reopenedEntries()) {
    // Self is restored in its own store; TickTick must be reopened in TickTick itself.
    if (entry.source === 'self' || entry.source === 'ticktick') continue;
    const snap = next[entry.source];
    if (!snap) continue;
    const task = snap.tasks.find(task => task.id === entry.taskId);
    // Old Role records stored just a title. Other missing rows need saved task details;
    // a payment entry, for example, must never be turned into a fabricated finance task.
    if (!task && !entry.task && !(entry.source === 'role' && /^(hubtask|cert|portfolio):/.test(entry.taskId))) continue;
    if (task?.completedAt && Date.parse(task.completedAt) > Date.parse(entry.reopenedAt!)) continue;
    if (task && task.status !== 'done') continue;
    const restored: TaskItem = { ...entry.task, ...task, id: entry.taskId, title: task?.title || entry.task?.title || entry.title || entry.taskId, status: 'open', completedAt: undefined };
    next = { ...next, [entry.source]: { ...snap, tasks: task ? snap.tasks.map(task => task.id === entry.taskId ? restored : task) : [...snap.tasks, restored] } };
  }
  return next;
}

export function loadLedger(): CompletionLedger {
  const saved = readSaved<CompletionLedger>(STORAGE_KEYS.completions, { entries: {} });
  const entries = collapseTickTickCopies(
    Object.fromEntries(Object.entries(saved.entries || {}).filter(([, e]) => isRealCompletion(e))),
  );
  if (Object.keys(entries).length !== Object.keys(saved.entries || {}).length) {
    saveLedger({ entries });
  }
  // Unchecked items stay stored as markers but aren't completions.
  return { entries: Object.fromEntries(Object.entries(entries).filter(([, e]) => !isReopened(e))) };
}

export function saveLedger(ledger: CompletionLedger) {
  // Keep the "unchecked" markers loadLedger leaves out, so a sync never revives those completions.
  const saved = readSaved<CompletionLedger>(STORAGE_KEYS.completions, { entries: {} }).entries || {};
  const entries = { ...ledger.entries };
  for (const [k, e] of Object.entries(saved)) if (!entries[k] && e && isReopened(e)) entries[k] = e;
  writeSaved(STORAGE_KEYS.completions, { entries });
}

const localDay = (iso?: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Uncheck a task done on the hub: every completion of it (any day) stops counting. */
export function reopenCompletion(source: SourceId, taskId: string, onlyDay?: string): CompletionLedger {
  const saved = readSaved<CompletionLedger>(STORAGE_KEYS.completions, { entries: {} }).entries || {};
  const at = new Date().toISOString();
  const entries = { ...saved };
  for (const [k, e] of Object.entries(saved)) {
    // Habits keep one id forever: `onlyDay` (YYYY-MM-DD, local) reopens just that day's check-in.
    if (onlyDay && localDay(e?.completedAt) !== onlyDay) continue;
    if (e?.source === source && e.taskId === taskId && !isReopened(e)) entries[k] = { ...e, reopenedAt: at };
  }
  writeSaved(STORAGE_KEYS.completions, { entries });
  return loadLedger();
}

/** Record a completion; dedupes by source+taskId (keeps earliest completedAt). */
export function recordCompletion(
  source: SourceId,
  taskId: string,
  opts?: {
    title?: string;
    via?: CompletionEntry['via'];
    at?: string;
    ledger?: CompletionLedger;
    /** Extra task fields focus rules can match on */
    task?: Partial<TaskItem>;
    /** Explicit area (e.g. from a promoted capture) — skips rule resolution */
    focusAreaId?: FocusAreaId;
  },
): CompletionLedger {
  const ledger = opts?.ledger ?? loadLedger();
  const completedAt = opts?.at || new Date().toISOString();
  const key = ledgerKey(source, taskId, completedAt);
  if (ledger.entries[key] || hasSameDay(ledger, source, taskId, completedAt, opts?.title)) return ledger;
  ledger.entries[key] = {
    source,
    taskId,
    completedAt,
    title: opts?.title,
    ...(opts?.task ? { task: { ...opts.task, id: taskId, title: opts.title || taskId, status: 'open' } } : {}),
    via: opts?.via || 'hub',
    ...(opts?.focusAreaId
      ? { focusManual: true }
      : { focusRules: getFocusConfig()?.rulesVersion ?? 1 }),
    focusAreaId: opts?.focusAreaId ?? resolveFocusArea({
      source,
      taskId,
      title: opts?.title,
      kind: opts?.task?.kind,
      projectId: opts?.task?.projectId,
      tags: opts?.task?.tags,
    }),
  };
  saveLedger(ledger);
  return ledger;
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function computeStats(
  ledger: CompletionLedger,
  snapshots: Record<SourceId, SourceSnapshot>,
): CompletionStats {
  const now = new Date();
  const todayStart = startOfLocalDay(now).getTime();
  const last7Start = todayStart - 6 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const bySource = Object.fromEntries(SOURCE_IDS.map(id => [id, 0])) as Record<SourceId, number>;
  let today = 0;
  let last7 = 0;
  let month = 0;
  let allTime = 0;

  for (const entry of Object.values(ledger.entries)) {
    allTime += 1;
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    const t = Date.parse(entry.completedAt);
    if (Number.isNaN(t)) continue;
    if (t >= todayStart) today += 1;
    if (t >= last7Start) last7 += 1;
    if (t >= monthStart) month += 1;
  }

  let openAcrossSources = 0;
  let inventoryTasks = 0;
  for (const id of SOURCE_IDS) {
    const tasks = snapshots[id]?.tasks || [];
    inventoryTasks += tasks.length;
    openAcrossSources += tasks.filter(task => task.status !== 'done').length;
  }

  return { today, last7, month, allTime, bySource, openAcrossSources, inventoryTasks };
}

export type SourceShare = {
  id: SourceId;
  name: string;
  count: number;
  percent: number;
};

export function sourceShares(stats: CompletionStats): SourceShare[] {
  const total = stats.allTime || 0;
  return SOURCE_IDS.map(id => {
    const count = stats.bySource[id] || 0;
    return {
      id,
      name: sourceById[id].shortName,
      count,
      percent: total ? Math.round((count / total) * 1000) / 10 : 0,
    };
  })
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Record tasks a source explicitly reports as done (open → done, or newly listed as done).
 * A task that merely disappears is NOT a completion — it may have been rescheduled,
 * filtered out of a "today" view, or regenerated by the origin.
 * Skips first-seen snapshots (no prior) to avoid flooding the ledger on first load.
 */
/**
 * A source's completion time as ISO. A bare date ("2026-10-07") would parse as UTC midnight
 * — the evening before in New York — so read it as local midday, never later than now.
 */
export function completionTime(raw: string | undefined, now = new Date()): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (m) {
    const noon = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
    return new Date(Math.min(noon, now.getTime())).toISOString();
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(Math.min(t, now.getTime())).toISOString();
}

export function diffSnapshotCompletions(
  source: SourceId,
  previous: SourceSnapshot | undefined,
  next: SourceSnapshot,
  ledger?: CompletionLedger,
): CompletionLedger {
  let current = ledger ?? loadLedger();
  if (!previous || !previous.refreshedAt) {
    return current;
  }
  // Static connector data may lag a live feed. A snapshot rejected by the merge must not log Done.
  if (Date.parse(next.refreshedAt) < Date.parse(previous.refreshedAt)) return current;
  const prevById = new Map((previous.tasks || []).map(t => [t.id, t]));
  const reopened = new Map(reopenedEntries().filter(entry => entry.source === source && source !== 'ticktick').map(entry => [entry.taskId, entry]));
  for (const task of next.tasks || []) {
    if (task.status !== 'done') continue;
    const undo = reopened.get(task.id);
    if (undo && (!task.completedAt || !(Date.parse(task.completedAt) > Date.parse(undo.reopenedAt!)))) continue;
    const prev = prevById.get(task.id);
    if (prev?.status === 'done') continue;
    // A done task we never saw open, with no date: we can't tell when it was done (e.g. old
    // finished Role Hub tasks appearing for the first time), so don't count it as done now.
    const at = completionTime(task.completedAt);
    if (!prev && !at) continue;
    current = recordCompletion(source, task.id, {
      title: task.title || prev?.title,
      via: source === 'self' ? 'self' : 'origin-done',
      at,
      ledger: current,
      task: { ...prev, ...task },
    });
  }
  return current;
}

export function emptyStats(): CompletionStats {
  return {
    today: 0,
    last7: 0,
    month: 0,
    allTime: 0,
    bySource: Object.fromEntries(SOURCE_IDS.map(id => [id, 0])) as Record<SourceId, number>,
    openAcrossSources: 0,
    inventoryTasks: 0,
  };
}

/**
 * Move an already-recorded completion to an earlier moment (e.g. a TickTick task logged late
 * counts on the day it was due). Only ever moves earlier, so every device and the backup
 * converge (merges keep the earliest time). Returns true if anything changed.
 */
export function moveCompletionEarlier(ledger: CompletionLedger, source: SourceId, taskId: string, at: string): boolean {
  let changed = false;
  for (const e of Object.values(ledger.entries)) {
    if (e.source === source && e.taskId === taskId && Date.parse(at) < Date.parse(e.completedAt)) {
      e.completedAt = at;
      changed = true;
    }
  }
  return changed;
}
