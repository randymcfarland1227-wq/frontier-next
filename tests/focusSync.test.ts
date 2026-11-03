import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeState, normalizeState } from '../lib/syncState';

const card = (title: string, at: string) => ({ entry: { id: 'a', title, at } as Record<string, unknown>, at });
const key = 'lifehub-focus-now2::a';

test('focus cards from two devices are all kept; the newest edit of the same card wins', () => {
  const a = { focus: { [key]: card('old title', '2026-11-01T10:00:00.000Z'), 'lifehub-focus-now2::b': card('only on A', '2026-11-01T10:00:00.000Z') } };
  const b = { focus: { [key]: card('new title', '2026-11-02T10:00:00.000Z') } };
  const m = mergeState(a, b).focus;
  assert.equal((m[key].entry as { title: string }).title, 'new title');
  assert.ok(m['lifehub-focus-now2::b'].entry);
  assert.deepEqual(Object.keys(mergeState(b, a).focus).sort(), Object.keys(m).sort());
});

test('a newer delete beats an older copy, and a newer re-add beats the delete', () => {
  const live = { focus: { [key]: card('x', '2026-11-01T10:00:00.000Z') } };
  const deleted = { focus: { [key]: { entry: null, at: '2026-11-02T10:00:00.000Z' } } };
  assert.equal(mergeState(live, deleted).focus[key].entry, null);
  assert.equal(mergeState(deleted, live).focus[key].entry, null);
  const readded = { focus: { [key]: card('back', '2026-11-03T10:00:00.000Z') } };
  assert.ok(mergeState(deleted, readded).focus[key].entry);
});

test('a seeded (epoch) card never resurrects a deleted one', () => {
  const seeded = { focus: { [key]: card('seed', '1970-01-01T00:00:00.000Z') } };
  const deleted = { focus: { [key]: { entry: null, at: '2026-11-02T10:00:00.000Z' } } };
  assert.equal(mergeState(seeded, deleted).focus[key].entry, null);
});

test('an older client that sends no focus data leaves the stored cards alone', () => {
  const stored = { focus: { [key]: card('kept', '2026-11-01T10:00:00.000Z') } };
  const old = { self: [] };
  assert.equal((mergeState(stored, old).focus[key].entry as { title: string }).title, 'kept');
  assert.deepEqual(normalizeState(old).focus, {});
});

// The browser side: local lists ⇄ synced records (with a minimal localStorage).
test('local lists round-trip through the synced records, deletes included', async () => {
  const mem = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { dispatchEvent: () => true, addEventListener: () => {} };
  g.CustomEvent = class { constructor(public type: string, public init?: unknown) {} };
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const { readFocusState, writeFocusState, stampChanges } = await import('../lib/focusSync');
  mem.set('lifehub-focus-now2', JSON.stringify({ scope: '', items: [{ id: 'x', title: 'mine' }, { id: 'y', title: 'to delete', at: '2026-11-01T00:00:00.000Z' }] }));
  mem.set('lifehub-focus-fit-areas', JSON.stringify([{ id: 'f', title: 'fit' }]));
  const local = readFocusState();
  assert.equal(local['lifehub-focus-now2::x'].at, '1970-01-01T00:00:00.000Z'); // never edited → epoch
  const remote = {
    'lifehub-focus-now2::y': { entry: null, at: '2026-11-02T00:00:00.000Z' }, // deleted elsewhere
    'lifehub-focus-ongoing::z': { entry: { id: 'z', title: 'from phone', at: '2026-11-02T00:00:00.000Z' }, at: '2026-11-02T00:00:00.000Z' },
  };
  assert.equal(writeFocusState(mergeState({ focus: local }, { focus: remote }).focus), true);
  const now = JSON.parse(mem.get('lifehub-focus-now2')!);
  assert.deepEqual(now.items.map((i: { id: string }) => i.id), ['x']);
  assert.equal(JSON.parse(mem.get('lifehub-focus-ongoing')!).items[0].title, 'from phone');
  assert.deepEqual(JSON.parse(mem.get('lifehub-focus-fit-areas')!).map((i: { id: string }) => i.id), ['f']); // array shape kept
  // UI save: an edit is stamped, a removal leaves a tombstone.
  const next = stampChanges<{ id: string; title: string; at?: string }>('lifehub-focus-now2', now.items, [{ id: 'x', title: 'edited' }]);
  assert.ok(next[0].at && next[0].at > '2026');
  const edited = stampChanges('lifehub-focus-now2', next, []);
  assert.deepEqual(edited, []);
  assert.ok(JSON.parse(mem.get('lifehub-focus-tombs')!)['lifehub-focus-now2::x']);
});
