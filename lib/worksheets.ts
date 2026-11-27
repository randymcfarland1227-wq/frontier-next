'use client';

/**
 * Worksheets (Today › Worksheet): scratch documents with a title and rich text, like a quick Google Doc.
 * Stored per id with a timestamp so cloud sync merges them newest-wins (lib/syncState.ts `worksheets`).
 * Deleting leaves a `gone` tombstone so another device doesn't bring it back.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';
import type { SheetData } from './sheetFormula';

export const WORKSHEETS_KEY = 'lifehub-worksheets';
export const WORKSHEETS_EVENT = 'lifehub:worksheets';

export type Worksheet = {
  id: string;
  title: string;
  /** Sanitized HTML from the editor */
  html: string;
  /** Sheet view: grid cells as typed (formulas start with =); missing on older worksheets */
  sheet?: SheetData;
  /** Which side was open last: the notes or the sheet */
  view?: 'notes' | 'sheet';
  created: string;
  at: string;
  gone?: boolean;
};
export type WorksheetStore = Record<string, Worksheet>;

export const loadWorksheets = (): WorksheetStore => readSaved<WorksheetStore>(WORKSHEETS_KEY, {});

function put(next: WorksheetStore) {
  writeSaved(WORKSHEETS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSHEETS_EVENT));
}

export function newWorksheet(title = ''): string {
  const now = new Date().toISOString();
  const id = `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  put({ ...loadWorksheets(), [id]: { id, title, html: '', created: now, at: now } });
  return id;
}

export function saveWorksheet(id: string, patch: Partial<Pick<Worksheet, 'title' | 'html' | 'sheet' | 'view'>>) {
  const s = loadWorksheets();
  const prev = s[id];
  if (!prev || prev.gone) return;
  put({ ...s, [id]: { ...prev, ...patch, at: new Date().toISOString() } });
}

export function deleteWorksheet(id: string) {
  const s = loadWorksheets();
  if (!s[id]) return;
  put({ ...s, [id]: { ...s[id], html: '', sheet: undefined, gone: true, at: new Date().toISOString() } });
}

export function useWorksheets(): WorksheetStore {
  const [store, setStore] = useState<WorksheetStore>(() => loadWorksheets());
  useEffect(() => {
    const on = () => setStore(loadWorksheets());
    window.addEventListener(WORKSHEETS_EVENT, on);
    window.addEventListener('lifehub:synced', on);
    return () => {
      window.removeEventListener(WORKSHEETS_EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return store;
}

/** Keep formatting tags; drop scripts, embeds, event handlers and javascript: links (pasted HTML can carry them). */
export function cleanHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';
  root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return root.innerHTML;
}
