/**
 * How each subscription / pay later is paid, card + account last 4s, and Randy's notes — from his
 * Nov 8, 2026 list. Applied once per item (only where nothing is set yet, so a pick he changes later
 * on Life Hub always wins). Everything lands in moneyMeta (cloud-synced) or the hub subs list.
 */
import { paySrc } from './balancePicks';
import { addLifeSub, loadLifeSubs, updateLifeSub } from './lifeSubs';
import { seedCountyTaxes } from './finFindings';
import { loadMoneyMeta, metaName, setMeta } from './moneyMeta';
import type { BillDue } from './schedule';

/** Last 4 by loose name (metaName). Bank rows use the balancing sheet's names (Chase, Bofa, Capital 1, Ally). */
export const LAST4: Record<string, string> = {
  cap1savor: '5315',
  cap1sec: '5709',
  cap1q: '1113',
  cap1v: '0020',
  destiny: '2335',
  indigo: '4455',
  milestone: '5257',
  atlas: '9242',
  concoramastercard: '3821',
  chase: '2574',
  chasedebit: '2574',
  bofa: '1119',
  bofadebit: '1119',
  capital1: '6773',
  capitalone: '6773',
  capital1debit: '6773',
  ally: '7990',
  allydebit: '7990',
  current: '9985',
  currentdebit: '9985',
};

/** Last 4 for an account / card name ('' when unknown). Typed values in meta win over the list above. */
export function last4Of(name: string, meta = loadMoneyMeta()): string {
  const k = metaName(name || '');
  if (!k) return '';
  const own = meta[`last4:${k}`];
  if (own && !own.gone && own.last4) return own.last4;
  return LAST4[k] || '';
}

/** "Chase" → "Chase •2574"; names that already carry digits stay as they are. */
export function withLast4(name: string, meta = loadMoneyMeta()): string {
  if (!name) return name;
  const l4 = last4Of(name, meta);
  return l4 && !name.includes(l4) ? `${name} •${l4}` : name;
}

type Rule = { kind: 'sub' | 'paylater'; re: RegExp; acct?: string; note?: string };

const RULES: Rule[] = [
  // Subscriptions (Flex left alone on purpose — Randy is still working on it)
  { kind: 'sub', re: /^ab(le|el)ton/, acct: 'Current Debit', note: 'BofA and Chase debit also saved · $374.48 left, or 12 payment cycles' },
  { kind: 'sub', re: /^cloudflare/, acct: 'Chase' },
  { kind: 'sub', re: /^claude/, acct: 'Chase' },
  { kind: 'sub', re: /^g ?force/, acct: 'Concora Mastercard', note: 'Current Debit (Visa •9985) also saved' },
  { kind: 'sub', re: /^apple/, acct: 'Chase' },
  { kind: 'sub', re: /^spotify/, acct: 'Mastercard •4587', note: 'BofA debit also saved' },
  { kind: 'sub', re: /^pf\b/, acct: 'Chase Savings' },
  { kind: 'sub', re: /^prime/, acct: 'Current Debit' },
  { kind: 'sub', re: /^google one/, acct: 'Chase' },
  { kind: 'sub', re: /^cleo/, acct: 'Chase' },
  { kind: 'sub', re: /^grubhub/, note: 'Free trial until March 2026' },
  // Pay later — order matters (BJ's $58 before the other BJ's)
  { kind: 'paylater', re: /amazon.*sep\W*30/, acct: 'Bofa' },
  { kind: 'paylater', re: /amazon.*sep\W*2\b/, acct: 'Bofa' },
  { kind: 'paylater', re: /bj.*58/, acct: 'Chase' },
  { kind: 'paylater', re: /bj/, acct: 'Bofa' },
  { kind: 'paylater', re: /frontier/, acct: 'Bofa' },
  { kind: 'paylater', re: /amazon.*oct\W*12/, acct: 'Bofa' },
  { kind: 'paylater', re: /amazon.*oct\W*6\b/, acct: 'Chase' },
  { kind: 'paylater', re: /chewy/, acct: 'Chase' },
  { kind: 'paylater', re: /instacart.*65/, acct: 'Chase' },
  { kind: 'paylater', re: /instacart.*47/, acct: 'Chase' },
  { kind: 'paylater', re: /instacart.*39/, acct: 'Chase' },
  { kind: 'paylater', re: /instacart.*32/, acct: 'Bofa' },
  { kind: 'paylater', re: /glassnow/, acct: 'Chase' },
  { kind: 'paylater', re: /verizon|candle\s*sci|soundco/, acct: 'Card •5584' },
];

export function methodRule(kind: string | undefined, name: string): Rule | undefined {
  const n = name.toLowerCase().replace(/[’']/g, '').trim();
  return RULES.find(r => r.kind === kind && r.re.test(n));
}

const HUB_SEED = 'lifehub-seed-money-methods-v1';

/** Hub-sub fixes from the same list (once per device; each step is safe to repeat). */
function seedHubSubs() {
  try {
    if (localStorage.getItem(HUB_SEED)) return;
  } catch {
    return;
  }
  const subs = loadLifeSubs().filter(s => !s.removed);
  const by = (re: RegExp) => subs.find(s => re.test(s.name.toLowerCase()));
  const cf = by(/^cloudflare/);
  if (cf) updateLifeSub(cf.id, { day: 7, note: 'Workers Paid $5 + tax · paid from Chase debit · next Dec 7' });
  const g1 = by(/^google one/);
  if (g1) updateLifeSub(g1.id, { name: 'Google One (400 GB)', amount: 2.99, day: 22, note: 'Storage · $2.99/mo now, $4.99/mo starting Jan 22, 2027' });
  const gw = by(/^google workspace/);
  if (gw) updateLifeSub(gw.id, { amount: 3.09, note: 'Peculiar Candle · info@peculiarcandle.com · last charged Nov 2 — not finding it on either Google account' });
  const ic = by(/^instacart/);
  if (ic) updateLifeSub(ic.id, { day: 21, month: 12, note: 'Membership ends Dec 21, 2026 · will not renew' });
  if (!by(/^cleo/)) addLifeSub({ name: 'Cleo', amount: 5.99, day: 18, cycle: 'monthly', status: 'active', kind: 'sub', start: '2026-11-18' });
  try {
    localStorage.setItem(HUB_SEED, new Date().toISOString());
  } catch {
    /* private window */
  }
}

/** Fill in pay-from and notes for matching items that have none yet. */
export function applyMoneyMethods(dues: BillDue[]) {
  seedHubSubs();
  seedCountyTaxes();
  const meta = loadMoneyMeta();
  const done = new Set<string>();
  for (const d of dues) {
    const r = methodRule(d.bill.kind, d.bill.origName ?? d.bill.name);
    if (!r) continue;
    const src = paySrc(d.bill);
    if (done.has(src)) continue;
    done.add(src);
    if (r.acct && !meta[`from:${src}`]) setMeta(`from:${src}`, { acct: r.acct });
    if (r.note && !meta[`note:${src}`]) setMeta(`note:${src}`, { note: r.note });
  }
}
