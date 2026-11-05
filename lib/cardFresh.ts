/**
 * When each credit card's figures last changed. The Radall sheet has no per-card timestamp, so Life Hub
 * remembers each card's figures (balance · limit · available · minimum) under meta `figs:<card>` and stamps
 * the sheet read that first showed new ones. Cards added on Life Hub use their own updatedAt instead.
 */
import { metaName, type MetaEntry } from './moneyMeta';

export type FreshCard = { name: string; bal?: number; limit?: number; avail?: number; min?: number };
export type FreshPatch = { key: string; sig: string; seenAt: string; first?: boolean };

export const figsKey = (name: string) => `figs:${metaName(name)}`;
const n = (v?: number) => (v === undefined || !Number.isFinite(v) ? '' : v.toFixed(2));
export const cardSig = (c: FreshCard) => [n(c.bal), n(c.limit), n(c.avail), n(c.min)].join('|');

/**
 * Cards whose figures differ from the remembered ones, stamped with this sheet read. A card seen for the
 * first time is marked `first` (we only know it's been this way since at least then). An older sheet
 * read (another device's stale copy) never overwrites a newer stamp.
 */
export function freshPatches(cards: FreshCard[], get: (key: string) => MetaEntry | undefined, readAt: string): FreshPatch[] {
  const out: FreshPatch[] = [];
  for (const c of cards) {
    const key = figsKey(c.name);
    const sig = cardSig(c);
    const was = get(key);
    if (was && !was.gone && was.sig === sig) continue;
    if (was?.seenAt && Date.parse(was.seenAt) > Date.parse(readAt)) continue;
    out.push({ key, sig, seenAt: readAt, ...(was && !was.gone ? {} : { first: true }) });
  }
  return out;
}

/** "today 7:12 AM" / "yesterday 9:40 PM" / "Nov 3, 4:05 PM", plus how long ago. */
export function freshLabel(iso: string, now = new Date()): { when: string; ago: string; stale: boolean } {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  const when = days === 0 ? `today ${time}` : days === 1 ? `yesterday ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  const ago = mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return { when, ago, stale: mins > 7 * 1440 };
}
