/**
 * Which focus cards / ongoing goals a site task or site list is linked into, so site rows can show
 * "◎ Financial Auditing" and you can see at a glance whether something is in your planning.
 * Read-only: reads the same saved focus lists the Short-term focus view writes.
 */
import { useEffect, useState } from 'react';
import { readSaved } from './storage';
import { FOCUS_LIST_EVENT, ONGOING_KEY } from './ongoingGoals';
import { SITE_LISTS_EVENT, loadSiteLists } from './siteLists';

const FOCUS_KEYS = ['lifehub-focus-now2', 'lifehub-focus-weeks2', ONGOING_KEY, 'lifehub-focus-nut2', 'lifehub-focus-marvel-goals'];

type Card = { id: string; title: string; done?: boolean; siteLists?: string[]; siteTasks?: string[]; ongoing?: boolean };
export type FocusLink = { title: string; ongoing: boolean };

function build(): Map<string, FocusLink[]> {
  const lists = loadSiteLists();
  const out = new Map<string, FocusLink[]>();
  const add = (key: string, link: FocusLink) => {
    const have = out.get(key) || [];
    if (!have.some(l => l.title === link.title)) out.set(key, [...have, link]);
  };
  for (const k of FOCUS_KEYS) {
    const items = readSaved<{ items?: Card[] }>(k, {}).items || [];
    for (const c of items) {
      if (!c || c.done || !c.title) continue;
      const link = { title: c.title, ongoing: k === ONGOING_KEY || Boolean(c.ongoing) };
      // A task with the same name as a focus card was organized into it (e.g. a Self task made into a focus).
      add(titleKey(c.title), link);
      for (const id of c.siteLists || []) {
        const l = lists[id];
        if (l && !l.gone) add(`${l.site}:list:${id}`, link);
      }
      for (const key of c.siteTasks || []) add(key, link);
    }
  }
  return out;
}

export const titleKey = (title: string) => `title:${title.trim().toLowerCase()}`;

/** Is this site task / list organized into an open focus card or ongoing goal? */
export const inFocusPlan = (links: Map<string, FocusLink[]>, key: string, title: string) =>
  links.has(key) || links.has(titleKey(title));

/** Pin key (`source:id`, lists as `source:list:<id>`) → the goals it's linked into. */
export function useFocusLinks(): Map<string, FocusLink[]> {
  const [map, setMap] = useState(build);
  useEffect(() => {
    const reload = () => setMap(build());
    for (const ev of [FOCUS_LIST_EVENT, SITE_LISTS_EVENT, 'lifehub:synced']) window.addEventListener(ev, reload);
    return () => {
      for (const ev of [FOCUS_LIST_EVENT, SITE_LISTS_EVENT, 'lifehub:synced']) window.removeEventListener(ev, reload);
    };
  }, []);
  return map;
}
