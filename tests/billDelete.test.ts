import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBillEdits, billRuleKey, isEnded, type BillDays } from '../lib/billEdits';
import type { BillDue } from '../lib/schedule';

const bill = { id: 'cv', name: 'Canva Business', amount: 250, kind: 'sub' as const, dueDay: 3 };
const due = (d: string): BillDue => ({ bill, due: d, days: 0, key: `money:cv:${d}` });
const now = new Date('2026-11-04T12:00:00');

test('deleting for good drops every payment from that month on, keeps earlier ones', () => {
  const days: BillDays = { [billRuleKey(bill)]: { day: null, from: '', at: 'x', endFrom: '2026-11' } };
  const out = applyBillEdits([due('2026-10-03'), due('2026-11-03'), due('2026-12-03')], {}, now, days);
  assert.deepEqual(out.map(d => d.due), ['2026-10-03']);
});

test('restoring (no endFrom) brings them back; other bills are untouched', () => {
  const other = { ...due('2026-12-03'), bill: { ...bill, name: 'Netflix' }, key: 'money:nf:2026-12-03' };
  const days: BillDays = { [billRuleKey(bill)]: { day: null, from: '', at: 'x' } };
  assert.equal(applyBillEdits([due('2026-12-03'), other], {}, now, days).length, 2);
  const ended: BillDays = { [billRuleKey(bill)]: { day: null, from: '', at: 'x', endFrom: '2026-11' } };
  assert.deepEqual(applyBillEdits([due('2026-12-03'), other], {}, now, ended).map(d => d.bill.name), ['Netflix']);
  assert.equal(isEnded('2026-10-31', ended[billRuleKey(bill)]), false);
});
