import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { metricsAfterLocalComplete } from './actionable';
import { pinKey } from './priorityPins';

export const LINKED_SHELF = 'linked';

/** Every open task / featured title across the sites, by pin key. */
export function titlesByKey(snaps: Partial<Record<SourceId, SourceSnapshot>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, snap] of Object.entries(snaps) as Array<[SourceId, SourceSnapshot | undefined]>) {
    if (!snap) continue;
    for (const x of [...snap.tasks, ...snap.featured]) if (!out.has(pinKey(id, x.id))) out.set(pinKey(id, x.id), x.title);
  }
  return out;
}

/**
 * Tasks linked into another task as subtasks stay on their own site, on a "Linked to a task" shelf
 * marked with the parent's name, and leave every count, pool and list there: only the parent counts.
 */
export function withLinkedShelves<T extends Partial<Record<SourceId, SourceSnapshot>>>(
  snaps: T,
  links: Map<string, string>,
  parentTitle: (key: string) => string,
): T {
  if (!links.size) return snaps;
  const out = { ...snaps } as Record<SourceId, SourceSnapshot>;
  for (const id of Object.keys(out) as SourceId[]) {
    const snap = out[id];
    if (!snap) continue;
    const linked = (x: { id: string }) => links.has(pinKey(id, x.id));
    const open = [...snap.tasks.filter(t => t.status !== 'done'), ...snap.featured].filter(linked);
    if (!open.length) continue;
    const ids = [...new Set(open.map(x => x.id))];
    let metrics = snap.metrics;
    for (const gid of ids) metrics = metricsAfterLocalComplete(id, { ...snap, metrics }, gid);
    // Not done, just counted under its parent: the done counters stay as they were.
    metrics = { ...metrics };
    for (const k of ['done', 'completedTasks']) {
      if (k in (snap.metrics || {})) metrics[k] = snap.metrics[k];
      else delete metrics[k];
    }
    const items: TaskItem[] = ids.map(gid => {
      const t = snap.tasks.find(x => x.id === gid);
      const f = snap.featured.find(x => x.id === gid);
      const base: TaskItem = t || { id: gid, title: f!.title, detail: f!.detail, status: 'open', ...(f!.originUrl ? { originUrl: f!.originUrl } : {}) };
      return { ...base, linkedTo: parentTitle(links.get(pinKey(id, gid))!) };
    });
    const keep = new Set(ids);
    out[id] = {
      ...snap,
      tasks: snap.tasks.filter(t => !(keep.has(t.id) && t.status !== 'done')),
      featured: snap.featured.filter(f => !keep.has(f.id)),
      metrics,
      shelves: [...(snap.shelves || []).filter(s => s.id !== LINKED_SHELF), { id: LINKED_SHELF, label: 'Linked to a task', items }],
    };
  }
  return out as T;
}
