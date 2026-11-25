import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLedger, loadLedgerWithUndos, recordCompletion, reopenCompletion } from '../lib/completions';
import { mergeState } from '../lib/syncState';
const memory = new Map<string, string>();
Object.assign(globalThis, { window: { dispatchEvent: () => true }, CustomEvent: class { constructor(public type: string) {} }, localStorage: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
} });

test('an Undo Paid survives the cloud sync round trip', () => {
  memory.clear();
  const key = 'money:card:cap-1-q:2026-11-20';
  recordCompletion('radall', key, { title: 'Paid card', via: 'hub' });
  // The server already holds the paid copy from an earlier push.
  const server = mergeState(null, { completions: loadLedgerWithUndos() });
  reopenCompletion('radall', key);
  assert.equal(loadLedger().entries[`radall::${key}`], undefined);
  // Push what this browser has, take back the merged state: the Undo must still win.
  const merged = mergeState(server, { completions: loadLedgerWithUndos() });
  const back = mergeState(merged, { completions: loadLedgerWithUndos() });
  const entry = back.completions.entries[`radall::${key}`];
  assert.ok(entry?.reopenedAt, 'the Undo marker went missing in the merge');
  assert.ok(entry.reopenedAt >= entry.completedAt);
});
