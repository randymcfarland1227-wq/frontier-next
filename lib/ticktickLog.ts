/**
 * Log a TickTick habit or task the way TickTick does: habits can be skipped / marked not done,
 * tasks can be closed as "won't do". Written through the Worker (backup key header); the row
 * shows the logged state at once and TickTick's next pull confirms it.
 */
import { syncKeyHeader } from './cloudSync';
import { loadDayLog, saveDayLog, stampOfToday } from './ticktickDone';
import { projectIdFromTask } from './ticktickComplete';
import type { TaskItem } from './types';
import { useEffect, useState } from 'react';

const WORKER =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export type LogOutcome = 'skipped' | 'notdone' | 'wontdo';
export const LOG_LABEL: Record<LogOutcome, string> = { skipped: 'skipped', notdone: 'not done', wontdo: "won't do" };

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
    path = '/api/ticktick/habit-checkin';
    body = { habitId: task.id, stamp: stampOfToday(), status: 1 };
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
  if (habit) saveDayLog({ ...log, skippedHabits: [...new Set([...log.skippedHabits, task.id])] });
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
