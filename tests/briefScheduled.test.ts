import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBrief } from '../lib/dailyBrief';

const snaps = { role: { source: 'role', metrics: {}, featured: [], refreshedAt: '', tasks: [
  { id: 'hubtask:1', title: 'Send Follow up for Havi Interview', status: 'open', due: '2026-11-05', scheduled: '2026-11-05', kind: 'task' },
] } } as never;

test('a Role Hub task scheduled for tomorrow stays out of today’s brief and shows on its day', () => {
  const all = (d: string) => buildBrief(snaps, [], new Date(`${d}T09:00:00`)).flatMap(s => s.rows.map(r => r.title));
  assert.equal(all('2026-11-04').includes('Send Follow up for Havi Interview'), false);
  assert.equal(all('2026-11-05').includes('Send Follow up for Havi Interview'), true);
});
