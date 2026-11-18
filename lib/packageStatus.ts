/**
 * Package status order, shared by the app and the Worker's /api/packages/mail.
 * A status only ever moves forward: an older shipping email (or a slow tracker) never undoes a newer one.
 */
export const PKG_STATUSES = ['ordered', 'tosend', 'shipped', 'transit', 'problem', 'out', 'pickup', 'delivered'] as const;
export type PkgStatusName = (typeof PKG_STATUSES)[number];

const RANK: Record<PkgStatusName, number> = { ordered: 0, tosend: 0, shipped: 1, transit: 2, problem: 2, out: 3, pickup: 3, delivered: 4 };

export const isPkgStatus = (s: unknown): s is PkgStatusName => typeof s === 'string' && (PKG_STATUSES as readonly string[]).includes(s);

/** True when `next` may replace `cur` (same step or further along; never back from Delivered). */
export function statusMovesForward(cur: string | undefined, next: string): boolean {
  if (!isPkgStatus(next)) return false;
  if (!isPkgStatus(cur)) return true;
  return RANK[next] >= RANK[cur];
}

/** Tracking numbers compare without spaces/dashes, upper-case. */
export const normTracking = (n: unknown) => (typeof n === 'string' ? n.replace(/[\s-]/g, '').toUpperCase() : '');
