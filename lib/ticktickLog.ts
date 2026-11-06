/**
 * Log a TickTick habit or task the way TickTick does: habits can be skipped / marked not done,
 * tasks can be closed as "won't do". Written through the Worker (backup key header); the row
 * shows the logged state at once and TickTick's next pull confirms it.
 */
import { syncKeyHeader } from './cloudSync';
import { TICKTICK_DAYLOG_EVENT, loadDayLog, saveDayLog, stampOfToday, unmarkTickTickHabit } from './ticktickDone';
import { projectIdFromTask } from './ticktickComplete';
import type { TaskItem } from './types';
import { useEffect, useState } from 'react';

const WORKER =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export type LogOutcome = 'skipped' | 'notdone' | 'wontdo';
export const LOG_LABEL: Record<LogOutcome, string> = { skipped: 'skipped', notdone: 'uncompleted', wontdo: "won't do" };

const KEY = 'lifehub-ticktick-logged';
const EVENT = 'lifehub:ticktick-logged';
type Logged = { day: string; map: Record<string, LogOutcome> };

function load(): Logged {
  const day = stampOfToday();
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Logged | null;
    if (v && v.day === day) return v;
  } catch {
    /* ignore */
  }
  return { day, map: {} };
}

function save(v: Logged) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Today's locally logged outcomes by task/habit id. */
export function useLoggedToday(): Record<string, LogOutcome> {
  const [v, setV] = useState(load);
  useEffect(() => {
    const on = () => setV(load());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v.map;
}

/**
 * Everything logged as not-done today, by TickTick feed id: marked here (Skip / Uncompleted / Won't do) or in the
 * TickTick app (the feed's skipped / notDone / won't-do lists). Every list that shows a TickTick item reads this so a
 * skipped habit is struck through everywhere, not just in the habits list.
 */
export function tickTickOffMap(): Record<string, LogOutcome> {
  const m: Record<string, LogOutcome> = { ...load().map };
  const d = loadDayLog();
  for (const id of d.skippedHabits) m[id] ??= 'skipped';
  for (const id of d.notDoneHabits || []) m[id] ??= 'notdone';
  for (const id of d.wontDoTasks) m[id] ??= 'wontdo';
  return m;
}

/** tickTickOffMap(), kept current as items are logged here or a TickTick pull lands. */
export function useTickTickOff(): Record<string, LogOutcome> {
  const [v, setV] = useState(tickTickOffMap);
  useEffect(() => {
    const on = () => setV(tickTickOffMap());
    window.addEventListener(EVENT, on);
    window.addEventListener(TICKTICK_DAYLOG_EVENT, on);
    // Day rolls over while the page is open.
    const timer = window.setInterval(on, 60_000);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener(TICKTICK_DAYLOG_EVENT, on);
      window.clearInterval(timer);
    };
  }, []);
  return v;
}

export function isHabitTask(t: { id: string; kind?: string }) {
  return t.kind === 'habit' || t.id.startsWith('habit-');
}

export async function logTickTick(task: Pick<TaskItem, 'id' | 'kind' | 'projectId' | 'originUrl'>, outcome: LogOutcome): Promise<boolean> {
  const habit = isHabitTask(task);
  if (habit && outcome === 'wontdo') return false;
  if (!habit && outcome !== 'wontdo') return false;
  const headers = { 'Content-Type': 'application/json', ...syncKeyHeader() };
  let body: Record<string, unknown>;
  let path: string;
  if (habit) {
    // TickTick's Skip lives in the habit's skipped dates; Uncompleted is a check-in with status 1.
    path = outcome === 'skipped' ? '/api/ticktick/habit-skip' : '/api/ticktick/habit-checkin';
    body = outcome === 'skipped' ? { habitId: task.id, stamp: stampOfToday(), skip: true } : { habitId: task.id, stamp: stampOfToday(), status: 1 };
  } else {
    const projectId = projectIdFromTask(task);
    if (!projectId) return false;
    path = '/api/ticktick/wontdo';
    body = { taskId: task.id, projectId };
  }
  // Show it at once, then write.
  const cur = load();
  save({ ...cur, map: { ...cur.map, [task.id]: outcome } });
  const log = loadDayLog();
  if (habit && outcome === 'skipped') saveDayLog({ ...log, skippedHabits: [...new Set([...log.skippedHabits, task.id])], notDoneHabits: (log.notDoneHabits || []).filter(id => id !== task.id) });
  else if (habit) saveDayLog({ ...log, notDoneHabits: [...new Set([...(log.notDoneHabits || []), task.id])], skippedHabits: log.skippedHabits.filter(id => id !== task.id) });
  else saveDayLog({ ...log, wontDoTasks: [...new Set([...log.wontDoTasks, task.id])] });
  try {
    const res = await fetch(`${WORKER}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) return true;
  } catch {
    /* fall through */
  }
  // Write failed (wrong/no key, offline): take the local mark back.
  const back = load();
  const { [task.id]: _gone, ...rest } = back.map;
  void _gone;
  save({ ...back, map: rest });
  return false;
}

/** Take back today's skip / not-done on a habit (here and on TickTick). */
export async function clearTickTickLog(habitId: string): Promise<boolean> {
  const cur = load();
  const log0 = loadDayLog();
  const wasSkip = cur.map[habitId] === 'skipped' || (cur.map[habitId] === undefined && log0.skippedHabits.includes(habitId));
  const { [habitId]: _gone, ...rest } = cur.map;
  void _gone;
  save({ ...cur, map: rest });
  const log = loadDayLog();
  saveDayLog({ ...log, skippedHabits: log.skippedHabits.filter((id) => id !== habitId), notDoneHabits: (log.notDoneHabits || []).filter((id) => id !== habitId) });
  if (!wasSkip) return unmarkTickTickHabit(habitId);
  try {
    const res = await fetch(`${WORKER}/api/ticktick/habit-skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
      body: JSON.stringify({ habitId, stamp: stampOfToday(), skip: false }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
