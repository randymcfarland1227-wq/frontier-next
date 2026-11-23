import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutActionListRows, type BucketRow } from '../lib/dailyBrief';

const task = (id: string): BucketRow => ({ id, title: id, tag: 'task', pins: [`self:${id}`], ids: [id] });

test('all brief item types leave the bucket on the Action List and return when removed', () => {
  const rows = (['task', 'reply', 'appt', 'focus', 'mail', 'ship', '$'] as const).map(tag => ({ ...task(tag), tag }));
  const pinned = new Set(rows.map(row => row.pins[0]));
  assert.deepEqual(withoutActionListRows(rows, key => pinned.has(key)), []);
  pinned.delete('self:reply');
  assert.deepEqual(withoutActionListRows(rows, key => pinned.has(key)).map(row => row.id), ['reply']);
  assert.equal(rows.length, 7, 'filtering does not change source records');
  assert.equal(withoutActionListRows([{ ...task('no-pin'), pins: [] }], () => true).length, 1);
});

test('partially pinned bill groups show remaining members, names and total only', () => {
  const a = { ...task('toyota'), tag: '$' as const, amount: 330 };
  const b = { ...task('capital'), tag: '$' as const, amount: 25 };
  const c = { ...task('destiny'), tag: '$' as const, amount: 51 };
  const group: BucketRow = { id: 'g:late', title: '3 overdue', tag: '$', children: [a,b,c], pins: [a,b,c].flatMap(row => row.pins), ids: [a,b,c].map(row => row.id) };
  const [remaining] = withoutActionListRows([group], key => key === a.pins[0]);
  assert.equal(remaining.title, '2 overdue');
  assert.equal(remaining.amount, 76);
  assert.deepEqual(remaining.pins, [b.pins[0],c.pins[0]]);
  assert.ok(!remaining.note!.includes('toyota'));
  assert.equal(group.children!.length, 3);
  assert.deepEqual(withoutActionListRows([group], () => true), []);
  assert.equal(withoutActionListRows([group], () => false)[0], group);
});
