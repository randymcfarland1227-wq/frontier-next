import type { Entry } from '../app/components/FocusSection';
import { localDayKey } from './dayKey';
import { FOCUS_LIST_KEYS } from './focusSync';
import { FOCUS_LIST_EVENT } from './ongoingGoals';
import { LOCAL_WRITE_EVENT, readSaved } from './storage';

type OpenWork = Pick<Entry, 'lists' | 'fin' | 'siteTasks' | 'siteLists'>;

/** Keep the project context and the live links of unfinished work. */
export function projectContinuation(original: Entry, title: string, work: OpenWork, now = new Date()): Entry {
  const taskIds = new Set((work.lists || []).flatMap(list => list.tasks.map(task => task.id)));
  const next: Entry = {
    ...original, ...work, id: crypto.randomUUID(), title: title.trim(), done: false,
    added: localDayKey(now), since: localDayKey(now), at: now.toISOString(),
    continuedFrom: original.id, continuedAs: undefined,
    lists: work.lists?.map(list => ({ ...list, tasks: list.tasks.map(task => ({ ...task, after: task.after && taskIds.has(task.after) ? task.after : undefined })) })),
  };
  return next;
}

/** One list write archives the current project and appends its successor together. */
export function saveProjectContinuation(original: Entry, next: Entry): string {
  for (const key of FOCUS_LIST_KEYS) {
    const raw = readSaved<Entry[] | { scope: string; items: Entry[] }>(key, { scope: '', items: [] });
    const items = Array.isArray(raw) ? raw : raw.items;
    const current = items.find(item => item.id === original.id);
    if (!current) continue;
    if (current.continuedAs) return current.continuedAs;
    if (current.done || current.at !== original.at) throw new Error('This project changed. Close and reopen it before carrying work forward.');
    if (!next.title || items.some(item => item.id === next.id)) throw new Error('Give the new project a name and try again.');
    const updated = [...items.map(item => item.id === current.id ? { ...item, done: true, continuedAs: next.id, at: next.at } : item), next];
    const value = JSON.stringify(Array.isArray(raw) ? updated : { ...raw, items: updated });
    // Do not report success when storage is full or unavailable.
    localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: key }));
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: key }));
    return next.id;
  }
  throw new Error('This project could not be found. Reopen it and try again.');
}
