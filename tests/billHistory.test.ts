import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billHistory } from '../lib/billHistory';
import { applyBillEdits, billRuleKey } from '../lib/billEdits';
import { rowChangeEdits, sheetDateText, sheetMoneyText, type MoneyItem } from '../lib/money';
import type { BillDue } from '../lib/schedule';

const cell = (r: number, c: number, text: string) => ({ tab: 'Randy', r, c, text, formula: false, struck: false });
const item = (date: string, amount: number, skipped = false, r = 5): MoneyItem => ({
  id: `money:bill:v-mobile:${date}`, kind: 'bill', name: 'V Mobile', amount, date, dateText: date, skipped,
  cells: { date: cell(r, 0, '11/4'), name: cell(r, 1, 'V Mobile'), amount: cell(r, 2, '$109.00') },
} as MoneyItem);
const due = (date: string, amount: number): BillDue => ({ bill: { id: `money:bill:v-mobile:${date}`, name: 'V Mobile', amount, kind: 'bill' }, due: date, days: 2, key: `money:bill:v-mobile:${date}` });

test('history: sheet rows, Mark paid taps with recorded amounts, last paid and the usual amount', () => {
  const h = billHistory(
    { name: 'V Mobile', kind: 'bill' },
    [due('2026-11-04', 146)],
    [item('2026-09-04', 109, true), item('2026-10-04', 109, true), item('2026-11-04', 109)],
    { 'money:bill:v-mobile:2026-10-04': '2026-10-03T15:00:00Z', 'money:bill:v-mobile:2026-08-04': '2026-08-05T15:00:00Z', 'money:bill:other:2026-10-04': '2026-10-03T15:00:00Z' },
    { 'paid:money:bill:v-mobile:2026-08-04': { at: 'x', amount: 120 } },
  );
  assert.deepEqual(h.rows.map(r => [r.due, r.amount, r.state]), [
    ['2026-11-04', 146, 'open'],
    ['2026-10-04', 109, 'paid'],
    ['2026-09-04', 109, 'crossed'],
    ['2026-08-04', 120, 'paid'],
  ]);
  assert.equal(h.lastPaid?.due, '2026-10-04');
  assert.equal(h.usual, 109);
});

test('a renamed bill keeps its history and rules (keyed to the sheet name)', () => {
  const d = due('2026-11-04', 109);
  const out = applyBillEdits([d], {}, new Date('2026-11-04T12:00:00'), { [billRuleKey(d.bill)]: { day: null, from: '', at: 'x', rename: 'Visible phone' } });
  assert.equal(out[0].bill.name, 'Visible phone');
  assert.equal(out[0].bill.origName, 'V Mobile');
  assert.equal(billRuleKey(out[0].bill), billRuleKey(d.bill));
  const h = billHistory(out[0].bill, out, [item('2026-10-04', 109, true)], {}, {});
  assert.equal(h.rows.length, 2);
});

test('this-payment change writes the sheet row in the cell’s own format', () => {
  assert.deepEqual(rowChangeEdits(item('2026-11-04', 109), { amount: 146, date: '2026-11-06' }), [
    { tab: 'Randy', r: 5, c: 2, expect: '$109.00', value: '$146.00' },
    { tab: 'Randy', r: 5, c: 0, expect: '11/4', value: '11/6' },
  ]);
  assert.deepEqual(rowChangeEdits({ ...item('2026-11-04', 109), projected: true }, { amount: 146 }), []);
  const shared = item('2026-11-04', 109);
  shared.cells.date = cell(3, 0, '11/4');
  assert.equal(rowChangeEdits(shared, { date: '2026-11-06' }).length, 0);
  assert.equal(sheetDateText('2026-11-06', 'Nov 4'), 'Nov 6');
  assert.equal(sheetDateText('2026-11-06', '11/4/26'), '11/6/26');
  assert.equal(sheetMoneyText(146, '109'), '146');
  assert.equal(sheetMoneyText(146.5, '$109'), '$146.50');
});

test('a display name cannot pick up another bill’s history and keeps earlier sheet renames linked', () => {
  const bill = due('2026-11-04', 109);
  const other = { ...due('2026-10-07', 230), key: 'other', bill: { id: 'other', name: 'Internet', amount: 230, kind: 'bill' as const } };
  const sheetRenamed = { ...bill, bill: { ...bill.bill, name: 'Mobile plan' } };
  const renamed = applyBillEdits([sheetRenamed, other], {}, new Date('2026-11-04T12:00:00'), {
    [billRuleKey(bill.bill)]: {
      day: null, from: '', at: 'x', rename: 'Mobile plan', renamedFrom: 'V Mobile', displayName: 'Internet',
    },
  });
  const subject = renamed.find(d => d.key === bill.key)!;
  assert.equal(subject.bill.name, 'Internet');
  assert.equal(billRuleKey(subject.bill), billRuleKey(bill.bill));
  const previous = { ...item('2026-10-04', 109, true), name: 'Mobile plan' };
  const history = billHistory(subject.bill, renamed, [previous], { other: '2026-10-07T15:00:00Z' }, {});
  assert.deepEqual(history.rows.map(row => row.key), [bill.key, previous.id]);
});
