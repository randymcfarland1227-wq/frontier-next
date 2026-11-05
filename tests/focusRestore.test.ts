import assert from 'node:assert/strict';
import { test } from 'node:test';

// Minimal browser storage so lib/storage works under node.
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.CustomEvent ??= class extends Event { detail: unknown; constructor(t: string, o?: { detail?: unknown }) { super(t); this.detail = o?.detail; } };
g.dispatchEvent ??= () => true;

test('a browser restored from the backup gets its cards back, with no scope added', async () => {
  const { writeFocusState } = await import('../lib/focusSync');
  store.clear();
  const at = '2026-11-05T02:38:00.000Z';
  writeFocusState({
    'lifehub-focus-now2::t1': { entry: { id: 't1', title: 'MD Speeding Ticket', at }, at },
    'lifehub-focus-weeks2::r1': { entry: { id: 'r1', title: 'MD Registration Renewal', at }, at },
  });
  const now = JSON.parse(store.get('lifehub-focus-now2')!);
  const weeks = JSON.parse(store.get('lifehub-focus-weeks2')!);
  assert.deepEqual(now.items.map((i: { title: string }) => i.title), ['MD Speeding Ticket']);
  assert.equal(now.scope, '');
  // weeks2 is not a week-reset list; stamping a Monday scope on it hid its cards.
  assert.equal(weeks.scope, '');
  assert.equal(weeks.items[0].title, 'MD Registration Renewal');
});

test('mondayScope is the Monday of the week, unpadded', async () => {
  const { mondayScope } = await import('../lib/focusSync');
  assert.equal(mondayScope(new Date(2026, 10, 5)), '2026-11-2');
  assert.equal(mondayScope(new Date(2026, 10, 2)), '2026-11-2');
  assert.equal(mondayScope(new Date(2026, 10, 1)), '2026-10-26');
});
