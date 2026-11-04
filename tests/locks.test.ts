import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockState, taskDone } from '../lib/locks';
import type { CompletionLedger } from '../lib/completions';

const ledger = { entries: { 'self::a1': { source: 'self' }, 'ticktick::t9::2026-11-04': { source: 'ticktick' } } } as unknown as CompletionLedger;

test('task lock opens once the task is in the completion log', () => {
  assert.equal(taskDone(ledger, 'self:a1'), true);
  assert.equal(taskDone(ledger, 'ticktick:t9'), true);
  assert.equal(lockState({ kind: 'task', key: 'self:b2', label: 'B' }, { ledger }).open, false);
});

test('list lock counts finished members', () => {
  const lists = { L: { id: 'L', site: 'self', name: 'Prep', tasks: ['a1', 'b2'], at: '' } } as never;
  const s = lockState({ kind: 'list', listId: 'L', label: 'Prep' }, { ledger, lists });
  assert.equal(s.open, false);
  assert.deepEqual(s.progress, [1, 2]);
});

test('habit lock opens at N check-ins', () => {
  const lock = { kind: 'habit', habitId: 'h1', title: 'Toothbrush', count: 5, from: '2026-11-04' } as const;
  assert.equal(lockState(lock, { count: () => 4 }).open, false);
  assert.equal(lockState(lock, { count: () => 5 }).open, true);
  assert.equal(lockState(lock, { count: () => undefined }).open, false);
});
