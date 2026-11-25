import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceEdit, loanPayoff } from '../lib/loanLog';
import type { Cell } from '../lib/money';

test('0% loan pays off by plain division', () => {
  const p = loanPayoff(719, 21, 0, new Date(2026, 11, 15));
  assert.equal(p?.months, 35);
  assert.equal(p?.interest, 0);
  assert.equal(p?.date.getFullYear(), 2029);
});

test('APR loan adds interest; a payment below the interest never catches up', () => {
  const p = loanPayoff(2979, 20.57, 3.99, new Date(2026, 11, 3));
  assert.ok(p && p.months > 145 && p.interest > 0);
  assert.equal(loanPayoff(2979, 9, 3.99), null);
});

test('balance edit takes the amount off the Bal cell, guarded by its old text', () => {
  const c = (i: number, text: string): Cell => ({ tab: 'Credit', r: 5, c: i, text, formula: false, struck: false });
  const row = [c(0, 'Fortiva Retail Credit'), c(1, ''), c(2, '$719.00')];
  const ed = balanceEdit(row, 30);
  assert.deepEqual(ed?.edit, { tab: 'Credit', r: 5, c: 2, expect: '$719.00', value: '689' });
  assert.equal(balanceEdit([row[0], row[1], { ...row[2], formula: true }], 30), undefined);
});
