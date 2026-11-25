import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDueSelfRepeats } from '../lib/selfRepeats';

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
const selfIds = () => (JSON.parse(records.get('lifehub-self-inbox') || '[]') as Array<{ id: string }>).map(i => i.id);

test('nothing before the start day; Friday and the 23rd each make one task, once', () => {
  assert.equal(makeDueSelfRepeats(new Date(2026, 10, 25)), false); // Wed Nov 25: last Fri (20th) and 23rd are before start
  assert.equal(makeDueSelfRepeats(new Date(2026, 10, 28)), true); // Sat after Fri Nov 27
  assert.deepEqual(selfIds(), ['self-rep-paylater-verify-2026-11-27']);
  assert.equal(makeDueSelfRepeats(new Date(2026, 10, 29)), false); // same Friday again: no copy
  makeDueSelfRepeats(new Date(2026, 11, 23)); // Wed Dec 23: Friday Dec 18 + the 23rd
  assert.ok(selfIds().includes('self-rep-card-verify-2026-12-23'));
  assert.ok(selfIds().includes('self-rep-paylater-verify-2026-12-18'));
});
