'use client';

/**
 * Finance group log: things done at the GROUP level of a Finance link (e.g. "MD tickets · Baltimore City"):
 * asked about a payment plan, plan terms agreed, a call, a letter sent. Per-ticket marks stay in lib/debtFile.
 * Map id → entry, `gone: true` = deleted; newest change wins in the cloud (same pattern as lib/siteLists).
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';

export const GROUP_LOG_KEY = 'lifehub-finance-group-log';
export const GROUP_LOG_EVENT = 'lifehub:group-log';

export type GroupLogKind = 'asked' | 'plan' | 'call' | 'sent' | 'paid' | 'note';
export const GROUP_LOG_KINDS: Array<[GroupLogKind, string]> = [
  ['asked', 'Asked about a payment plan'],
  ['plan', 'Plan terms agreed'],
  ['call', 'Called'],
  ['sent', 'Sent a letter / email'],
  ['paid', 'Paid'],
  ['note', 'Note'],
];
export const kindLabel = (k: GroupLogKind) => GROUP_LOG_KINDS.find(([id]) => id === k)?.[1] || 'Note';

export type GroupLogEntry = {
  id: string;
  /** Finance link key, e.g. `src:city`, `tix:md` */
  group: string;
  kind: GroupLogKind;
  /** YYYY-MM-DD the thing happened */
  date: string;
  who?: string;
  terms?: string;
  note?: string;
  /** Last change (ISO) — newest wins when merging devices */
  at: string;
  gone?: boolean;
};
export type GroupLogStore = Record<string, GroupLogEntry>;

export const loadGroupLog = (): GroupLogStore => readSaved<GroupLogStore>(GROUP_LOG_KEY, {});
function put(next: GroupLogStore) {
  writeSaved(GROUP_LOG_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GROUP_LOG_EVENT));
}

export function entriesFor(store: GroupLogStore, group: string): GroupLogEntry[] {
  return Object.values(store)
    .filter(e => e && !e.gone && e.group === group)
    .sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
}

export function addGroupLog(group: string, e: Pick<GroupLogEntry, 'kind' | 'date'> & Partial<Pick<GroupLogEntry, 'who' | 'terms' | 'note'>>): string {
  const id = `gl-${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  put({ ...loadGroupLog(), [id]: { id, group, kind: e.kind, date: e.date, who: e.who?.trim() || undefined, terms: e.terms?.trim() || undefined, note: e.note?.trim() || undefined, at: new Date().toISOString() } });
  return id;
}

export function removeGroupLog(id: string) {
  const s = loadGroupLog();
  if (s[id]) put({ ...s, [id]: { ...s[id], gone: true, at: new Date().toISOString() } });
}

export function useGroupLog(): GroupLogStore {
  const [s, setS] = useState(loadGroupLog);
  useEffect(() => {
    const on = () => setS(loadGroupLog());
    window.addEventListener(GROUP_LOG_EVENT, on);
    window.addEventListener('lifehub:synced', on);
    return () => {
      window.removeEventListener(GROUP_LOG_EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return s;
}

/** One-line summary for a focus card: latest entry, e.g. "Asked about a payment plan · Oct 29". */
export function latestLine(store: GroupLogStore, group: string): string {
  const e = entriesFor(store, group)[0];
  if (!e) return '';
  const d = new Date(`${e.date}T12:00:00`);
  const when = Number.isNaN(d.getTime()) ? e.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${kindLabel(e.kind)}${e.who ? ` · ${e.who}` : ''} · ${when}`;
}
