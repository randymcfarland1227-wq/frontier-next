/**
 * Map: one board for every site Randy has built (the Milanote board, moved into Life Hub).
 * Sites sit in islands (clusters) around Life Hub. What's movable and typed on the board — island
 * positions and each island's notes — is stored per key with a timestamp in `lifehub-site-map`,
 * so cloud sync merges it newest-wins (lib/syncState.ts `siteMap`).
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';
import type { SourceId } from './types';

export type ClusterId = 'music' | 'candle' | 'work' | 'body' | 'life';
export type MapCluster = { id: ClusterId; name: string; blurb: string; color: string; x: number; y: number };
export type MapSite = {
  id: string;
  name: string;
  /** What it is, in a few words */
  what: string;
  cluster: ClusterId;
  url: string;
  repo?: string;
  /** Life Hub reads this site's data (a Sites entry in the sidebar) */
  source?: SourceId;
  /** Shown inside another site too */
  inside?: string;
};
export type MapFlow = { from: string; to: string; label: string };

/** Default island spots on the board (percent of the board's width / px from the top). */
export const CLUSTERS: MapCluster[] = [
  { id: 'music', name: 'Music', blurb: 'Identity, training, production', color: '#2fa58a', x: 1, y: 16 },
  { id: 'candle', name: 'Peculiar Candle', blurb: 'Shop, owner floor, launch', color: '#d4793a', x: 34.5, y: 0 },
  { id: 'work', name: 'Work and money', blurb: 'Jobs, selling, income', color: '#3f7fd6', x: 68, y: 16 },
  { id: 'body', name: 'Body and home', blurb: 'Training, food, Marvel, places', color: '#c9568a', x: 8, y: 470 },
  { id: 'life', name: 'Life system', blurb: 'Goals, meaning, capture, fixes', color: '#7a5fd0', x: 61, y: 470 },
];

const GH = 'https://randymcfarland1227-wq.github.io';
const CF = (name: string) => `https://${name}.randymcfarland1227.workers.dev/`;

export const SITES: MapSite[] = [
  { id: 'inner-archive', name: 'The Inner Archive', what: 'Artist identity field guide', cluster: 'music', url: CF('the-inner-archive'), repo: 'the-inner-archive' },
  { id: 'music-hub', name: 'My Music Hub', what: 'Vocal practice + music growth', cluster: 'music', url: CF('my-music-hub'), repo: 'my-music-hub' },
  { id: 'vocal-glow', name: 'Vocal Glow', what: 'Daily vocal warm-ups', cluster: 'music', url: CF('vocal-glow'), repo: 'vocal-glow', inside: 'My Music Hub' },
  { id: 'trackform', name: 'Trackform', what: 'Ableton session tool', cluster: 'music', url: CF('trackform'), repo: 'trackform' },
  { id: 'vocanote', name: 'Vocanote', what: 'Lyric workspace', cluster: 'music', url: `${GH}/vocanote/`, repo: 'vocanote' },

  { id: 'storefront', name: 'peculiarcandle.com', what: 'The shop customers see', cluster: 'candle', url: 'https://peculiarcandle.com', repo: 'peculiar-candle' },
  { id: 'floor', name: 'Peculiar Floor', what: 'Owner backend: stock, pours, ledger', cluster: 'candle', url: CF('peculiar-floor'), repo: 'peculiar-storefront-backend' },
  { id: 'command', name: 'Command Center', what: 'Pre-launch studio', cluster: 'candle', url: `${GH}/peculiar-command-center/`, repo: 'peculiar-command-center', source: 'candle' },

  { id: 'role', name: 'Role Hub', what: 'Job search pipeline', cluster: 'work', url: 'https://script.google.com/macros/s/AKfycbyYuq1_GDfbLtx1YZwIk7Khvewegl3_xocLnM_gv7zzujapMXxxXDlgWsqaiCiI4a9EIA/exec', source: 'role' },
  { id: 'resale', name: 'Resale Hub', what: 'Selling: listings, offers', cluster: 'work', url: `${GH}/sell-hub/`, repo: 'sell-hub', source: 'resale' },
  { id: 'venture', name: 'Venture Lab', what: 'Income ideas + ventures', cluster: 'work', url: `${GH}/income-venture-lab/`, repo: 'income-venture-lab', source: 'income' },
  { id: 'portfolio', name: 'Portfolio', what: 'randymcfarland.com case studies', cluster: 'work', url: 'https://randymcfarland.com' },

  { id: 'body', name: 'Body', what: 'Workouts + training', cluster: 'body', url: `${GH}/`, repo: 'daylight-matrix' },
  { id: 'daylight', name: 'Daylight', what: 'Food + energy', cluster: 'body', url: CF('daylight-energy-matrix'), repo: 'daylight-energy-matrix' },
  { id: 'marvel', name: "Marvel's Den", what: 'Marvel: Calm Plan, care', cluster: 'body', url: CF('marvels-den') },
  { id: 'move', name: 'Move OS', what: 'Moving planner', cluster: 'body', url: `${GH}/move-os/`, repo: 'move-os', source: 'move' },
  { id: 'atlas', name: 'Adventure Atlas', what: 'Travel journal', cluster: 'body', url: CF('adventure-atlas'), repo: 'adventure-atlas' },

  { id: 'flow', name: 'Flow', what: 'Goals + routines', cluster: 'life', url: `${GH}/flow-hub/`, repo: 'flow-hub' },
  { id: 'fulfillment', name: 'Fulfillment', what: 'Meaning + identity', cluster: 'life', url: `${GH}/fulfillment-hub/`, repo: 'fulfillment-hub' },
  { id: 'voice', name: 'Voice Memos', what: 'Phone recorder → Self inbox', cluster: 'life', url: `${GH}/voice-memos/`, repo: 'voice-memos' },
  { id: 'repair', name: 'Site Repair Log', what: 'Fixes + ideas for every site', cluster: 'life', url: `${GH}/site-repair-log/#/board`, repo: 'site-repair-log', source: 'repair' },
];

