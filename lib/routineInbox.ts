/**
 * "Needs you" findings from the daily Life Hub check (scheduled routine life-hub-daily-updates).
 * The routine writes one entry per thing it couldn't settle on its own (unmatched payment, two packages that
 * could match, sheet vs Life Hub differences…) into the synced `inbox` section. Daily Brief › Do today shows
 * them as ONE row that opens a pop-out with a list per kind.
 *
 * Ids are stable (the routine builds them from the email / item), and the routine never re-adds an id that
 * already exists, so anything Randy marks Done or Dismissed stays gone on later days.
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';

export const INBOX_KEY = 'lifehub-routine-inbox';
const EVENT = 'lifehub:routine-inbox';

export type InboxGroup = 'payments' | 'debts' | 'packages' | 'sales' | 'sheet' | 'other';
export type InboxItem = {
  id: string;
  group: InboxGroup;
  title: string;
  detail?: string;
  /** The run that found it (YYYY-MM-DD) */
  run?: string;
  /** Email or page to open */
  link?: string;
  /** done = Randy handled it, dismissed = don't show it again */
  status?: 'done' | 'dismissed';
  at: string;
};
export type InboxStore = Record<string, InboxItem>;

export const INBOX_GROUPS: { id: InboxGroup; title: string }[] = [
  { id: 'payments', title: 'Payments to confirm' },
  { id: 'debts', title: 'Debts & credit' },
  { id: 'packages', title: 'Packages' },
  { id: 'sales', title: 'Sales' },
  { id: 'sheet', title: 'Sheet vs Life Hub' },
  { id: 'other', title: 'Other' },
];

export const loadInbox = (): InboxStore => readSaved<InboxStore>(INBOX_KEY, {});
export const openInbox = (s: InboxStore = loadInbox()) => Object.values(s).filter((i) => i && i.title && !i.status);

export function setInboxStatus(ids: string[], status: InboxItem['status']) {
  const s = loadInbox();
  const at = new Date().toISOString();
  const next = { ...s };
  for (const id of ids) if (next[id]) next[id] = { ...next[id], status, at };
  writeSaved(INBOX_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function useInbox(): InboxItem[] {
  const [s, setS] = useState<InboxStore>(() => loadInbox());
  useEffect(() => {
    const on = () => setS(loadInbox());
    window.addEventListener(EVENT, on);
    window.addEventListener('lifehub:synced', on);
    const t = window.setTimeout(on, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return openInbox(s);
}
