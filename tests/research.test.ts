import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchKey, sheetBuyKey } from '../lib/research';
import { parseBulkLine } from '../lib/bulkAdd';

test('one research record for a Self task wherever it moved', () => {
  assert.equal(researchKey('self:self-123'), 'self:self-123');
  assert.equal(researchKey('resale:self:self-123-0'), 'self:self-123-0');
  assert.equal(researchKey('own:abc'), 'own:abc');
  assert.equal(sheetBuyKey('Viking pedal cord!'), 'buy:viking-pedal-cord');
});

test('bulk add reads site tags per line', () => {
  assert.deepEqual(parseBulkLine('Finish Vinted listings @resale'), { title: 'Finish Vinted listings', home: 'resale' });
  assert.deepEqual(parseBulkLine('- Role: email the recruiter'), { title: 'email the recruiter', home: 'role' });
  assert.deepEqual(parseBulkLine('Process mail'), { title: 'Process mail', home: undefined });
  assert.deepEqual(parseBulkLine('Note: buy milk'), { title: 'Note: buy milk', home: undefined });
});
