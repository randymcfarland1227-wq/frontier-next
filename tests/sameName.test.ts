import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renameEdits, ruleDayOf, sameNameTwice, type MoneyItem } from '../lib/money';
import { billRuleKey } from '../lib/billEdits';

const cell = (r: number, text: string) => ({ tab: 'T', r, c: 1, text, formula: false, struck: false });
const item = (id: string, date: string, r: number): MoneyItem =>
  ({ id, kind: 'bill', name: 'Verizon', date, amount: 100, cells: { name: cell(r, 'Verizon') } }) as unknown as MoneyItem;

test('two Verizons in one month get separate rule keys; a single bill keeps the old key', () => {
  const items = [item('a', '2026-11-06', 1), item('b', '2026-11-09', 2), item('a2', '2026-12-06', 3)];
  const dup = sameNameTwice(items);
  assert.equal(ruleDayOf(items[0], dup), '06');
  assert.equal(ruleDayOf(items[1], dup), '09');
  assert.notEqual(billRuleKey({ name: 'Verizon', ruleDay: '06' }), billRuleKey({ name: 'Verizon', ruleDay: '09' }));
  assert.equal(billRuleKey({ name: 'Verizon' }), 'bill:verizon');
});

test('rename writes only this bill’s rows from this month on', () => {
  const items = [item('a0', '2026-10-06', 0), item('a', '2026-11-06', 1), item('b', '2026-11-09', 2), item('a2', '2026-12-06', 3)];
  const e = renameEdits(items, items[1], 'Verizon Wireless');
  assert.deepEqual(e.map(x => (x as { r: number }).r), [1, 3]);
});
