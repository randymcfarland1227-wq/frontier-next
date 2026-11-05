import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardSig, figsKey, freshLabel, freshPatches } from '../lib/cardFresh';
import type { MetaEntry } from '../lib/moneyMeta';

const indigo = { name: 'Indigo', bal: 526.94, limit: 500, avail: 0, min: 40 };

test('first sighting is stamped "since at least"; unchanged figures are left alone', () => {
  const meta: Record<string, MetaEntry> = {};
  const get = (k: string) => meta[k];
  const [p] = freshPatches([indigo], get, '2026-11-05T12:00:00.000Z');
  assert.equal(p.key, figsKey('Indigo'));
  assert.equal(p.first, true);
  meta[p.key] = { at: p.seenAt, sig: p.sig, seenAt: p.seenAt, first: true };
  assert.equal(freshPatches([indigo], get, '2026-11-05T13:00:00.000Z').length, 0);
});

test('a changed balance gets the new sheet read time; an older read never overwrites a newer stamp', () => {
  const meta: Record<string, MetaEntry> = { [figsKey('Indigo')]: { at: '', sig: cardSig({ ...indigo, bal: 491.78, avail: 8.22 }), seenAt: '2026-11-04T12:00:00.000Z' } };
  const get = (k: string) => meta[k];
  const [p] = freshPatches([indigo], get, '2026-11-05T14:00:00.000Z');
  assert.equal(p.seenAt, '2026-11-05T14:00:00.000Z');
  assert.equal(p.first, undefined);
  meta[p.key] = { at: '', sig: p.sig, seenAt: p.seenAt };
  assert.equal(freshPatches([{ ...indigo, bal: 491.78, avail: 8.22 }], get, '2026-11-05T09:00:00.000Z').length, 0);
});

test('labels say today / yesterday and how long ago', () => {
  const now = new Date(2026, 10, 5, 15, 0);
  assert.match(freshLabel(new Date(2026, 10, 5, 13, 0).toISOString(), now).when, /^today /);
  assert.equal(freshLabel(new Date(2026, 10, 5, 13, 0).toISOString(), now).ago, '2 h ago');
  assert.match(freshLabel(new Date(2026, 10, 4, 9, 0).toISOString(), now).when, /^yesterday /);
  assert.equal(freshLabel(new Date(2026, 9, 20).toISOString(), now).stale, true);
});
