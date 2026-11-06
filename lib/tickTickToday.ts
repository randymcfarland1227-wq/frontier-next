import type { CompletionLedger } from "./completions";
import { localDayKey } from "./dayKey";
import type { SourceSnapshot } from "./types";
import type { LogOutcome } from "./ticktickLog";

/** `off`: logged as skipped / uncompleted / won't do today (struck through like done, labelled). */
export type TodayTask = { title: string; done: boolean; off?: LogOutcome };

/**
 * Today's TickTick items whose title matches `re`: still-open ones (habits, plus tasks due by today)
 * and ones ticked off today (from the completion ledger). Items in `off` (tickTickOffMap) come back marked
 * skipped / uncompleted. Still-open first, then skipped, then done.
 */
export function tickTickToday(
  re: RegExp,
  ticktick: SourceSnapshot | undefined,
  ledger: CompletionLedger | undefined,
  day: string,
  off: Record<string, LogOutcome> = {},
  /** Titles for logged ids the feed no longer lists (TickTick can drop a skipped habit from today). */
  nameOf: (id: string) => string | undefined = () => undefined,
): TodayTask[] {
  const seen = new Map<string, TodayTask>();
  const key = (t: string) => t.trim().toLowerCase();
  for (const e of Object.values(ledger?.entries || {})) {
    if (
      e.source !== "ticktick" ||
      !e.title ||
      !re.test(e.title) ||
      localDayKey(new Date(e.completedAt)) !== day
    )
      continue;
    seen.set(key(e.title), { title: e.title, done: true });
  }
  for (const t of ticktick?.tasks || []) {
    if (!re.test(t.title) || seen.has(key(t.title))) continue;
    if (t.kind !== "habit" && t.due && t.due > day) continue;
    seen.set(key(t.title), off[t.id] ? { title: t.title, done: false, off: off[t.id] } : { title: t.title, done: false });
  }
  for (const [id, how] of Object.entries(off)) {
    if ((ticktick?.tasks || []).some((t) => t.id === id)) continue;
    const title = nameOf(id);
    if (!title || !re.test(title) || seen.has(key(title))) continue;
    seen.set(key(title), { title, done: false, off: how });
  }
  const rank = (t: TodayTask) => (t.done ? 2 : t.off ? 1 : 0);
  return [...seen.values()].sort((a, b) => rank(a) - rank(b));
}
