import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lifeSubDues, type LifeSub } from '../lib/lifeSubs';

const atlas: LifeSub = { id: 'sub-atlas-fee', name: 'Atlas Smart Pay subscription', amount: 8.99, day: 24, cycle: 'monthly', status: 'active', kind: 'sub', createdAt: '2026-10-16T07:41:29.000Z' } as LifeSub;
const today = new Date(2026, 10, 25);

test('a later paid subscription charge settles the earlier unpaid ones', () => {
  const unpaid = lifeSubDues([atlas], new Set(), today, 45, 10).map((d) => d.due);
  assert.deepEqual(unpaid, ['2026-10-24', '2026-11-24']);
  const paid = new Set(['money:lhsub:sub-atlas-fee:2026-11-24']);
  assert.deepEqual(lifeSubDues([atlas], paid, today, 45, 10).map((d) => d.due), []);
  // A loan or bill added on Life Hub doesn't pay itself: an earlier unpaid one stays.
  const loan = { ...atlas, id: 'loan-x', kind: 'loan' } as LifeSub;
  assert.deepEqual(lifeSubDues([loan], new Set(['money:lhsub:loan-x:2026-11-24']), today, 45, 10).map((d) => d.due), ['2026-10-24']);
});
