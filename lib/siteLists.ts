'use client';

/**
 * Site lists: the middle rung of task → list → goal.
 *  - A list groups tasks from ONE site. Its tasks leave the pool (they live only inside the list) and the
 *    list shows up in that site as a single task ("Storefront · 3 left").
 *  - A goal can link a list; the list then stays in the pool too (lib/siteLists never touches goals).
 * Stored as a map id → list; deleting leaves `gone: true` so the delete syncs. Newest change wins in the cloud.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { readSaved, writeSaved } from './storage';
import { metricsAfterLocalComplete } from './actionable';
import { sourceById } from './sources';

export const SITE_LISTS_KEY = 'lifehub-site-lists';
export const SITE_LISTS_EVENT = 'lifehub:site-lists';
export const OPEN_SITE_LIST_EVENT = 'lifehub:open-site-list';

export type SiteList = { id: string; site: SourceId; name: string; tasks: string[]; at: string; gone?: boolean; alsoIn?: SourceId[] };
export type SiteListStore = Record<string, SiteList>;

const now = () => new Date().toISOString();
export const loadSiteLists = (): SiteListStore => readSaved<SiteListStore>(SITE_LISTS_KEY, {});
function put(next: SiteListStore) {
  writeSaved(SITE_LISTS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SITE_LISTS_EVENT));
}
const live = (s: SiteListStore) => Object.values(s).filter(l => l && !l.gone);

/** Which list (if any) a task already belongs to — a task is in at most one list. */
export function listOfTask(store: SiteListStore, site: SourceId, taskId: string): SiteList | undefined {
  return live(store).find(l => l.site === site && l.tasks.includes(taskId));
}

