import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activePursuits, linkOptions, linkStatus } from '../lib/goalLinks';
import type { CompletionLedger } from '../lib/completions';
import type { SourceSnapshot } from '../lib/types';

const snap = (tasks: unknown[], shelves?: unknown[]) => ({ source: 'x', metrics: {}, featured: [], refreshedAt: '', tasks, shelves }) as unknown as SourceSnapshot;

test('link options: feed habits + tasks, schedule habits added once', () => {
  const o = linkOptions(snap([{ id: 'habit-h1', title: 'Stretch', kind: 'habit' }, { id: 't1', title: 'Daily Workflow' }]), [{ id: 'h1', title: 'stretch' }, { id: 'h2', title: 'Read' }]);
  assert.deepEqual(o.map((x) => `${x.kind}:${x.id}`), ['habit:habit-h2', 'habit:habit-h1', 'task:t1']);
});

test('link status: done today by id or by title (recurring copy), days in last 7', () => {
  const now = new Date(2026, 10, 5, 15);
  const at = (d: number) => new Date(2026, 10, d, 10).toISOString();
  const ledger = { entries: {
    a: { source: 'ticktick', taskId: 'copy-9', title: 'daily workflow', completedAt: at(5) },
    b: { source: 'ticktick', taskId: 't1', title: 'Daily Workflow', completedAt: at(3) },
    c: { source: 'ticktick', taskId: 't1', completedAt: at(3) },
    d: { source: 'self', taskId: 't1', completedAt: at(4) },
  } } as unknown as CompletionLedger;
  const s = linkStatus({ id: 't1', title: 'Daily Workflow', kind: 'task' }, ledger, now);
  assert.equal(s.doneToday, true);
  assert.equal(s.last7, 2);
  assert.equal(linkStatus({ id: 'z', title: 'Other', kind: 'task' }, ledger, now).doneToday, false);
});

test('active pursuits: shelf when sent, else grouped from task names', () => {
  const tasks = [{ id: '1', title: 'a', detail: 'Candles', status: 'open' }, { id: '2', title: 'b', detail: 'Candles', status: 'open' }, { id: '3', title: 'c', detail: 'Apps', status: 'done' }];
  assert.deepEqual(activePursuits(snap(tasks)).map((p) => `${p.title}:${p.open}`), ['Candles:2', 'Apps:0']);
  const withShelf = activePursuits(snap(tasks, [{ id: 'pursuits', label: '', items: [{ id: 'p1', title: 'Candles', tag: 'Building' }] }]));
  assert.deepEqual(withShelf, [{ id: 'p1', title: 'Candles', status: 'Building', open: 2, url: undefined }]);
});
