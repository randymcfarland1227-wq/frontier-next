/**
 * Packages: things coming to Randy (Vinted, Calvin Klein…) and things he sends out (Dyson warranty), not
 * sales shipments. Cloud-synced as `packages` (newest `at` wins per id). Live status comes from the Worker's
 * /api/track (Track123) on Refresh; the daily Life Hub routine adds tracking numbers from shipping emails.
 */
import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';
import { syncKeyHeader } from './cloudSync';

export const PACKAGES_KEY = 'lifehub-packages';
const EVENT = 'lifehub:packages';
const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export type PkgStatus = 'ordered' | 'tosend' | 'shipped' | 'transit' | 'out' | 'pickup' | 'delivered' | 'problem';
export type Pkg = {
  id: string;
  name: string;
  /** Store / sender / where it's going */
  from?: string;
  dir: 'in' | 'out';
  tracking?: string;
  carrier?: string;
  status: PkgStatus;
  /** Estimated arrival (YYYY-MM-DD), or delivered day */
  eta?: string;
  /** Latest carrier event */
  last?: string;
  checkedAt?: string;
  note?: string;
  at: string;
  gone?: boolean;
};
export type PkgStore = Record<string, Pkg>;

export const STATUS_LABEL: Record<PkgStatus, string> = {
  ordered: 'Ordered · not shipped',
  tosend: 'To send',
  shipped: 'Shipped',
  transit: 'In transit',
  out: 'Out for delivery',
  pickup: 'Ready for pickup',
  delivered: 'Delivered',
  problem: 'Problem',
};

export const loadPackages = (): PkgStore => readSaved<PkgStore>(PACKAGES_KEY, {});
function put(next: PkgStore) {
  writeSaved(PACKAGES_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}
export function savePackage(p: Omit<Pkg, 'at'> & { at?: string }) {
  const s = loadPackages();
  put({ ...s, [p.id]: { ...s[p.id], ...p, at: new Date().toISOString() } as Pkg });
}
export function removePackage(id: string) {
  const s = loadPackages();
  if (s[id]) put({ ...s, [id]: { ...s[id], gone: true, at: new Date().toISOString() } });
}
export const newPackageId = () => `pkg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function usePackages(): Pkg[] {
  const [s, setS] = useState<PkgStore>(() => loadPackages());
  useEffect(() => {
    const on = () => setS(loadPackages());
    window.addEventListener(EVENT, on);
    window.addEventListener('lifehub:synced', on);
    const t = window.setTimeout(on, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(EVENT, on);
      window.removeEventListener('lifehub:synced', on);
    };
  }, []);
  return Object.values(s).filter((p) => p && !p.gone);
}

/** A public tracking page for any number (works without the API key). */
export const trackUrl = (n: string) => `https://t.17track.net/en#nums=${encodeURIComponent(n)}`;

/** Refresh: ask the Worker (Track123) for every package with a tracking number that isn't delivered yet. */
export async function refreshPackages(): Promise<{ ok: boolean; updated: number; error?: string }> {
  const live = Object.values(loadPackages()).filter((p) => !p.gone && p.tracking && p.status !== 'delivered');
  if (!live.length) return { ok: true, updated: 0 };
  try {
    const res = await fetch(`${WORKER_BASE}/api/track?nums=${encodeURIComponent(live.map((p) => p.tracking).join(','))}`, {
      headers: syncKeyHeader(),
      cache: 'no-store',
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; items?: Array<{ number: string; status?: PkgStatus; eta?: string; last?: string; carrier?: string }> };
    if (!res.ok || !body.ok) return { ok: false, updated: 0, error: body.error || `HTTP ${res.status}` };
    let updated = 0;
    const s = loadPackages();
    const now = new Date().toISOString();
    for (const it of body.items || []) {
      for (const p of live.filter((x) => x.tracking === it.number)) {
        s[p.id] = {
          ...s[p.id],
          ...(it.status ? { status: it.status } : {}),
          ...(it.eta ? { eta: it.eta } : {}),
          ...(it.last ? { last: it.last } : {}),
          ...(it.carrier ? { carrier: it.carrier } : {}),
          checkedAt: now,
          at: now,
        };
        updated++;
      }
    }
    put(s);
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, updated: 0, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** One-time starter list (Randy, 2026-11-17): what he's waiting on and the Dyson he has to send. */
export function seedPackages() {
  const s = loadPackages();
  if (Object.keys(s).length || readSaved<boolean>('lifehub-packages-seeded', false)) return;
  const at = new Date().toISOString();
  const rows: Array<[string, string, Pkg['dir'], PkgStatus]> = [
    ['pkg-vinted-pants-1', 'Pants (pair 1)', 'in', 'shipped'],
    ['pkg-vinted-pants-2', 'Pants (pair 2)', 'in', 'ordered'],
    ['pkg-vinted-underwear', 'Underwear', 'in', 'ordered'],
    ['pkg-vinted-jocks', 'Jock straps', 'in', 'ordered'],
    ['pkg-ck-underwear', 'Underwear order', 'in', 'ordered'],
    ['pkg-dyson-warranty', 'Dyson fan · warranty claim', 'out', 'tosend'],
  ];
  const from: Record<string, string> = { 'pkg-ck-underwear': 'Calvin Klein', 'pkg-dyson-warranty': 'Dyson' };
  const next: PkgStore = {};
  for (const [id, name, dir, status] of rows) next[id] = { id, name, from: from[id] || 'Vinted', dir, status, at };
  writeSaved('lifehub-packages-seeded', true);
  put(next);
}