export function createSiteList(site: SourceId, name: string, taskIds: string[]): string {
  const store = loadSiteLists();
  const id = `sl-${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  // A task moves out of any list it was in.
  for (const l of live(store)) if (l.site === site && l.tasks.some(t => taskIds.includes(t))) store[l.id] = { ...l, tasks: l.tasks.filter(t => !taskIds.includes(t)), at: now() };
  store[id] = { id, site, name: name.trim() || 'New list', tasks: [...new Set(taskIds)], at: now() };
  put(store);
  return id;
}

export function addToSiteList(id: string, taskIds: string[]) {
  const store = loadSiteLists();
  const list = store[id];
  if (!list || list.gone) return;
  for (const l of live(store)) if (l.id !== id && l.site === list.site && l.tasks.some(t => taskIds.includes(t))) store[l.id] = { ...l, tasks: l.tasks.filter(t => !taskIds.includes(t)), at: now() };
  store[id] = { ...list, tasks: [...new Set([...list.tasks, ...taskIds])], at: now() };
  put(store);
}

/** Taking a task out of a list puts it back in the pool. */
export function removeFromSiteList(id: string, taskId: string) {
  const store = loadSiteLists();
  const list = store[id];
  if (!list) return;
  store[id] = { ...list, tasks: list.tasks.filter(t => t !== taskId), at: now() };
  put(store);
}

export function renameSiteList(id: string, name: string) {
  const store = loadSiteLists();
  if (store[id]) put({ ...store, [id]: { ...store[id], name: name.trim() ? name.trimStart() : store[id].name, at: now() } });
}

/** Deleting a list puts all its tasks back in the pool. */
export function deleteSiteList(id: string) {
  const store = loadSiteLists();
  if (store[id]) put({ ...store, [id]: { ...store[id], gone: true, at: now() } });
}

/** Show this list as a benchmark in other sites (it keeps living, and finishing, in its own site). */
export function setListAlsoIn(id: string, sites: SourceId[]) {
  const store = loadSiteLists();
  if (store[id]) put({ ...store, [id]: { ...store[id], alsoIn: sites, at: now() } });
}

export function useSiteListStore(): SiteListStore {
  const [store, setStore] = useState<SiteListStore>(() => loadSiteLists());
  useEffect(() => {
    const reload = () => setStore(loadSiteLists());
    window.addEventListener(SITE_LISTS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(SITE_LISTS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return store;
}

/** The list as it stands in the live data: its still-open tasks and how many it started with. */
export function viewOfList(list: SiteList, snapshots: Partial<Record<SourceId, SourceSnapshot>>) {
  const open = (snapshots[list.site]?.tasks || []).filter(t => t.status !== 'done' && list.tasks.includes(t.id));
  const total = list.tasks.length;
  return { open, total, done: Math.max(0, total - open.length) };
}

/**
 * The pool, with lists applied: every open task inside a list leaves its site's task list and counts,
 * and the list stands in as ONE task. A list with nothing left open disappears (it's done).
 */
export function applySiteLists<T extends Partial<Record<SourceId, SourceSnapshot>>>(snaps: T, store: SiteListStore): T {
  const out = { ...snaps } as Record<SourceId, SourceSnapshot>;
  for (const list of live(store)) {
    const snap = out[list.site];
    if (!snap) continue;
    const { open, total } = viewOfList(list, out);
    const ids = new Set(list.tasks);
    let metrics = { ...snap.metrics };
    for (const t of open) metrics = metricsAfterLocalComplete(list.site, { ...snap, metrics }, t.id);
    for (const k of ['done', 'completedTasks']) {
      if (k in (snap.metrics || {})) metrics[k] = snap.metrics[k];
      else delete metrics[k];
    }
    const tasks = snap.tasks.filter(t => !(ids.has(t.id) && t.status !== 'done'));
    const featured = snap.featured.filter(f => !ids.has(f.id));
    if (open.length) {
      const due = open.map(t => t.due).filter(Boolean).sort()[0];
      const row: TaskItem = {
        id: `list:${list.id}`,
        title: list.name,
        detail: `${open.length} of ${total} left`,
        status: 'open',
        kind: 'list',
        tag: 'List',
        ...(due ? { due } : {}),
      };
      tasks.push(row);
      // The list counts once: add back what one task counted for on this site (each site keeps its own count key).
      const probe = metricsAfterLocalComplete(list.site, snap, open[0].id);
      for (const k of Object.keys(probe))
        if (!['done', 'completedTasks'].includes(k) && Number.isFinite(snap.metrics[k]) && probe[k] < snap.metrics[k] && Number.isFinite(metrics[k]))
          metrics[k] = Number(metrics[k]) + (snap.metrics[k] - probe[k]);
    }
    out[list.site] = { ...snap, tasks, featured, metrics };
  }
  // Benchmarks: a list from another site, mirrored as a row (not counted again) that finishes when the list does.
  for (const list of live(store)) {
    if (!list.alsoIn?.length) continue;
    const { open, total } = viewOfList(list, snaps as Partial<Record<SourceId, SourceSnapshot>>);
    if (!total) continue;
    const home = sourceById[list.site]?.shortName || list.site;
    for (const s of list.alsoIn) {
      const snap = out[s];
      if (!snap || s === list.site) continue;
      const due = open.map(t => t.due).filter(Boolean).sort()[0];
      const row: TaskItem = open.length
        ? { id: `list:${list.id}`, title: list.name, detail: `Benchmark · ${open.length} of ${total} left in ${home}`, status: 'open', kind: 'list', tag: 'Benchmark', ...(due ? { due } : {}) }
        : { id: `list:${list.id}`, title: list.name, detail: `Benchmark done · finished in ${home}`, status: 'done', kind: 'list', tag: 'Benchmark' };
      out[s] = { ...snap, tasks: [...snap.tasks, row] };
    }
  }
  return out as T;
}

/** What the goal pop-out and the list pop-out need from the live app. */
export type SiteListsContextValue = {
  store: SiteListStore;
  snapshots: Partial<Record<SourceId, SourceSnapshot>>;
  complete: (site: SourceId, taskId: string) => void;
};
export const SiteListsContext = createContext<SiteListsContextValue>({ store: {}, snapshots: {}, complete: () => {} });
export const useSiteLists = () => useContext(SiteListsContext);
export const openSiteList = (id: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_SITE_LIST_EVENT, { detail: id }));
};
