/**
 * Debt file — every credit collection, liability and ticket as its own entity with a story
 * (which reports it's on, who owned it, offers, every letter/email). The file is private: it lives
 * in Worker KV (`/api/debts`, same backup key as Money) and is never committed to this public repo.
 * Randy's marks (paid / disputed / gone + a note) save back to the Worker so every device sees them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { syncKeyHeader } from './cloudSync';
import { findingOf, ownItems, scheduleNow, setFinding, useFindings, type Finding, type FindingStore } from './finFindings';
import { readSaved, writeSaved } from './storage';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

const CACHE_KEY = 'lifehub-debt-cache';

export type DebtGroup = 'credit' | 'behind' | 'liability' | 'md' | 'wv' | 'oos';
export type Bureau = 'EX' | 'EQ' | 'TU';

export type DebtEvent = { date: string; kind: 'letter' | 'email' | 'report' | 'notice' | 'event'; text: string };

/** 'yes' = a plan is documented, 'ask' = the letter invites arrangements but prints no terms, 'none' = pay in full */
export type DebtPlan = { state: 'yes' | 'ask' | 'none'; terms: string; enroll?: string | null; source?: string | null };

export type DebtItem = {
  id: string;
  group: DebtGroup;
  name: string;
  sub?: string;
  /** What's owed now; null when unknown (needs research) */
  amount: number | null;
  /** Extra that may apply on top (flag fees, late penalties) */
  maybe?: number;
  status: string;
  /** Might not be Randy's debt at all — shown, but left out of the totals */
  unverified?: boolean;
  blocksRegistration?: boolean;
  reports?: Partial<Record<Bureau, string | null>>;
  owners?: Array<{ role: string; name: string; from?: string; note?: string }>;
  offers?: Array<{ date: string; who: string; text: string; expires?: string; active: boolean }>;
  ticket?: { who: string; date: string; where: string; speed: string; pin?: string; flagged?: string };
  /** Credit accounts: when it started and when it drops off the reports ('est' = inferred, 'latest' = outer bound from the placement date) */
  dates?: { opened?: string; openedLabel?: string; dofd?: string; fallsOff?: string; basis: 'dofd' | 'est' | 'latest'; note?: string };
  /** Lowest offer actually seen */
  settle?: { lowest?: number | null; who?: string; date?: string; note?: string };
  plan?: DebtPlan;
  /** Which Maryland registration step this item belongs to */
  step?: string;
  /** Combination letters (MVA invoices, CCU) this item appears in */
  letters?: string[];
  timeline: DebtEvent[];
  facts?: string[];
  pay?: string;
  next?: string;
  /** Pay-by date for what's owed now (hand-typed items with a schedule) */
  due?: string;
};

export type PayLaterSeen = { id: string; provider: string; merchant: string; amount: number | null; date: string; state: 'paid' | 'late' | 'upcoming'; note?: string };

export type DebtLetter = { id: string; date: string; from: string; title: string; total: number; count: number; note?: string; plan?: DebtPlan };

export type RegStep = { id: string; title: string; amount: number | null; maybe?: number; where: string; note?: string; plan?: DebtPlan };

export type DebtFile = {
  version: number;
  asOf: string;
  sources?: string;
  scores?: Array<{ bureau: string; date: string; score: number }>;
  /** Pay-later payments the Gmail sweep saw (Klarna, Afterpay, Zip, Affirm) */
  paylater?: PayLaterSeen[];
  /** Pay-by (cut-off) dates found in Gmail notices; fill in where a bill has none */
  payby?: Array<{ match: string; kinds?: string[]; date: string; why: string }>;
  registration?: { due: string; vehicle: string; steps: RegStep[] };
  letters: DebtLetter[];
  items: DebtItem[];
};

export type MarkStatus = 'paid' | 'disputed' | 'gone' | 'plan';
export type DebtMark = { status: MarkStatus; note?: string; at?: string };
export type DebtMarks = Record<string, DebtMark>;

type Cached = { file: DebtFile | null; marks: DebtMarks };

function validFile(f: unknown): f is DebtFile {
  const x = f as DebtFile | null;
  return Boolean(x && Array.isArray(x.items) && Array.isArray(x.letters) && typeof x.asOf === 'string');
}

/** Paid and gone items stop counting toward what's owed. */
export function isSettled(mark?: DebtMark): boolean {
  return mark?.status === 'paid' || mark?.status === 'gone';
}

export function owedOf(items: DebtItem[], marks: DebtMarks): number {
  return items.filter(i => !i.unverified && !isSettled(marks[i.id])).reduce((s, i) => s + (i.amount || 0), 0);
}

/** Hand-typed items already counted elsewhere in Finance (the 13 × $30 MVA flag fees = the flag fee on each flagged MD ticket). */
export const OWN_COUNTED_ELSEWHERE = new Set(['own:mva-flag-fees']);
/** Hand-typed items that belong with the MD tickets (they have to be paid before the registration renews). */
export const OWN_REGISTRATION = new Set(['own:reg-renewal-fee']);
export const RENEWAL_STEP = 'renewal';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });

/** A plan logged on Life Hub, in the debt file's own shape (only when a real state was picked). */
function planFrom(f: Finding | undefined, prev?: DebtPlan): DebtPlan | undefined {
  if (!f?.plan || f.plan === 'unknown') return undefined;
  const parts: string[] = [];
  if (f.monthly) parts.push(`${money(f.monthly)}/mo${f.months ? ` × ${f.months}` : ''}`);
  else if (f.months) parts.push(`${f.months} months`);
  if (f.down) parts.push(`${money(f.down)} down`);
  if (f.terms) parts.push(f.terms);
  if (f.note) parts.push(f.note);
  return {
    state: f.plan,
    terms: parts.join(' · ') || (f.plan === prev?.state ? prev.terms : '') || '',
    enroll: f.contact || prev?.enroll || null,
    source: `Logged on Life Hub${f.checked ? ` ${f.checked}` : ''}`,
  };
}

