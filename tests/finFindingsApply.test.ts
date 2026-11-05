import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFindings, owedOf, type DebtFile, type DebtItem } from '../lib/debtFile';
import type { FindingStore } from '../lib/finFindings';

const at = '2026-11-04T12:00:00Z';
const tk = (id: string, step: string, amount: number | null): DebtItem => ({ id, group: 'md', step, name: id, amount, status: 'open', timeline: [], ticket: { who: 'x', date: '2026-01-01', where: 'x', speed: 'x', flagged: 'MVA flag' } });
const file: DebtFile = {
  version: 1,
  asOf: '2026-11-01',
  letters: [],
  items: [
    tk('t-mdta', 'mdta', null),
    { ...tk('t-ccu', 'ccu', 140.4), plan: { state: 'ask', terms: 'CCU letter: ask' } },
    { id: 'md-tax', group: 'liability', name: 'MD tax', amount: 88.77, status: 'open', timeline: [], plan: { state: 'ask', terms: 'Call 410' } },
  ],
  registration: { due: '2027-01-31', vehicle: 'Car', steps: [{ id: 'ccu', title: 'CCU', amount: 304.2, where: 'x', plan: { state: 'ask', terms: 'Call CCU' } }] },
};
const findings: FindingStore = {
  'item:t-mdta': { key: 'item:t-mdta', amount: 45, at },
  'item:md-tax': { key: 'item:md-tax', plan: 'yes', monthly: 25, months: 4, contact: 'Comptroller', at },
  'src:ccu': { key: 'src:ccu', plan: 'yes', monthly: 50, at },
  'own:reg-renewal-fee': { key: 'own:reg-renewal-fee', name: 'Registration renewal fee', amount: 187, plan: 'unknown', at },
  'own:mva-flag-fees': { key: 'own:mva-flag-fees', name: 'MVA flag fees', amount: 390, at },
  'own:lawyer': { key: 'own:lawyer', name: 'Court fee', amount: 60, paid: true, at },
};

test('found amounts replace the debt file amount; plans logged on Life Hub replace the letters', () => {
  const out = applyFindings(file, {}, findings);
  const by = (id: string) => out.file!.items.find(i => i.id === id)!;
  assert.equal(by('t-mdta').amount, 45);
  assert.equal(by('md-tax').plan?.state, 'yes');
  assert.equal(by('md-tax').plan?.terms, '$25/mo × 4');
  assert.equal(by('md-tax').plan?.enroll, 'Comptroller');
  // A source plan shows on its tickets and on the registration step
  assert.equal(by('t-ccu').plan?.state, 'yes');
  assert.equal(by('t-ccu').plan?.terms, '$50/mo');
  assert.equal(out.file!.registration!.steps[0].plan?.state, 'yes');
  // The raw file is untouched
  assert.equal(file.items[0].amount, null);
});

test('hand-typed items: renewal fee joins the MD tickets, flag fees are not counted twice, paid ones drop out', () => {
  const out = applyFindings(file, {}, findings);
  const ids = out.file!.items.map(i => i.id);
  assert.ok(ids.includes('own:reg-renewal-fee'));
  assert.ok(!ids.includes('own:mva-flag-fees'));
  const fee = out.file!.items.find(i => i.id === 'own:reg-renewal-fee')!;
  assert.equal(fee.group, 'md');
  assert.equal(fee.step, 'renewal');
  assert.equal(out.marks['own:lawyer']?.status, 'paid');
  const md = out.file!.items.filter(i => i.group === 'md');
  assert.equal(owedOf(md, out.marks), 45 + 140.4 + 187);
  const liab = out.file!.items.filter(i => i.group === 'liability');
  assert.equal(owedOf(liab, out.marks), 88.77); // the paid court fee is out
});
