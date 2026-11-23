import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffSnapshotCompletions, loadLedger, recordCompletion, reopenCompletion, restoreReopenedSnapshots, type CompletionLedger } from '../lib/completions';
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
