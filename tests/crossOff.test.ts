import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossOffEdit, type Cell, type MoneyItem } from '../lib/money';

const cell = (c: number, text: string, r = 40): Cell => ({ tab: 'Randy', r, c, text, formula: false, struck: false });
const item = (p: Partial<MoneyItem> = {}): MoneyItem => ({
  id: 'paylater:bjs:2026-11-07', kind: 'paylater', name: "BJ's", amount: 28.75, date: '2026-11-07', dateText: '11/7',
  cells: { date: cell(3, '11/7'), name: cell(4, "BJ's"), amount: cell(5, '$28.75') }, ...p,
});

test('crosses out the row from its first to last cell, expecting the first cell’s text', () => {
  assert.deepEqual(crossOffEdit(item()), { tab: 'Randy', r: 40, c1: 3, c2: 5, expect: '11/7', strike: true });
});

test('nothing to cross for a carried-forward month, an already crossed row, or no item', () => {
  assert.equal(crossOffEdit(item({ projected: true })), undefined);
  assert.equal(crossOffEdit(item({ skipped: true })), undefined);
  assert.equal(crossOffEdit(undefined), undefined);
});

test('cells on another row are left out', () => {
  assert.deepEqual(crossOffEdit(item({ cells: { date: cell(3, '11/7', 39), name: cell(4, "BJ's"), amount: cell(5, '$28.75') } })), { tab: 'Randy', r: 40, c1: 4, c2: 5, expect: "BJ's", strike: true });
});
