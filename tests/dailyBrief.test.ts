import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBrief, mailCategory } from '../lib/dailyBrief';
import { orderFocus } from '../lib/focusPriority';
import { SOURCE_IDS } from '../lib/sources';
import type { SourceId, SourceSnapshot } from '../lib/types';

const snapshots = () => Object.fromEntries(SOURCE_IDS.map(source => [source, { source, metrics: {}, tasks: [], featured: [], refreshedAt: '' }])) as Record<SourceId, SourceSnapshot>;

test('mail routes shipping and reply work without duplicating task and featured copies', () => {
  const snaps = snapshots();
  snaps.gmail.featured = [{ id: 'sale', title: 'You made the sale for a lamp', detail: 'Pack it up and ship it out', meta: 'eBay' }];
  snaps.gmail.tasks = [
    { id: 'sale', title: 'You made the sale for a lamp', status: 'open' },
    { id: 'reply', title: 'Interview availability', status: 'open' },
    { id: 'other', title: 'Something to review', status: 'open' },
    { id: 'done', title: 'Please ship this', status: 'done' },
  ];
  const sections = buildBrief(snaps, [], new Date(2026, 10, 2));
  assert.deepEqual(sections.find(s => s.id === 'sales')!.rows.map(r => r.id), ['mail:gmail:sale']);
  assert.deepEqual(sections.find(s => s.id === 'roles')!.rows.map(r => r.id), ['mail:gmail:reply']);
  assert.deepEqual(sections.find(s => s.id === 'mail')!.rows.map(r => r.id), ['mail:gmail:other']);
  assert.equal(sections.find(s => s.id === 'sales')!.rows[0].pin, 'gmail:sale');
});

test('explicit agent classification wins; receipts and fulfilled orders are not actionable replies/shipping', () => {
  assert.equal(mailCategory({ title: 'Follow up with Morgan', briefKind: 'reply' }), 'roles');
  assert.equal(mailCategory({ title: 'A sale', briefKind: 'shipping' }), 'sales');
  assert.equal(mailCategory({ title: 'Your order has shipped', detail: 'View shipping label' }), 'mail');
  assert.equal(mailCategory({ title: 'Thank you for applying to this job opportunity' }), 'mail');
  assert.equal(mailCategory({ title: 'Your item sold — please ship by Friday' }), 'sales');
});

test('today and overdue tasks include every task source, excluding completed and future items', () => {
  const snaps = snapshots();
  snaps.self.tasks = [{ id: 'late', title: 'Overdue', due: '2026-11-01' }, { id: 'today', title: 'Today', due: '2026-11-02' }, { id: 'future', title: 'Future', due: '2026-11-03' }, { id: 'done', title: 'Done', due: '2026-11-01', status: 'done' }];
  snaps.role.tasks = [{ id: 'role-due', title: 'Portfolio deadline', due: '2026-11-02' }];
  const rows = buildBrief(snaps, [], new Date(2026, 10, 2)).find(s => s.id === 'tasks')!.rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].tone, 'late');
  assert.ok(rows.some(r => r.pin === 'role:role-due'));
  assert.ok(buildBrief(snaps, [], new Date(2026, 10, 3)).find(s => s.id === 'tasks')!.rows.some(r => r.title === 'Future'));
});

test('focus ranks are stable, do not mutate storage order, and leave completed items last', () => {
  const items = [{ id: 'plain' }, { id: 'low', priority: 'green' as const }, { id: 'high', priority: 'red' as const }, { id: 'high2', priority: 'red' as const }, { id: 'done', priority: 'red' as const, done: true }];
  assert.deepEqual(orderFocus(items).map(i => i.id), ['high', 'high2', 'low', 'plain', 'done']);
  assert.equal(items[0].id, 'plain');
});
