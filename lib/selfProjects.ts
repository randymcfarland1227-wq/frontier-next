import { localDayKey } from './dayKey';
import { readSaved, writeSaved } from './storage';
import { normalizeUrl, linkLabel } from './focusRefs';
import { FOCUS_LIST_EVENT } from './ongoingGoals';
import type { Entry } from '../app/components/FocusSection';
import type { SourceId } from './types';

export const OPEN_PROJECT_EVENT = 'lifehub:open-project';
export const openProject = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: id }));

/** A project (not a Short-term focus card or goal): made in Self (site 'self') or marked `kind: 'project'`.
 * Projects keep the shared focus record but never show in Short-term focus or on the Goals page. */
export const isProject = (e: { site?: string; kind?: string } | null | undefined) => Boolean(e && (e.kind === 'project' || e.site === 'self'));

/** Projects share the existing short-term focus record and backup path. */
/** A new card in the shared focus record; pass `{ kind: 'project' }` for a plain project on another site. */
export function addSelfProject(title: string, note: string, why: string, url: string, site: SourceId = 'self', extra: Partial<Entry> = {}): string {
  const key = 'lifehub-focus-now2';
  const saved = readSaved<{ scope: string; items: Entry[] }>(key, { scope: '', items: [] });
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const reference = normalizeUrl(url);
  const item: Entry = { id, title: title.trim(), note: note.trim(), why: why.trim(), site, added: localDayKey(), at, lists: [],
    ...(reference ? { refs: [{ id: crypto.randomUUID(), kind: 'link', title: linkLabel(reference), url: reference, at }] } : {}), ...extra };
  writeSaved(key, { ...saved, items: [...saved.items, item] });
  window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: key }));
  openProject(id);
  return id;
}
