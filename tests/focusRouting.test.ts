import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignedFocusLists, focusListView, focusTarget, type FocusCollections, type FocusList } from '../lib/focusRouting';
import type { Entry } from '../app/components/FocusSection';
import { SOURCE_IDS } from '../lib/sources';
import { rollForward, type MoneyItem } from '../lib/money';
import { applyBillEdits } from '../lib/billEdits';
import { withoutSheetTwins } from '../lib/lifeSubs';
import type { BillDue } from '../lib/schedule';

test('each existing site receives its assigned record without a second copy', () => {
  const empty = [[], () => {}] as FocusList;
  for (const site of SOURCE_IDS) {
    const item: Entry = { id: 'shared', title: 'A goal', site, note: 'scope', why: 'why', lists: [{ id: 'list', name: 'Steps', tasks: [] }] };
    const focus: FocusCollections = { now: [[item], () => {}], weeks: empty, ongoing: empty, nutrition: empty, fitness: empty, marvel: empty };
    const matches = assignedFocusLists(focus, site).flatMap(([items]) => items);
    assert.equal(matches.length, 1);
    assert.equal(matches[0], item);
  }
});

test('editing or reassigning through a filtered destination retains unrelated records and all detail', () => {
  let saved: Entry[] = [{ id: 'a', title: 'Toothbrush', section: 'marvel', why: 'Dental care', lists: [{ id: 'l', name: 'Steps', tasks: [] }] }, { id: 'b', title: 'Other goal', site: 'income' }];
  const view = focusListView([saved, next => { saved = next; }], i => focusTarget(i) === 'marvel');
  view[1]([{ ...view[0][0], site: 'income', section: undefined }]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].why, 'Dental care');
  assert.equal(saved[0].lists?.[0].name, 'Steps');
  assert.equal(focusTarget(saved[0]), 'income');
  assert.equal(saved[1].id, 'b');
  const income = focusListView([saved, next => { saved = next; }], i => focusTarget(i) === 'income');
  income[1](income[0].map(i => i.id === 'a' ? { ...i, done: true } : i));
  assert.equal(saved[0].done, true);
});

test('old Nutrition/Fitness/Marvel records retain their section and can explicitly be unassigned', () => {
  for (const home of ['nutrition', 'fitness', 'marvel'] as const) {
    const item: Entry = { id: home, title: home };
    assert.equal(focusTarget(item, home), home);
    assert.equal(focusTarget({ ...item, unassigned: true }, home), undefined);
    assert.equal(focusTarget({ ...item, site: 'self' }, home), 'self');
  }
});

const moneyItem = (id: string, date: string, kind: MoneyItem['kind'] = 'bill'): MoneyItem => ({ id, name: 'Sample service', kind, amount: 10, date, dateText: date, cells: { name: { tab: 'Randy', r: 1, c: 1, text: 'Sample service', formula: false, struck: false } } });
test('recovered monthly repeats retain history, clamp short months, and respect an explicit next-month amount', () => {
  const old = moneyItem('old', '2026-01-31');
  const next = { ...moneyItem('typed', '2026-02-28'), amount: 15 };
  const rows = rollForward([old, next], new Date(2026, 1, 2), 75);
  assert.ok(rows.includes(old));
  assert.ok(rows.includes(next));
  assert.equal(rows.filter(i => i.date === '2026-02-28').length, 1);
  const generated = rollForward([old], new Date(2026, 1, 2), 35);
  assert.ok(generated.some(i => i.date === '2026-02-28' && i.projected));
  assert.equal(rollForward([moneyItem('one-off', '2026-01-31', 'paylater')], new Date(2026, 1, 2)).length, 1);
});

test('bill removal and subscription deduplication only filter the hub view', () => {
  const due: BillDue = { key: 'sample', due: '2026-11-02', days: 0, bill: { id: 'sample', name: 'Google One (200 GB)', amount: 2.99, kind: 'sub' } };
  assert.equal(applyBillEdits([due], { sample: { removed: true, at: '2026-11-02' } }, new Date(2026, 10, 2), {}).length, 0);
  assert.equal(due.bill.amount, 2.99);
  assert.equal(withoutSheetTwins([due], [{ ...due, key: 'sheet' }]).length, 0);
});
