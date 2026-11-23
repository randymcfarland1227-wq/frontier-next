import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectContinuation, saveProjectContinuation } from '../lib/projectContinuation';
import type { Entry } from '../app/components/FocusSection';
const store = new Map<string,string>();
const target = new EventTarget();
Object.assign(globalThis, { window: { dispatchEvent: target.dispatchEvent.bind(target) }, localStorage: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key,value); },
}, CustomEvent: class extends Event { detail: unknown; constructor(type: string, options?: {detail:unknown}) { super(type); this.detail=options?.detail; } } });
const key = 'lifehub-focus-now2';
const original: Entry = { id:'old', title:'Financial centering', why:'Get centered', note:'Scope', at:'2026-11-18T12:00:00Z', site:'self',
  refs:[{id:'ref',kind:'link',title:'Reference',url:'https://example.com',at:''}],
  lists:[{id:'orders',name:'Orders',tasks:[{id:'done',text:'Groceries',done:true}]},{id:'bills',name:'Bills',kind:'pay',tasks:[{id:'bill',text:'Toyota',done:false,fin:{key:'bill:toyota',label:'Toyota'},after:'done'}]}] };

test('rollover archives the original and appends one linked successor, preserving context and unpaid work', () => {
  store.clear();
  store.set(key, JSON.stringify({scope:'existing',items:[original,{id:'other',title:'Other'}]}));
  const next=projectContinuation(original,'Next centering',{lists:[original.lists![1]],fin:[],siteTasks:[],siteLists:[]},new Date(2026,10,23));
  assert.notEqual(next.id,original.id);
  assert.deepEqual(next.refs,original.refs);
  assert.equal(next.why,original.why);
  assert.equal(next.lists![0].tasks[0].fin!.key,'bill:toyota');
  assert.equal(next.lists![0].tasks[0].done,false);
  assert.equal(next.lists![0].tasks[0].after,undefined);
  assert.equal(next.added,'2026-11-23');
  const id=saveProjectContinuation(original,next);
  const saved=JSON.parse(store.get(key)!);
  assert.equal(saved.scope,'existing');
  assert.equal(saved.items[0].done,true);
  assert.equal(saved.items[0].continuedAs,id);
  assert.deepEqual(saved.items[0].lists,original.lists, 'archive retains the original work history');
  assert.deepEqual(saved.items[1],{id:'other',title:'Other'});
  assert.equal(saved.items[2].continuedFrom,original.id);
  assert.equal(saveProjectContinuation(original,projectContinuation(original,'Retry',{})),id,'retry cannot create two successors');
  assert.equal(JSON.parse(store.get(key)!).items.length,3);
});

test('rollover refuses stale or unavailable projects and preserves array-backed records', () => {
  const next=projectContinuation(original,'Next',{lists:[]});
  store.clear();
  store.set(key,JSON.stringify({scope:'',items:[{...original,at:'newer'}]}));
  assert.throws(()=>saveProjectContinuation(original,next),/changed/);
  assert.equal(JSON.parse(store.get(key)!).items.length,1);
  store.clear();
  assert.throws(()=>saveProjectContinuation(original,next),/not be found/);
  store.set('lifehub-focus-fit-areas',JSON.stringify([original]));
  saveProjectContinuation(original,next);
  assert.equal(JSON.parse(store.get('lifehub-focus-fit-areas')!).length,2);
});

test('a failed save leaves the original project intact', () => {
  store.clear();
  const saved = JSON.stringify({scope:'',items:[original]});
  store.set(key,saved);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('Storage is full'); };
  try {
    assert.throws(() => saveProjectContinuation(original,projectContinuation(original,'Next',{})),/Storage is full/);
    assert.equal(store.get(key),saved);
  } finally {
    localStorage.setItem = setItem;
  }
});
