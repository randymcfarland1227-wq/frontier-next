import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cashDraws,cashProviderKey,cashProviders,logCashAdvance} from '../lib/cashAdvances';
import {findingDueKey,findingPaymentDues,loadFindings,removeFinding,setFinding} from '../lib/finFindings';
import {recordCompletion,reopenCompletion,loadLedger} from '../lib/completions';
import {mergeState} from '../lib/syncState';
import {crossOffEdit} from '../lib/money';
const memory=new Map<string,string>();
Object.assign(globalThis,{window:{dispatchEvent:()=>true},CustomEvent:class{constructor(public type:string){}},localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v)}});
const input={provider:'Dave',received:45,repay:48,due:'2026-10-01',takenOn:'2026-09-28'};

test('a separate advance becomes a cash repayment; payment clears the balance without deleting its source or history, and Undo reopens it',()=>{
 memory.clear();
 const key=logCashAdvance(input);
 const before=JSON.stringify(loadFindings());
 const draw=loadFindings()[key];
 const dueKey=findingDueKey(draw.payments![0]);
 const dues=findingPaymentDues(loadFindings(),new Set(),new Date('2026-11-24T12:00:00'));
 assert.equal(dues.length,1,'an unpaid one-off advance remains overdue beyond 45 days');
 assert.equal(dues[0].bill.kind,'cash');assert.equal(dues[0].bill.amount,48);assert.equal(dues[0].due,input.due);
 assert.equal(crossOffEdit(undefined),undefined,'Hub repayment has no sheet row to cross off');
 const ledger=recordCompletion('radall',dueKey,{title:'Paid Dave Advance Repay',via:'hub'});
 const paid=new Set(Object.values(ledger.entries).map(e=>e.taskId));
 assert.equal(findingPaymentDues(loadFindings(),paid).length,0);
 assert.equal(cashProviders(loadFindings()).find(p=>p.key===cashProviderKey('Dave'))?.removed,false);
 assert.equal(cashDraws(loadFindings(),cashProviderKey('Dave')).length,1);
 assert.equal(loadFindings()[key].cashAdvance?.received,45);
 assert.equal(JSON.stringify(loadFindings()),before,'paid status is derived from the existing ledger, never a second mutable flag');
 reopenCompletion('radall',dueKey);
 assert.equal(Object.keys(loadLedger().entries).length,0);
 assert.equal(findingPaymentDues(loadFindings(),new Set()).length,1);
});

test('custom sources persist, same-source same-day draws have separate payment identities, and archiving a source keeps history',()=>{
 memory.clear();
 logCashAdvance({...input,provider:'Rocco'});logCashAdvance({...input,provider:'rocco'});
 const store=loadFindings();
 const draws=cashDraws(store,cashProviderKey('Rocco'));
 assert.equal(draws.length,2);assert.notEqual(findingDueKey(draws[0].payments![0]),findingDueKey(draws[1].payments![0]));
 assert.equal(cashProviders(store).filter(p=>p.key===cashProviderKey('Rocco')).length,1);
 removeFinding(cashProviderKey('Rocco'));
 assert.equal(cashProviders(loadFindings()).find(p=>p.key===cashProviderKey('Rocco'))?.removed,true);
 assert.equal(cashDraws(loadFindings(),cashProviderKey('Rocco')).length,2);
 assert.equal(findingPaymentDues(loadFindings(),new Set()).length,2,'removing the source option never removes unpaid obligations');
 logCashAdvance({...input,provider:'Rocco'});
 assert.equal(cashProviders(loadFindings()).find(p=>p.key===cashProviderKey('Rocco'))?.removed,false);
 assert.equal(cashDraws(loadFindings(),cashProviderKey('Rocco')).length,3);
});

test('bad amounts or impossible dates do not create an account or repayment',()=>{
 memory.clear();
 for(const patch of [{repay:0},{repay:0.001},{received:NaN},{due:'2026-02-30'},{due:'2026-09-20'},{provider:'   '}]){
 assert.throws(()=>logCashAdvance({...input,...patch}));assert.deepEqual(loadFindings(),{});
 }
});

test('separate advances from different devices combine through the existing findings backup in either order',()=>{
 memory.clear();logCashAdvance(input);const a=loadFindings();
 memory.clear();logCashAdvance(input);const b=loadFindings();
 for(const [left,right] of [[a,b],[b,a]]){
 const merged=mergeState({findings:left},{findings:right});
 assert.equal(cashDraws(merged.findings as ReturnType<typeof loadFindings>,cashProviderKey('Dave')).length,2);
 }
});


test('the cash log does not change other findings payment categories or date windows',()=>{
 memory.clear();
 setFinding('own:ordinary-payment',{name:'Ordinary payment',payments:[{id:'ordinary',amount:20,due:'2026-10-01'}]});
 assert.equal(findingPaymentDues(loadFindings(),new Set(),new Date('2026-11-24T12:00:00')).length,0);
 const normal=findingPaymentDues(loadFindings(),new Set(),new Date('2026-10-01T12:00:00'));
 assert.equal(normal[0].bill.kind,'bill');assert.equal(normal[0].bill.amount,20);
});


test('existing provider spellings match one account rather than duplicating it',()=>{
 assert.equal(cashProviderKey('Earn In'),cashProviderKey('EarnIn'));
 assert.equal(cashProviderKey('Money Lion Advance Repay'),cashProviderKey('MoneyLion'));
});
