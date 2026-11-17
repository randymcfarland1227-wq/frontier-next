import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, assetProgress, paidMonths, planTerms } from '../lib/assets';
import type { BillDue } from '../lib/schedule';

const due = (key: string, d: string, days = 0, crossed = false): BillDue => ({ key, due: d, days, bill: { id: crossed ? `crossed:${key}` : 'x', name: 'Toyota', amount: 300 } });

test('paidMonths: Life Hub marks + sheet cross-offs, one per month', () => {
  const paidAt = { 'money:sub:abelton:2026-11-01': 'a', 'money:sub:abelton:2026-11-04': 'b', 'money:sub:abelton:2026-10-04': 'c', 'money:bill:toyota:2026-10-26': 'd' };
  assert.deepEqual(paidMonths('money:sub:abelton:', paidAt, []).map(p => p.month), ['2026-10', '2026-11']);
  // a late payment for an older due, marked paid after the balance was read, still comes off
  const late = assetProgress({ payment: 300, bal: 4500, asOf: '2026-11-17T01:55:00Z', paid: [{ month: '2026-10', due: '2026-10-26', at: '2026-11-18T10:00:00Z' }] });
  assert.equal(late.owed, 4200);
  const crossed = [due('money:bill:toyota:2026-09-26', '2026-09-26', -50, true)];
  assert.deepEqual(paidMonths('money:bill:toyota:', paidAt, crossed).map(p => p.due), ['2026-09-26', '2026-10-26']);
});

test('balance mode: payments marked paid after the as-of day come off', () => {
  const base = { total: 20000, payment: 300, bal: 4500, asOf: '2026-11-16', paymentsLeft: 12, dueDay: 26 };
  const before = assetProgress({ ...base, paid: [{ month: '2026-10', due: '2026-10-26', at: '2026-10-27T12:00:00Z' }], nextDue: '2026-11-26' }, new Date(2026, 10, 16));
  assert.equal(before.owed, 4500);
  assert.equal(before.left, 12);
  assert.equal(before.payoff, '2027-10-26');
  assert.equal(Math.round(before.paidPct!), 78);
  const after = assetProgress({ ...base, paid: [{ month: '2026-10', due: '2026-10-26', at: '2026-10-27T12:00:00Z' }, { month: '2026-11', due: '2026-11-26', at: '2026-11-26T15:00:00Z' }], nextDue: '2026-12-26' }, new Date(2026, 10, 27));
  assert.equal(after.owed, 4200);
  assert.equal(after.left, 11);
  assert.equal(after.paidSince, 1);
  assert.equal(after.payoff, '2027-10-26');
});

test('schedule mode: months since the first payment, this month only when paid', () => {
  const a = { total: 600, payment: 30, start: '2026-04', dueDay: 4 };
  const unpaid = assetProgress({ ...a, paid: [] }, new Date(2026, 10, 2));
  assert.equal(unpaid.made, 7);
  assert.equal(unpaid.owed, 390);
  assert.equal(unpaid.left, 13);
  const paid = assetProgress({ ...a, paid: [{ month: '2026-11', due: '2026-11-04' }] }, new Date(2026, 10, 5));
  assert.equal(paid.made, 8);
  assert.equal(paid.owed, 360);
  assert.equal(paid.payoff, '2027-11-04');
  const missed = assetProgress({ ...a, paid: [], missed: ['2026-10'] }, new Date(2026, 10, 2));
  assert.equal(missed.made, 6);
});

test('unknown when amounts are missing; addMonths clamps month ends', () => {
  assert.equal(assetProgress({ paid: [] }).mode, 'unknown');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('planTerms reads the sheet payoff table', () => {
  assert.deepEqual(planTerms('Plan · $600 total', [[{ text: 'Payment' }, { text: 'Amount' }], [{ text: 'Apr-2026' }, { text: '-$30' }]]), { total: 600, payment: 30, start: '2026-04' });
});
