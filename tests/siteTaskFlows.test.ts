import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SourceId,SourceSnapshot} from '../lib/types';
import {emptySnapshots} from '../lib/sources';
import {siteListForTask,withShippingLists,applySiteLists,viewOfList} from '../lib/siteLists';
import {hideLedgerDone} from '../lib/completionSnapshots';
import {recordCompletion,reopenCompletion,loadLedger,restoreReopenedSnapshots,reopenTaskSnapshot} from '../lib/completions';
import {removeItem,isHidden,loadHidden} from '../lib/siteMoves';
import {buildCatalog} from '../app/components/PriorityBoard';
import {buildBrief} from '../lib/dailyBrief';
import {getActionableMetric} from '../lib/actionable';
import {createMix,autoShipMix,groupSteps,loadLanes} from '../lib/priorityPins';
const memory=new Map<string,string>();
Object.assign(globalThis,{window:{dispatchEvent:()=>true},CustomEvent:class{constructor(public type:string){}},localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v)}});
const task={id:'list:sample-hat',title:'List sample hat',status:'open'};
const snap=():Record<SourceId,SourceSnapshot>=>({...emptySnapshots(),resale:{...emptySnapshots().resale,tasks:[task],refreshedAt:new Date().toISOString()}});

test('Resale listing IDs are completable source tasks; only an actual Hub-owned list opens a list dialog',()=>{
 const store={'sl-example':{id:'sl-example',site:'resale' as const,name:'A real list',tasks:['x'],at:''}};
 assert.equal(siteListForTask(store,'resale',task.id),undefined);
 assert.equal(siteListForTask(store,'resale','list:sl-example')?.name,'A real list');
 assert.equal(siteListForTask(store,'self','list:sl-example'),undefined);
});

test('Resale local completion survives repeated open source refreshes and Undo still restores its own task',()=>{
 memory.clear();
 const ledger=recordCompletion('resale',task.id,{title:task.title,task,via:'hub'});
 for(let n=0;n<3;n++){
  const shown=hideLedgerDone(snap(),ledger);
  assert.equal(shown.resale.tasks[0].status,'done');
  assert.equal(getActionableMetric('resale',shown.resale).value,0);
 }
 reopenCompletion('resale',task.id);
 const done=hideLedgerDone(snap(),ledger);
 const restored=reopenTaskSnapshot(done.resale,task.id);
 assert.equal(restored.tasks[0].id,task.id);assert.equal(restored.tasks[0].status,'open');
 assert.equal(restoreReopenedSnapshots(hideLedgerDone(snap(),loadLedger())).resale.tasks[0].status,'open');
});

test('removing a Self task uses one shared hidden identity and never counts as completion',()=>{
 memory.clear();removeItem('self','sample-cords');
 assert.equal(isHidden(loadHidden(),'self','sample-cords'),true);
 assert.equal(isHidden(loadHidden(),'resale','self:sample-cords'),true);
 assert.equal(Object.keys(loadLedger().entries).length,0);
});

test('shipping groups count once, preserve source IDs and do not swallow Resale listing or other tasks',()=>{
 const snapshots=snap();
 snapshots.resale.tasks=[task,{id:'s1',title:'Sample package one',tag:'Ship',status:'open'},{id:'s2',title:'Sample package two',tag:'Ship',status:'open'}];
 const saved={};const store=withShippingLists(snapshots,saved);
 const grouped=applySiteLists(snapshots,store);
 assert.equal(getActionableMetric('resale',grouped.resale).value,2);
 assert.equal(grouped.resale.tasks.find(t=>t.title==='Ship Items')?.shippingTasks?.length,2);
 assert.deepEqual(viewOfList(store['shipping:resale'],snapshots).items.map(t=>t.id),['s1','s2']);
 assert.equal(grouped.resale.tasks.some(t=>t.id===task.id),true);
 assert.deepEqual(saved,{});assert.equal(snapshots.resale.tasks.length,3,'grouping never mutates source records');
 const partial={...snapshots,resale:{...snapshots.resale,tasks:snapshots.resale.tasks.map(t=>t.id==='s1'?{...t,status:'done'}:t)}};
 const one=applySiteLists(partial,withShippingLists(partial,{}));
 assert.equal(one.resale.tasks.find(t=>t.title==='Ship Items')?.shippingTasks?.length,1);
 assert.equal(getActionableMetric('resale',one.resale).value,2);
});

test('an existing shipping mix is one Action List step, not one count per shipment',()=>{
 memory.clear();const items=[{key:'self:s1'},{key:'resale:s2'}];
 createMix('Ship Items',items.map(i=>i.key));
 assert.equal(groupSteps(items,loadLanes()).length,1);
});


test('Resale shipment tags group product-title tasks into one Action List step',()=>{
 memory.clear();const items=[{key:'resale:s1',title:'Sample hat',tag:'Ship'},{key:'resale:s2',title:'Sample shoes',tag:'Ship'}];
 autoShipMix(items);
 const steps=groupSteps(items,loadLanes());
 assert.equal(steps.length,1);assert.equal(steps[0].kind,'mix');
 if(steps[0].kind==='mix')assert.equal(steps[0].name,'Ship Items');
});


test('shipping containers preserve Daily Brief source-item matching and manual lists',()=>{
 const snapshots=snap();snapshots.resale.tasks=[{id:'s1',title:'Sample shoes',tag:'Ship',status:'open'},{id:'s2',title:'Sample jeans',tag:'Ship',status:'open'}];
 const store=withShippingLists(snapshots,{});const grouped=applySiteLists(snapshots,store);
 assert.deepEqual(buildBrief(grouped,[]).find(s=>s.id==='sales'),buildBrief(snapshots,[]).find(s=>s.id==='sales'));
 const manual={'sl-manual':{id:'sl-manual',site:'resale' as const,name:'My list',tasks:['s1'],at:''}};
 assert.deepEqual(withShippingLists(snapshots,manual)['shipping:resale'].tasks,['s2']);
 const done={...snapshots,resale:{...snapshots.resale,tasks:snapshots.resale.tasks.map(t=>({...t,status:'done'}))}};
 assert.equal(withShippingLists(done,{})['shipping:resale'],undefined);
});


test('already pinned shipment members remain in the shared catalog after their source is grouped',()=>{
 const snapshots=snap();snapshots.resale.tasks=[{id:'s1',title:'Sample shoes',tag:'Ship',status:'open'},{id:'s2',title:'Sample jeans',tag:'Ship',status:'open'}];
 const grouped=applySiteLists(snapshots,withShippingLists(snapshots,{}));
 const catalog=buildCatalog(grouped);
 assert.equal(catalog.get('resale:s1')?.title,'Sample shoes');
 assert.equal(catalog.get('resale:s2')?.title,'Sample jeans');
 assert.equal(catalog.get('resale:list:shipping:resale')?.completable,false);
});
