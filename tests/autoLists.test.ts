import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncAutoLists } from '../lib/autoLists';

const bill = (id: string, due: string, days: number) => ({ key: `bill:${id}:${due}`, due, days, bill: { name: id } });
const bills = [bill('Rent', '2026-11-20', -7), bill('Phone', '2026-11-27', 0), bill('Car', '2026-11-29', 2), bill('Gym', '2026-12-05', 8)];
let n = 0;
const id = () => `n${n++}`;
const names = (l: { tasks: { text: string }[] }) => l.tasks.map((t) => t.text);

test('payday list alone takes everything due before payday', () => {
  const out = syncAutoLists([{ id: 'p', name: 'Before next pay', tasks: [], auto: 'payday' as const }], bills, '2026-12-01', id)!;
  assert.deepEqual(names(out[0]), ['Rent', 'Phone', 'Car']);
});

test('each bill sits on one list: overdue, today, then before payday', () => {
  const lists = [
    { id: 'o', name: 'Overdue', tasks: [], auto: 'overdue' as const },
    { id: 't', name: 'Due today', tasks: [], auto: 'today' as const },
    { id: 'p', name: 'Before next pay', tasks: [], auto: 'payday' as const },
  ];
  const out = syncAutoLists(lists, bills, '2026-12-01', id)!;
  assert.deepEqual(out.map(names), [['Rent'], ['Phone'], ['Car']]);
  assert.equal(syncAutoLists(out, bills, '2026-12-01', id), null);
});

test('a due-today bill moves to Overdue the next day; skipped and manual ones stay put', () => {
  const lists = [
    { id: 'm', name: 'Cash', tasks: [{ id: 'x', text: 'Car', done: false, fin: { key: 'bill:bill:Car:2026-11-29', label: 'Car' } }] },
    { id: 'o', name: 'Overdue', tasks: [], auto: 'overdue' as const, autoSkip: ['bill:bill:Rent:2026-11-20'] },
    { id: 't', name: 'Due today', tasks: [{ id: 'y', text: 'Phone', done: false, fin: { key: 'bill:bill:Phone:2026-11-27', label: 'Phone' } }], auto: 'today' as const },
  ];
  const tomorrow = [bill('Rent', '2026-11-20', -8), bill('Phone', '2026-11-27', -1), bill('Car', '2026-11-29', 1)];
  const out = syncAutoLists(lists, tomorrow, '2026-12-01', id)!;
  assert.deepEqual(out.map(names), [['Car'], ['Phone'], []]);
});