/**
 * What Randy found on Life Hub (lib/finFindings) laid over the debt file, so every Finance total and story uses it:
 *  - `item:<id>` amount / plan replace the item's,
 *  - `src:<step>` plan replaces the registration step's and that source's tickets' (unless a ticket has its own logged),
 *  - `own:` hand-typed items become items (registration fee → with the MD tickets, others → Taxes / Legal);
 *    paid ones are marked paid, ones already counted elsewhere (MVA flag fees) are left out.
 */
export function applyFindings(file: DebtFile | null, marks: DebtMarks, findings: FindingStore): { file: DebtFile | null; marks: DebtMarks } {
  if (!file) return { file, marks };
  const srcPlan = (step: string | undefined, prev?: DebtPlan) => (step ? planFrom(findingOf(findings, `src:${step}`), prev) : undefined);
  const items: DebtItem[] = file.items.map(i => {
    const f = findingOf(findings, `item:${i.id}`);
    // Logged on the ticket itself, else logged for its source (CCU, MDTA…), else what the letters say.
    const plan = planFrom(f, i.plan) || (i.group === 'md' ? srcPlan(i.step, i.plan) : undefined);
    const amount = f && f.amount !== undefined ? f.amount : i.amount;
    return plan || amount !== i.amount ? { ...i, amount, ...(plan ? { plan } : {}) } : i;
  });
  const nextMarks: DebtMarks = { ...marks };
  for (const o of ownItems(findings)) {
    if (OWN_COUNTED_ELSEWHERE.has(o.key)) continue;
    const reg = OWN_REGISTRATION.has(o.key);
    const step = o.schedule?.length ? scheduleNow(o.schedule) : undefined;
    items.push({
      id: o.key,
      group: reg ? 'md' : 'liability',
      ...(reg ? { step: RENEWAL_STEP, blocksRegistration: true } : {}),
      name: o.name || 'Money item',
      amount: step ? step.amount : (o.amount ?? null),
      ...(step ? { due: step.by } : {}),
      status: o.paid ? 'paid' : o.note || 'open',
      plan: planFrom(o),
      ...(o.contact ? { pay: o.contact } : {}),
      timeline: [],
      facts: step
        ? ['Added on Life Hub from the county tax record.', ...o.schedule!.map(x => `${money(x.amount)} if paid by ${x.by}`)]
        : ['Typed in on Life Hub (focus card).'],
    });
    if (o.paid) nextMarks[o.key] = { status: 'paid', at: o.at };
    else delete nextMarks[o.key];
  }
  const steps = file.registration?.steps.map(st => {
    const plan = planFrom(findingOf(findings, `src:${st.id}`), st.plan);
    return plan ? { ...st, plan } : st;
  });
  return {
    file: { ...file, items, ...(file.registration && steps ? { registration: { ...file.registration, steps } } : {}) },
    marks: nextMarks,
  };
}

export function useDebtFile() {
  const [state, setState] = useState<Cached>(() => readSaved<Cached>(CACHE_KEY, { file: null, marks: {} }));
  const [status, setStatus] = useState<'loading' | 'ok' | 'locked' | 'empty' | 'offline'>('loading');

  const pull = useCallback(async () => {
    try {
      const res = await fetch(`${WORKER_BASE}/api/debts`, { headers: syncKeyHeader(), cache: 'no-store' });
      if (res.status === 401) return setStatus('locked');
      if (!res.ok) return setStatus('offline');
      const body = (await res.json()) as { file?: unknown; marks?: DebtMarks };
      const next: Cached = { file: validFile(body.file) ? body.file : null, marks: body.marks || {} };
      writeSaved(CACHE_KEY, next);
      setState(next);
      setStatus(next.file ? 'ok' : 'empty');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    // pull() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void pull();
  }, [pull]);

  const setMark = useCallback(async (id: string, mark: DebtMark | null) => {
    // Optimistic: show it now, then take the Worker's copy.
    setState(s => {
      const marks = { ...s.marks };
      if (mark) marks[id] = mark;
      else delete marks[id];
      const next = { ...s, marks };
      writeSaved(CACHE_KEY, next);
      return next;
    });
    try {
      const res = await fetch(`${WORKER_BASE}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
        body: JSON.stringify({ id, mark }),
      });
      const body = (await res.json()) as { ok?: boolean; marks?: DebtMarks };
      if (body.ok && body.marks) {
        setState(s => {
          const next = { ...s, marks: body.marks as DebtMarks };
          writeSaved(CACHE_KEY, next);
          return next;
        });
        return true;
      }
    } catch {
      /* stays local until the next pull */
    }
    return false;
  }, []);

  const findings = useFindings();
  const shown = useMemo(() => applyFindings(state.file, state.marks, findings), [state, findings]);
  // A hand-typed (own:) item's paid state lives with the findings, not in the Worker's marks.
  const mark = useCallback(
    async (id: string, m: DebtMark | null) => {
      if (!id.startsWith('own:')) return setMark(id, m);
      setFinding(id, { paid: m?.status === 'paid' || m?.status === 'gone' });
      return true;
    },
    [setMark],
  );

  /** file / marks have Life Hub findings applied; raw / rawMarks are the Worker's copy. */
  return { file: shown.file, marks: shown.marks, raw: state.file, rawMarks: state.marks, status, refresh: pull, setMark: mark };
}
