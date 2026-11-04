import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hubCardDues, type ExtraCard } from '../lib/extraCards';

const card = (p: Partial<ExtraCard>): ExtraCard => ({ id: 'c1', name: 'Discover It', createdAt: 'x', updatedAt: 'x', ...p });
const now = new Date('2026-11-04T12:00:00');

test('a card added here with a due day pays its minimum on that day each month', () => {
  const out = hubCardDues(null, {}, [card({ dueDay: 12, min: 35 })], new Set(), now);
  const nov = out.find(d => d.due === '2026-11-12')!;
  assert.ok(nov);
  assert.equal(nov.bill.kind, 'card');
  assert.equal(nov.bill.amount, 35);
  assert.equal(nov.key, 'money:hubcard:discoverit:2026-11-12');
  assert.ok(out.some(d => d.due === '2026-12-12'));
});

test('no due day, removed, or paid = no payment', () => {
  assert.equal(hubCardDues(null, {}, [card({})], new Set(), now).length, 0);
  assert.equal(hubCardDues(null, {}, [card({ dueDay: 12, removed: true })], new Set(), now).length, 0);
  const paid = new Set(['money:hubcard:discoverit:2026-11-12']);
  assert.ok(!hubCardDues(null, {}, [card({ dueDay: 12 })], paid, now).some(d => d.due === '2026-11-12'));
});

test('day 31 lands on the month’s last day', () => {
  assert.ok(hubCardDues(null, {}, [card({ dueDay: 31 })], new Set(), now).some(d => d.due === '2026-11-30'));
});
