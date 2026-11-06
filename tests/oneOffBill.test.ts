import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lifeSubDues, paymentIndex, type LifeSub } from '../lib/lifeSubs';

const base = (p: Partial<LifeSub>): LifeSub => ({ id: 'x', name: 'Dentist', amount: 120, day: 20, cycle: 'monthly', status: 'active', kind: 'bill', createdAt: '2026-11-06T12:00:00.000Z', updatedAt: '2026-11-06T12:00:00.000Z', ...p });
const today = new Date(2026, 10, 6);

test('paymentIndex counts months (or years) from the first payment', () => {
  assert.equal(paymentIndex('2026-11-20', '2026-11-20'), 0);
  assert.equal(paymentIndex('2026-11-20', '2027-01-20'), 2);
  assert.equal(paymentIndex('2026-11-20', '2028-11-20', 'yearly'), 2);
});

test('a one-time bill is due once, then never again', () => {
  const dues = lifeSubDues([base({ start: '2026-11-20', times: 1 })], new Set(), today);
  assert.deepEqual(dues.map(d => d.due), ['2026-11-20']);
  assert.match(dues[0].bill.notes || '', /One-time/);
});

test('a 3-payment bill stops after the third and says which payment it is', () => {
  const dues = lifeSubDues([base({ start: '2026-11-20', times: 3 })], new Set(), today);
  assert.deepEqual(dues.map(d => d.due), ['2026-11-20', '2026-12-20', '2027-01-20']);
  assert.match(dues[2].bill.notes || '', /Payment 3 of 3/);
});

test('a routine bill keeps going', () => {
  assert.ok(lifeSubDues([base({})], new Set(), today).length >= 4);
});
