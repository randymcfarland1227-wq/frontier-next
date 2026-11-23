import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffSnapshotCompletions, loadLedger, recordCompletion, reopenCompletion, restoreReopenedSnapshots, reopenTaskSnapshot, observeReopenedSource, type CompletionLedger } from '../lib/completions';
import { loadLanes, placePin, PLAN, unpin } from '../lib/priorityPins';
import { emptySnapshots } from '../lib/sources';
import { STORAGE_KEYS } from '../lib/storage';
import type { SourceSnapshot } from '../lib/types';
const memory = new Map<string,string>();
Object.assign(globalThis, { window: { dispatchEvent: () => true }, CustomEvent: class { constructor(public type: string) {} }, localStorage: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key,value); },
} });
const id = 'hubtask:sample-assessment';
const title = 'Complete sample assessment';
const task = { id, title, status:'open', due:'2026-11-23', originUrl:'https://example.com/task' };
const at = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const snap = (status: string, refreshedAt = at(0), completedAt?: string): SourceSnapshot => ({ source:'role', metrics:{}, featured:[], tasks:[{...task,status,completedAt}], refreshedAt });
const raw = (): CompletionLedger => JSON.parse(memory.get(STORAGE_KEYS.completions) || '{"entries":{}}');

test('taking an item off Action List changes only its placement, never its completion or source', () => {
  memory.clear();
  const source = snap('open');
  const before = JSON.stringify(source);
  const ledger = JSON.stringify(raw());
  placePin(`role:${id}`,PLAN);
  unpin(`role:${id}`);
  assert.equal(loadLanes()[`role:${id}`].lane,null);
  assert.equal(JSON.stringify(raw()),ledger);
  assert.equal(JSON.stringify(source),before);
});

test('Review undo restores a dismissed task with its details and survives repeated unchanged done feeds', () => {
  memory.clear();
  recordCompletion('role',id,{via:'hub',title,task,at:at(2)});
  assert.equal(loadLedger().entries[`role::${id}`].task?.due,task.due);
  assert.deepEqual(reopenCompletion('role',id).entries,{});
  const sources = emptySnapshots();
  sources.role = {...snap('open'),tasks:[]};
  sources.role = reopenTaskSnapshot(sources.role,id);
  const restored = restoreReopenedSnapshots(sources);
  assert.equal(restored.role.tasks[0].status,'open');
  assert.equal(restored.role.tasks[0].due,task.due);
  assert.equal(restored.role.tasks[0].originUrl,task.originUrl);
  for (const completedAt of [undefined,at(2),'not-a-date']) {
    const incoming = snap('done',at(0),completedAt);
    assert.deepEqual(diffSnapshotCompletions('role',restored.role,incoming).entries,{});
    const shown = restoreReopenedSnapshots({...restored,role:incoming});
    assert.equal(shown.role.tasks[0].status,'open');
    assert.equal(loadLedger().entries[`role::${id}`],undefined);
  }
  assert.ok(raw().entries[`role::${id}`].reopenedAt,'undo marker stays stored');
});

test('an older source snapshot cannot manufacture a completion before the snapshot merge rejects it', () => {
  memory.clear();
  assert.deepEqual(diffSnapshotCompletions('role',snap('open',at(1)),snap('done',at(2))).entries,{});
  assert.deepEqual(raw().entries,{});
});

test('only a genuinely newer dated completion can supersede an undo; explicit Done still works', () => {
  memory.clear();
  memory.set(STORAGE_KEYS.completions,JSON.stringify({entries:{[`role::${id}`]:{source:'role',taskId:id,title,via:'hub',completedAt:at(3),reopenedAt:at(2),task}}}));
  const incoming = snap('done',at(0),at(1));
  const result = diffSnapshotCompletions('role',snap('open',at(2)),incoming);
  assert.equal(Object.keys(result.entries).length,1);
  const sources = {...emptySnapshots(),role:incoming};
  assert.equal(restoreReopenedSnapshots(sources).role.tasks[0].status,'done');
  reopenCompletion('role',id);
  assert.equal(Object.keys(recordCompletion('role',id,{via:'hub',title,task}).entries).length,1);
});

