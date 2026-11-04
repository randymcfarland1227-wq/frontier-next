import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBillEdits, billLevel, billRuleKey, type BillDays } from '../lib/billEdits';
import type { BillDue } from '../lib/schedule';

const now = new Date('2026-11-04T12:00:00');
const due = (name: string, kind: 'card' | 'bill', nonCritical?: boolean): BillDue => ({ bill: { id: name, name, kind, nonCritical }, due: '2026-10-20', days: -15, key: `money:${name}` });

test('a series level marks every payment: priority wins over the sheet’s non critical; normal clears it', () => {
  const fortiva = due('Fortiva', 'card');
  const toyota = due('Toyota', 'bill', true);
  const days: BillDays = {
    [billRuleKey(fortiva.bill)]: { day: null, from: '', at: 'x', nonCritical: true },
    [billRuleKey(toyota.bill)]: { day: null, from: '', at: 'x', priority: true, nonCritical: false },
  };
  const out = applyBillEdits([fortiva, toyota], {}, now, days);
  assert.equal(billLevel(out.find(d => d.bill.name === 'Fortiva')!.bill), 'noncritical');
  assert.equal(billLevel(out.find(d => d.bill.name === 'Toyota')!.bill), 'priority');
  const normal = applyBillEdits([toyota], {}, now, { [billRuleKey(toyota.bill)]: { day: null, from: '', at: 'x', nonCritical: false } });
  assert.equal(billLevel(normal[0].bill), 'normal');
});

test('a per-payment non critical still overrides for that one payment', () => {
  const f = due('Fortiva', 'card');
  const out = applyBillEdits([f], { [f.key]: { nonCritical: true, at: 'x' } }, now, {});
  assert.equal(billLevel(out[0].bill), 'noncritical');
});
