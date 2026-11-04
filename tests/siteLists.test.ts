import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySiteLists, viewOfList, type SiteListStore } from '../lib/siteLists';
import { mergeState } from '../lib/syncState';
import type { SourceSnapshot, TaskItem } from '../lib/types';

const task = (id: string, extra: Partial<TaskItem> = {}): TaskItem => ({ id, title: id, status: 'open', ...extra });
const snap = (tasks: TaskItem[], open = tasks.length): SourceSnapshot =>
  ({ source: 'radall', metrics: { open, done: 4 }, featured: [], tasks, refreshedAt: '2026-11-03T00:00:00.000Z' }) as unknown as SourceSnapshot;
const list = (tasks: string[], extra = {}) => ({ id: 'sl-1', site: 'radall' as const, name: 'Storefront', tasks, at: '2026-11-03T10:00:00.000Z', ...extra });

test('a list pulls its tasks out of the pool and stands in as one task', () => {
  const base = { radall: snap([task('a'), task('b'), task('c'), task('z', { due: '2026-11-09' })]) };
  const out = applySiteLists(base, { 'sl-1': list(['a', 'b', 'c']) } as SiteListStore);
  const ids = out.radall!.tasks.map(t => t.id);
  assert.deepEqual(ids.sort(), ['list:sl-1', 'z']);
  const row = out.radall!.tasks.find(t => t.id === 'list:sl-1')!;
  assert.equal(row.title, 'Storefront');
  assert.equal(row.detail, '3 of 3 left');
  assert.equal(row.kind, 'list');
  assert.equal(out.radall!.metrics.open, 4 - 3 + 1); // 3 members left the count, the list counts once
  assert.equal(out.radall!.metrics.done, 4); // done counters untouched
});

test('finished tasks shrink the list; a list with nothing open disappears', () => {
  const some = applySiteLists({ radall: snap([task('a'), task('c', { status: 'done' })]) }, { 'sl-1': list(['a', 'b', 'c']) } as SiteListStore);
  assert.equal(some.radall!.tasks.find(t => t.id === 'list:sl-1')!.detail, '1 of 3 left');
  const none = applySiteLists({ radall: snap([task('z')]) }, { 'sl-1': list(['a', 'b']) } as SiteListStore);
  assert.deepEqual(none.radall!.tasks.map(t => t.id), ['z']);
});

test('a deleted list gives every task back to the pool', () => {
  const out = applySiteLists({ radall: snap([task('a'), task('b')]) }, { 'sl-1': list(['a', 'b'], { gone: true }) } as SiteListStore);
  assert.deepEqual(out.radall!.tasks.map(t => t.id), ['a', 'b']);
});

test('viewOfList reads the live tasks (goals link lists; the list stays in the pool)', () => {
  const v = viewOfList(list(['a', 'b', 'c']) as never, { radall: snap([task('a'), task('b', { status: 'done' })]) });
  assert.equal(v.total, 3);
  assert.equal(v.open.length, 1);
  assert.equal(v.done, 2);
});

test('lists merge across devices: newest wins, a delete sticks', () => {
  const a = { siteLists: { 'sl-1': list(['a']) } };
  const b = { siteLists: { 'sl-1': list(['a', 'b'], { at: '2026-11-04T10:00:00.000Z' }) } };
  assert.deepEqual((mergeState(a, b).siteLists['sl-1'] as unknown as { tasks: string[] }).tasks, ['a', 'b']);
  const gone = { siteLists: { 'sl-1': list(['a', 'b'], { gone: true, at: '2026-11-05T10:00:00.000Z' }) } };
  assert.equal((mergeState(b, gone).siteLists['sl-1'] as unknown as { gone?: boolean }).gone, true);
});

test('a benchmark mirrors a list into another site, uncounted, and shows done when the list finishes', () => {
  const mv = { ...snap([task('m1')]), source: 'move', metrics: { openTasks: 1 } } as unknown as SourceSnapshot;
  const store = { 'sl-1': list(['a', 'b'], { alsoIn: ['move'] }) } as SiteListStore;
  const open = applySiteLists({ radall: snap([task('a'), task('b')]), move: mv }, store);
  const row = open.move!.tasks.find(t => t.id === 'list:sl-1')!;
  assert.equal(row.status, 'open');
  assert.equal(row.tag, 'Benchmark');
  assert.equal(open.move!.metrics.openTasks, 1);
  const done = applySiteLists({ radall: snap([task('a', { status: 'done' }), task('b', { status: 'done' })]), move: mv }, store);
  assert.equal(done.move!.tasks.find(t => t.id === 'list:sl-1')!.status, 'done');
});

test('finished members stay in the list view (struck), titled from the completion log', () => {
  // Xfinity was checked off: the connector feed dropped it, the log still has its title.
  const v = viewOfList(list(['a', 'xf', 'c']), { radall: snap([task('a'), task('c')]) }, (site, id) =>
    site === 'radall' && id === 'xf' ? { title: 'Call Xfinity', at: '2026-11-04T09:00:00.000Z' } : undefined,
  );
  assert.deepEqual(v.items, [
    { id: 'a', title: 'a', done: false },
    { id: 'xf', title: 'Call Xfinity', done: true },
    { id: 'c', title: 'c', done: false },
  ]);
  assert.equal(v.done, 1);
  assert.equal(v.open.length, 2);
});

test('unchecking survives sync, and a later re-check wins over it', () => {
  const done = { source: 'radall', taskId: 'xf', completedAt: '2026-11-04T09:00:00.000Z', title: 'Call Xfinity', via: 'hub' };
  const reopened = { ...done, reopenedAt: '2026-11-04T10:00:00.000Z' };
  const k = 'radall::xf';
  const m1 = mergeState({ completions: { entries: { [k]: done } } }, { completions: { entries: { [k]: reopened } } });
  assert.equal(m1.completions.entries[k].reopenedAt, '2026-11-04T10:00:00.000Z');
  assert.ok(m1.completions.entries[k].completedAt <= m1.completions.entries[k].reopenedAt!);
  const again = { ...done, completedAt: '2026-11-04T11:00:00.000Z' };
  const m2 = mergeState({ completions: { entries: { [k]: reopened } } }, { completions: { entries: { [k]: again } } });
  assert.equal(m2.completions.entries[k].completedAt, '2026-11-04T11:00:00.000Z');
});