test('legacy entries restore by identity and title; undo does not reopen TickTick tasks locally', () => {
  memory.clear();
  const entry = {source:'role',taskId:id,title,via:'hub',completedAt:at(3),reopenedAt:at(2)};
  memory.set(STORAGE_KEYS.completions,JSON.stringify({entries:{[`role::${id}`]:entry,'ticktick::sample':{...entry,source:'ticktick',taskId:'sample'}}}));
  const sources = emptySnapshots();
  sources.ticktick.tasks = [{id:'sample',title:'TickTick sample',status:'done'}];
  sources.role = reopenTaskSnapshot(sources.role,id);
  const restored = restoreReopenedSnapshots(sources);
  assert.equal(restored.role.tasks[0].title,title);
  assert.equal(restored.role.tasks[0].status,'open');
  assert.equal(restored.ticktick.tasks[0].status,'done');
});

test('undo markers for payments or legacy inferred disappearances do not fabricate tasks', () => {
  memory.clear();
  const entry = {source:'radall',taskId:'payment-key',title:'Paid sample bill',via:'hub',completedAt:at(3),reopenedAt:at(2)};
  memory.set(STORAGE_KEYS.completions,JSON.stringify({entries:{'radall::payment-key':entry,[`income::${id}`]:{...entry,source:'income',taskId:id,task,via:'origin-snapshot'}}}));
  const sources = emptySnapshots();
  assert.equal(restoreReopenedSnapshots(sources),sources);
});

const undoAt = '2020-01-02T10:00:00.000Z';
function seedUndo(source: 'role' | 'radall' | 'gmail' | 'outlook' | 'candle' | 'move' | 'repair' = 'role') {
  memory.clear();
  memory.set(STORAGE_KEYS.completions,JSON.stringify({entries:{[`${source}::${id}`]:{source,taskId:id,title,via:'hub',completedAt:'2020-01-01T10:00:00.000Z',reopenedAt:undoAt,task}}}));
}
const feed = (status: string, refreshedAt: string, completedAt?: string): SourceSnapshot => ({ ...snap(status,refreshedAt,completedAt),metrics:{open:0} });

test('a fresh source open then done transition counts without a completion timestamp, including after cache reload', () => {
  seedUndo();
  const stale = feed('done','2020-01-02T09:00:00.000Z');
  const opened = feed('open','2020-01-02T11:00:00.000Z');
  diffSnapshotCompletions('role',stale,opened);
  const done = feed('done','2020-01-02T12:00:00.000Z');
  const result = diffSnapshotCompletions('role',opened,done,loadLedger());
  assert.equal(result.entries[`role::${id}`].completedAt,done.refreshedAt);
  assert.equal(restoreReopenedSnapshots({...emptySnapshots(),role:done}).role.tasks[0].status,'done');
});

test('a post-undo source transition with only a same-day date uses the observed transition time', () => {
  seedUndo();
  const opened = feed('open','2020-01-02T11:00:00.000Z');
  observeReopenedSource(undefined,opened);
  const done = feed('done','2020-01-02T13:00:00.000Z','2020-01-02');
  const result = diffSnapshotCompletions('role',opened,done);
  assert.equal(result.entries[`role::${id}`].completedAt,done.refreshedAt);
});

test('local projected open rows and older raw open feeds are not source acknowledgement', () => {
  seedUndo();
  const projected = restoreReopenedSnapshots({...emptySnapshots(),role:feed('done','2020-01-02T11:00:00.000Z')}).role;
  const done = feed('done','2020-01-02T12:00:00.000Z');
  assert.deepEqual(diffSnapshotCompletions('role',projected,done).entries,{});
  observeReopenedSource(undefined,feed('open','2020-01-02T09:00:00.000Z'));
  assert.deepEqual(diffSnapshotCompletions('role',projected,done).entries,{});
});

