import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSelfProject, OPEN_PROJECT_EVENT } from '../lib/selfProjects';
import { shownMetric } from '../lib/actionable';
import type { SourceSnapshot } from '../lib/types';

const records = new Map<string, string>();
const target = new EventTarget();
Object.assign(globalThis, {
  window: { dispatchEvent: target.dispatchEvent.bind(target) },
  localStorage: {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  },
  CustomEvent: class extends Event {
    detail: unknown;
    constructor(type: string, options?: { detail: unknown }) { super(type); this.detail = options?.detail; }
  },
});

test('creating a project preserves existing focus records and opens the new shared editor', () => {
  const existing = { id: 'existing', title: 'Existing project', lists: [{ id: 'list', tasks: [] }] };
  records.set('lifehub-focus-now2', JSON.stringify({ scope: 'saved', items: [existing] }));
  let selected: unknown;
  target.addEventListener(OPEN_PROJECT_EVENT, event => { selected = (event as CustomEvent).detail; }, { once: true });
  addSelfProject('  Financial centering  ', 'Orders and bills', 'Get organized', 'https://example.com/reference');
  const saved = JSON.parse(records.get('lifehub-focus-now2')!);
  assert.equal(saved.scope, 'saved');
  assert.deepEqual(saved.items[0], existing);
  assert.equal(saved.items[1].id, selected);
  assert.equal(saved.items[1].title, 'Financial centering');
  assert.equal(saved.items[1].site, 'self');
  assert.equal(saved.items[1].refs[0].url, 'https://example.com/reference');
  assert.deepEqual(saved.items[1].lists, []);
});

test('Self retains its open count when tasks enter Doing now', () => {
  const snapshot = { metrics: { open: 2 }, tasks: [{ id: 'a', title: 'A', status: 'open' }, { id: 'b', title: 'B', status: 'open' }], featured: [] } as unknown as SourceSnapshot;
  const lanes = { 'self:a': { lane: 'next', order: 0, at: '2026-11-18' } } as Parameters<typeof shownMetric>[2];
  assert.equal(shownMetric('self', snapshot, lanes, () => true).value, 2);
  assert.equal(shownMetric('self', snapshot, lanes).deduct, 0);
});
