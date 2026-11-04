import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBillEdits, billRuleKey, type BillDays } from '../lib/billEdits';
import type { BillDue } from '../lib/schedule';

const bill = { id: 'gw', name: 'Google Workspace', amount: 14, kind: 'sub' as const, dueDay: 4 };
const due = (d: string): BillDue => ({ bill, due: d, days: 0, key: `bill:gw:${d}` });

test('a price change applies from its month on, not before; a one-off amount still wins', () => {
  const days: BillDays = { [billRuleKey(bill)]: { day: null, from: '2026-11', at: 'x', amount: 16.8, amountFrom: '2026-11' } };
  const out = applyBillEdits([due('2026-10-04'), due('2026-11-04'), due('2026-12-04')], { 'bill:gw:2026-12-04': { amount: 20, at: 'x' } }, new Date('2026-11-04T12:00:00'), days);
  assert.deepEqual(out.map(d => d.bill.amount), [14, 16.8, 20]);
});
