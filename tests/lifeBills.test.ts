import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lifeSubDues, type LifeSub } from '../lib/lifeSubs';

const base = { day: 15, cycle: 'monthly' as const, status: 'active' as const, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const subs: LifeSub[] = [
  { ...base, id: 'a', name: 'Netflix' },
  { ...base, id: 'b', name: 'Water', kind: 'bill' },
  { ...base, id: 'c', name: 'Car loan', kind: 'loan', amount: 300 },
  { ...base, id: 'd', name: 'Gone', kind: 'bill', removed: true },
];

test('hub-made bills and loans become bill dues; subs stay subs; removed ones vanish', () => {
  const out = lifeSubDues(subs, new Set(), new Date('2026-11-04T12:00:00'));
  const kinds = Object.fromEntries(out.map(d => [d.bill.name, d.bill.kind]));
  assert.equal(kinds['Netflix'], 'sub');
  assert.equal(kinds['Water'], 'bill');
  assert.equal(kinds['Car loan'], 'bill');
  assert.ok(!('Gone' in kinds));
  assert.ok(out.find(d => d.bill.name === 'Car loan')!.bill.notes?.startsWith('Loan'));
});
