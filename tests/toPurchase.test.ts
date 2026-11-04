import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purchaseAddEdits, purchaseDeleteEdits, type Cell, type Table } from '../lib/money';

const row = (r: number, texts: string[], struck = false): Cell[] => texts.map((text, i) => ({ tab: 'Restock', r, c: 10 + i, text, formula: false, struck }));
const table = (rows: Cell[][]): Table => ({ key: 'toPurchase', title: 'To purchase', tab: 'Restock', header: [], rows });

test('add writes under the last item, in the item / why / cost / where / priority columns', () => {
  const t = table([row(20, ['Mop', 'floor', '$12', 'Target', '', '', 'High']), row(21, ['Soap', '', '$4', '', '', '', ''])]);
  assert.deepEqual(purchaseAddEdits(t, { item: 'Tape', cost: '5', priority: 'Low' }), [
    { tab: 'Restock', r: 22, c: 10, expect: '', value: 'Tape' },
    { tab: 'Restock', r: 22, c: 12, expect: '', value: '5' },
    { tab: 'Restock', r: 22, c: 16, expect: '', value: 'Low' },
  ]);
  assert.deepEqual(purchaseAddEdits(t, { item: '  ' }), []);
});

test('delete moves later items up, keeps their cross-out, and clears the last row', () => {
  const t = table([row(20, ['A', 'x']), row(21, ['B', 'y'], true), row(22, ['C', ''])]);
  assert.deepEqual(purchaseDeleteEdits(t, 0), [
    { tab: 'Restock', r: 20, c: 10, expect: 'A', value: 'B' },
    { tab: 'Restock', r: 20, c: 11, expect: 'x', value: 'y' },
    { tab: 'Restock', r: 20, c1: 10, c2: 11, expect: 'B', strike: true },
    { tab: 'Restock', r: 21, c: 10, expect: 'B', value: 'C' },
    { tab: 'Restock', r: 21, c: 11, expect: 'y', value: '' },
    { tab: 'Restock', r: 21, c1: 10, c2: 11, expect: 'C', strike: false },
    { tab: 'Restock', r: 22, c: 10, expect: 'C', value: '' },
  ]);
});
