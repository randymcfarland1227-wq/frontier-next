import type { CompletionLedger } from "./completions";
import { localDayKey } from "./dayKey";
import type { SourceSnapshot } from "./types";

export type TodayTask = { title: string; done: boolean };

/**
 * Today's TickTick items whose title matches `re`: still-open ones (habits, plus tasks due by today)
 * and ones ticked off today (from the completion ledger). Not-done first.
 */
export function tickTickToday(
  re: RegExp,
  ticktick: SourceSnapshot | undefined,
  ledger: CompletionLedger | undefined,
  day: string,
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
    seen.set(key(t.title), { title: t.title, done: false });
  }
  return [...seen.values()].sort((a, b) => Number(a.done) - Number(b.done));
}
