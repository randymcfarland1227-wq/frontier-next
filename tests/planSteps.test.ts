import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupSteps, type LaneMap } from '../lib/priorityPins';

const at = '2026-11-04T00:00:00.000Z';
const item = (key: string) => ({ key });

test('mix members fold into one step at the first member, others stay single', () => {
  const lanes = {
    'mix:m1': { lane: null, order: 0, at, name: 'Bills' },
    a: { lane: 'plan', order: 1, at, mix: 'm1' },
    b: { lane: 'plan', order: 2, at },
    c: { lane: 'plan', order: 3, at, mix: 'm1' },
    d: { lane: null, order: 4, at, mix: 'm1', doneTitle: 'Done one' },
  } as unknown as LaneMap;
  const steps = groupSteps([item('a'), item('b'), item('c')], lanes);
  assert.equal(steps.length, 2);
  const mix = steps[0];
  assert.equal(mix.kind, 'mix');
  if (mix.kind === 'mix') {
    assert.equal(mix.name, 'Bills');
    assert.deepEqual(mix.items.map((i) => i.key), ['a', 'c']);
    assert.deepEqual(mix.done, [{ key: 'd', title: 'Done one' }]);
  }
  assert.equal(steps[1].kind, 'one');
});

test('a retired mix leaves its members as single rows', () => {
  const lanes = { 'mix:m1': { lane: null, order: 0, at, name: 'Bills', gone: true }, a: { lane: 'plan', order: 1, at, mix: 'm1' } } as unknown as LaneMap;
  assert.equal(groupSteps([item('a')], lanes)[0].kind, 'one');
});