/** Data that really moves between sites (and into Life Hub, id 'hub'). */
export const FLOWS: MapFlow[] = [
  { from: 'vocal-glow', to: 'music-hub', label: 'embedded' },
  { from: 'floor', to: 'storefront', label: 'orders + stock' },
  { from: 'voice', to: 'hub', label: 'Self inbox' },
  { from: 'role', to: 'hub', label: 'tasks' },
  { from: 'resale', to: 'hub', label: 'tasks' },
  { from: 'command', to: 'hub', label: 'tasks' },
  { from: 'venture', to: 'hub', label: 'tasks' },
  { from: 'move', to: 'hub', label: 'tasks' },
  { from: 'repair', to: 'hub', label: 'fixes' },
  { from: 'flow', to: 'hub', label: 'Why page' },
];

/** Retired or folded into another site: kept on a shelf, nothing deleted. */
export const SHELF: Array<{ name: string; why: string; url?: string }> = [
  { name: 'frontier', why: 'Old Life Hub (this site replaced it)', url: `${GH}/frontier/` },
  { name: 'Goals hub', why: 'Folded into Flow', url: `${GH}/Goals-hub/` },
  { name: 'Routine hub', why: 'Folded into Flow', url: `${GH}/routine-hub/` },
  { name: 'daylight', why: 'Older Daylight build' },
  { name: 'peculiar-candles', why: 'Old candle repo' },
  { name: 'home', why: 'Early home page repo' },
  { name: 'HAVI interview campus', why: 'One-off interview prep', url: `${GH}/havi-interview-campus/` },
  { name: 'Halloween costume hub', why: 'Seasonal' },
];

export const SITE_MAP_KEY = 'lifehub-site-map';
export const SITE_MAP_EVENT = 'lifehub:site-map';
type Stamped = { at: string } & Record<string, unknown>;
export type SiteMapStore = Record<string, Stamped>;

export const loadSiteMap = (): SiteMapStore => readSaved<SiteMapStore>(SITE_MAP_KEY, {});
export function setSiteMap(key: string, value: Record<string, unknown>) {
  writeSaved(SITE_MAP_KEY, { ...loadSiteMap(), [key]: { ...value, at: new Date().toISOString() } });
  window.dispatchEvent(new CustomEvent(SITE_MAP_EVENT));
}
export function useSiteMap(): SiteMapStore {
  const [store, setStore] = useState<SiteMapStore>(() => loadSiteMap());
  useEffect(() => {
    const on = () => setStore(loadSiteMap());
    window.addEventListener(SITE_MAP_EVENT, on);
    window.addEventListener('lifehub:synced', on);
    return () => {
      window.removeEventListener(SITE_MAP_EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return store;
}
