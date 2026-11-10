import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displaySettings, DEFAULT_DISPLAY, pageZoom } from '../lib/displaySettings';

test('missing and malformed device preferences recover to a usable compact layout', () => {
  for (const value of [null, [], 'old data', { headers: 'tiny', tabs: 12, spacing: false }]) {
    assert.deepEqual(displaySettings(value), DEFAULT_DISPLAY);
  }
});
test('header, tab and spacing choices survive independently', () => {
  assert.deepEqual(displaySettings({ headers: 'large', tabs: 'standard', spacing: 'compact' }), { headers: 'large', tabs: 'standard', spacing: 'compact' });
});
test('old zoom preferences retain valid choices and reject unsafe values', () => {
  assert.equal(pageZoom(100), 100);
  assert.equal(pageZoom(80), 80);
  assert.equal(pageZoom(500), 160);
  assert.equal(pageZoom(-20), 60);
  for (const value of [null, '90', NaN, Infinity, {}]) assert.equal(pageZoom(value), null);
});
