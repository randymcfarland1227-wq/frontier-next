import type { SourceId, SourceSnapshot } from './types';
import type { CompletionLedger } from './completions';
import { metricsAfterLocalComplete } from './actionable';
import { isConnectorSource } from './connectors';

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Source snapshots can resend an open row after a local completion. Project the ledger onto
 * each accepted snapshot so refreshes cannot revive it. TickTick ids repeat (recurring tasks, habits), so only today's Done hides them.
 */
export function hideLedgerDone(
  snapshots: Record<SourceId, SourceSnapshot>,
  ledger: CompletionLedger,
): Record<SourceId, SourceSnapshot> {
  const today = localDay(new Date().toISOString());
  const done = new Set<string>();
  for (const e of Object.values(ledger.entries)) {
    if (e.source === 'ticktick' && localDay(e.completedAt) !== today) continue;
    done.add(`${e.source}::${e.taskId}`);
  }
  let next = snapshots;
  for (const id of Object.keys(snapshots) as SourceId[]) {
    if (id === 'self') continue;
    let snap = next[id];
    if (!snap) continue;
    const isDone = (itemId: string) => done.has(`${id}::${itemId}`);
    const hide = new Set([
      ...snap.tasks.filter(t => t.status !== 'done' && isDone(t.id)).map(t => t.id),
      ...snap.featured.filter(f => isDone(f.id) && !snap!.tasks.some(t => t.id === f.id && t.status === 'done')).map(f => f.id),
    ]);
    if (!hide.size) continue;
    let metrics = snap.metrics;
    for (const itemId of hide) metrics = metricsAfterLocalComplete(id, { ...snap, metrics }, itemId);
    snap = {
      ...snap,
      metrics,
      tasks: isConnectorSource(id) ? snap.tasks.filter(t => !hide.has(t.id)) : snap.tasks.map(t => hide.has(t.id) ? {...t,status:'done'} : t),
      featured: snap.featured.filter(f => !hide.has(f.id)),
    };
    next = { ...next, [id]: snap };
  }
  return next;
}

