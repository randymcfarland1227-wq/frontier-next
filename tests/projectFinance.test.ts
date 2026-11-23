import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmedProjectBillPayment } from '../lib/projectFinance';
import type { CompletionEntry } from '../lib/completions';
const key='bill:sample:2026-11-23';
const paid: CompletionEntry={source:'radall',taskId:key,title:'Paid sample',completedAt:'2026-11-23T10:00:00Z',via:'hub'};
const ledger=(entry:CompletionEntry)=>({entries:{sample:entry}});
test('missing or partial finance data is not proof of payment',()=>{
 assert.equal(confirmedProjectBillPayment(key),false);
 assert.equal(confirmedProjectBillPayment(key,{entries:{}}),false);
});
test('only a real active completion for the exact due identity confirms paid',()=>{
 assert.equal(confirmedProjectBillPayment(key,ledger(paid)),true);
 assert.equal(confirmedProjectBillPayment(key,ledger({...paid,source:'self'})),false);
 assert.equal(confirmedProjectBillPayment(key,ledger({...paid,taskId:'bill:sample:2026-10-23'})),false);
 assert.equal(confirmedProjectBillPayment(key,ledger({...paid,reopenedAt:'2026-11-23T11:00:00Z'})),false);
 assert.equal(confirmedProjectBillPayment(key,ledger({...paid,via:'origin-snapshot'})),false);
});
