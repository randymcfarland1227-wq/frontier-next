import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.CustomEvent ??= class extends Event { detail: unknown; constructor(t: string, o?: { detail?: unknown }) { super(t); this.detail = o?.detail; } };
g.dispatchEvent ??= () => true;

const card = {
  id: 'c1', title: 'MD Registration', at: '2026-11-01T00:00:00.000Z',
  lists: [{ id: 'l1', name: 'Research', tasks: [
    { id: 't1', text: 'Call MVA', done: false },
    { id: 't2', text: 'Check fees', done: false },
    { id: 'f1', text: 'Finance row', done: false, fin: { key: 'x' } },
  ] }],
};

test('focus lists and tasks become Doing Now items, and checking one off marks it on the card', async () => {
  const { focusPinItems, completeFocusPin, focusTaskId, focusListId, focusCardId } = await import('../lib/focusPins');
  store.clear();
  store.set('lifehub-focus-now2', JSON.stringify({ scope: '', items: [card] }));
  const ids = focusPinItems().map((i) => i.id);
  assert.deepEqual(ids, [focusCardId('n', 'c1'), focusListId('n', 'c1', 'l1'), focusTaskId('n', 'c1', 'l1', 't1'), focusTaskId('n', 'c1', 'l1', 't2')]);
  assert.equal(completeFocusPin(focusTaskId('n', 'c1', 'l1', 't1')), true);
  const saved = JSON.parse(store.get('lifehub-focus-now2')!);
  assert.deepEqual(saved.items[0].lists[0].tasks.map((t: { done: boolean }) => t.done), [true, false, false]);
  assert.notEqual(saved.items[0].at, card.at, 'card gets a change stamp so the cloud backup merges it');
  assert.ok(!focusPinItems().some((i) => i.id === focusTaskId('n', 'c1', 'l1', 't1')), 'done task drops out of Doing Now');
  // Whole list: every open (non-finance) task done; then the list drops out.
  completeFocusPin(focusListId('n', 'c1', 'l1'));
  const after = JSON.parse(store.get('lifehub-focus-now2')!);
  assert.deepEqual(after.items[0].lists[0].tasks.map((t: { done: boolean }) => t.done), [true, true, false]);
  assert.equal(focusPinItems().length, 0);
  // Reopen from Doing Now
  completeFocusPin(focusTaskId('n', 'c1', 'l1', 't2'), false);
  assert.equal(JSON.parse(store.get('lifehub-focus-now2')!).items[0].lists[0].tasks[1].done, false);
});

test('a whole short-term goal can go to Doing Now; checking it off marks all its tasks done', async () => {
  const { focusPinItems, completeFocusPin, focusCardId } = await import('../lib/focusPins');
  store.clear();
  store.set('lifehub-focus-weeks2', JSON.stringify({ scope: '', items: [card] }));
  assert.equal(focusPinItems()[0].id, focusCardId('w', 'c1'));
  completeFocusPin(focusCardId('w', 'c1'));
  const after = JSON.parse(store.get('lifehub-focus-weeks2')!);
  assert.deepEqual(after.items[0].lists[0].tasks.map((t: { done: boolean }) => t.done), [true, true, false]);
  assert.equal(focusPinItems().length, 0);
});