test('a newer source snapshot that omits an undone task stays empty through repeated projections', () => {
  seedUndo();
  const source = {...feed('done','2020-01-02T11:00:00.000Z'),tasks:[]};
  const locallyRestored = reopenTaskSnapshot(source,id);
  assert.equal(locallyRestored.tasks.length,1,'explicit Undo restores locally once');
  const deleted = {...source,refreshedAt:'2020-01-02T12:00:00.000Z'};
  const result = restoreReopenedSnapshots({...emptySnapshots(),role:deleted});
  assert.equal(result.role.tasks.length,0);
  assert.equal(restoreReopenedSnapshots(result).role.tasks.length,0);
  assert.deepEqual(loadLedger().entries,{},'disappearance is never completion');
});

test('restored task counts match open rows without repeated increments', () => {
  for (const [source,key] of [['radall','open'],['gmail','action'],['outlook','blue'],['candle','openStudioTasks'],['move','openTasks'],['repair','open']] as const) {
    seedUndo(source);
    const incoming = {...feed('done','2020-01-02T11:00:00.000Z'),source,metrics:{[key]:0,done:1,completedTasks:1}};
    const restored = restoreReopenedSnapshots({...emptySnapshots(),[source]:incoming});
    assert.equal(restored[source].tasks[0].status,'open');
    assert.equal(restored[source].metrics[key],1,source);
    assert.equal(restoreReopenedSnapshots(restored)[source].metrics[key],1,'projection is idempotent');
    assert.equal(incoming.metrics[key],0,'raw source data is immutable');
    const missing = {...incoming,tasks:[]};
    assert.equal(reopenTaskSnapshot(missing,id).metrics[key],1,'immediate Undo restores a dismissed row count');
  }
});

test('an acknowledgement for an older Undo cannot authorize a completion after a newer Undo', () => {
  seedUndo();
  observeReopenedSource(undefined,feed('open','2020-01-02T11:00:00.000Z'));
  const saved=raw(); saved.entries[`role::${id}`].reopenedAt='2020-01-03T10:00:00.000Z';
  memory.set(STORAGE_KEYS.completions,JSON.stringify(saved));
  assert.deepEqual(diffSnapshotCompletions('role',feed('open','2020-01-03T09:00:00.000Z'),feed('done','2020-01-03T12:00:00.000Z')).entries,{});
});

test('new undated completion converges with the existing undo marker in either cloud merge order', async () => {
  seedUndo();
  const undone=raw();
  const opened=feed('open','2020-01-02T11:00:00.000Z');
  observeReopenedSource(undefined,opened);
  diffSnapshotCompletions('role',opened,feed('done','2020-01-02T12:00:00.000Z'));
  const completed=raw();
  const {mergeState}=await import('../lib/syncState');
  for(const [a,b] of [[undone,completed],[completed,undone]]) {
    const merged=mergeState({completions:a},{completions:b});
    memory.clear();
    memory.set(STORAGE_KEYS.completions,JSON.stringify(merged.completions));
    assert.equal(Object.keys(loadLedger().entries).length,1);
    assert.equal(restoreReopenedSnapshots({...emptySnapshots(),role:feed('done','2020-01-02T12:00:00.000Z')}).role.tasks[0].status,'done');
  }
});

test('the newest raw open acknowledgement protects against a done feed older than that acknowledgement', () => {
  seedUndo();
  const opened=feed('open','2020-01-02T11:00:00.000Z');
  observeReopenedSource(undefined,opened);
  const newest=feed('open','2020-01-02T14:00:00.000Z');
  observeReopenedSource(opened,newest);
  const olderDone=feed('done','2020-01-02T13:00:00.000Z');
  assert.deepEqual(diffSnapshotCompletions('role',newest,olderDone).entries,{});
  assert.equal(restoreReopenedSnapshots({...emptySnapshots(),role:olderDone}).role.tasks[0].status,'open');
});
