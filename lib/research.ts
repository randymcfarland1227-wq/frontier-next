'use client';

/**
 * Research pop-outs (2026-11-18): one shared record per purchase or to-do, for what Randy finds while
 * looking into it: free notes plus a list of options (a cord, a mic, a part), each with what it does,
 * a price, a link and a "this one" pick.
 *
 * ONE record per item, reachable from every place the item shows up. The record key is the item's
 * Finance link key when it has one (`own:…`, `item:…`, `bill:…`, `buy:<name>` for a sheet Needed/Wants row),
 * so a purchase linked into a goal or short-term focus opens the same record as Money › Purchases.
 * A to-do uses its task key; a moved Self task keeps `self:<id>` wherever it lives.
 * A Finance item made from a task can point at that task's record with Finding.rkey (finFindings).
 * Map key → record, newest change wins in the cloud (same pattern as lib/finFindings). `gone` = cleared.
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';

export const RESEARCH_KEY = 'lifehub-research';
export const RESEARCH_EVENT = 'lifehub:research';
export const OPEN_RESEARCH_EVENT = 'lifehub:open-research';

export type ResearchOption = {
  id: string;
  name: string;
  /** What it does / why it's needed */
  does?: string;
  price?: number;
  url?: string;
  /** The one to get */
  pick?: boolean;
  /** Already have / bought it */
  got?: boolean;
};

export type ResearchRec = {
  key: string;
  /** The item's name when the record was last opened (so the record still reads on its own) */
  title?: string;
  notes?: string;
  options?: ResearchOption[];
  at: string;
  gone?: boolean;
};
export type ResearchStore = Record<string, ResearchRec>;

export const loadResearch = (): ResearchStore => readSaved<ResearchStore>(RESEARCH_KEY, {});
function put(next: ResearchStore) {
  writeSaved(RESEARCH_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RESEARCH_EVENT));
}

/** Lowercase words only: "Viking pedal cord!" → "viking-pedal-cord". */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
/** Key for a sheet purchase row (Needed / Wants / To purchase), which has no id of its own. */
export const sheetBuyKey = (name: string) => `buy:${slug(name)}`;

/**
 * The record key for a row key. A Self task moved to another site shows there as `<site>:self:<id>`;
 * it keeps one record (`self:<id>`) wherever it goes.
 */
export function researchKey(key: string): string {
  const m = key.match(/(?:^|:)self:(self-[^:]+)$/);
  return m ? `self:${m[1]}` : key;
}

export function researchOf(store: ResearchStore, key: string): ResearchRec | undefined {
  const r = store[researchKey(key)];
  return r && !r.gone ? r : undefined;
}

/** Anything written in it yet (for a small "has notes" mark). */
export const hasResearch = (r?: ResearchRec) => Boolean(r && (r.notes?.trim() || r.options?.length));

export function setResearch(key: string, patch: Partial<Omit<ResearchRec, 'key' | 'at'>>) {
  const k = researchKey(key);
  const s = loadResearch();
  const prev = s[k] && !s[k].gone ? s[k] : { key: k, at: '' };
  put({ ...s, [k]: { ...prev, ...patch, key: k, at: new Date().toISOString(), gone: undefined } });
}

export const newOptionId = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function clearResearch(key: string) {
  const k = researchKey(key);
  const s = loadResearch();
  if (s[k]) put({ ...s, [k]: { ...s[k], gone: true, at: new Date().toISOString() } });
}

/** Open the research pop-out for an item from anywhere (ResearchHost listens). */
export function openResearch(key: string, title: string, sub?: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_RESEARCH_EVENT, { detail: { key: researchKey(key), title, sub } }));
}

/** Sum of the picked options (else every option not already owned). */
export function researchTotal(r?: ResearchRec): number {
  const opts = (r?.options || []).filter(o => !o.got);
  const picked = opts.filter(o => o.pick);
  return (picked.length ? picked : opts).reduce((t, o) => t + (o.price || 0), 0);
}

export function useResearch(): ResearchStore {
  const [s, setS] = useState(loadResearch);
  useEffect(() => {
    const on = () => setS(loadResearch());
    window.addEventListener(RESEARCH_EVENT, on);
    window.addEventListener('lifehub:synced', on);
    return () => {
      window.removeEventListener(RESEARCH_EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return s;
}
