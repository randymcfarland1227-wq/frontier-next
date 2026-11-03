/**
 * Daily brief: what needs you today, gathered from the snapshots Life Hub already holds.
 * Pure functions so the Home section and anything else (a routine's report) read the same list.
 */

import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { isOverdue } from './billEdits';
import { dayKey, money, type BillDue } from './schedule';
import { sourceById } from './sources';

export type BriefRow = {
  /** Stable id (for "new since you last looked") */
  id: string;
  title: string;
  note: string;
  tone?: 'late' | 'today';
  /** Where a tap goes: a site's page, or the Money page */
  go: SourceId | 'money';
  /** Pin key, when the row is a task the side panel can open */
  pin?: string;
};
export type BriefSection = { id: 'money' | 'tasks' | 'mail' | 'roles' | 'sales'; label: string; rows: BriefRow[] };

const isHabit = (t: TaskItem) => t.kind === 'habit' || t.id.startsWith('habit-');
const DAY = 86400000;

function money_(bills: BillDue[]): BriefRow[] {
  return bills
    .filter(d => !d.skipped && d.bill.kind !== 'plan' && (isOverdue(d) || d.days === 0))
    .sort((a, b) => a.due.localeCompare(b.due))
    .map(d => ({
      id: `bill:${d.key}`,
      title: d.bill.name,
      note: `${d.bill.amount ? `${money(d.bill.amount)} · ` : ''}${d.days < 0 ? `${-d.days}d overdue` : 'due today'}`,
      tone: d.days < 0 ? ('late' as const) : ('today' as const),
      go: 'money' as const,
    }));
}

function tasksDue(snaps: Record<SourceId, SourceSnapshot>, now: Date): BriefRow[] {
  const today = dayKey(now);
  const rows: BriefRow[] = [];
  for (const id of Object.keys(snaps) as SourceId[]) {
    for (const t of snaps[id]?.tasks || []) {
      if (t.status === 'done' || isHabit(t) || !t.due) continue;
      const due = t.due.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due > today) continue;
      const late = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) / DAY);
      rows.push({
        id: `task:${id}:${t.id}`,
        title: t.title,
        note: `${sourceById[id]?.shortName || id} · ${late > 0 ? `${late}d overdue` : 'today'}`,
        tone: late > 0 ? 'late' : 'today',
        go: id,
        pin: `${id}:${t.id}`,
      });
    }
  }
  return rows.sort((a, b) => Number(b.tone === 'late') - Number(a.tone === 'late'));
}

/** Explicit agent labels win; uncertain mail remains visible instead of being dropped. */
export function mailCategory(item: { title: string; detail?: string; tag?: string; briefKind?: 'reply' | 'shipping' | 'mail' }): 'mail' | 'roles' | 'sales' {
  if (item.briefKind) return item.briefKind === 'reply' ? 'roles' : item.briefKind === 'shipping' ? 'sales' : 'mail';
  const text = `${item.tag || ''} ${item.title} ${item.detail || ''}`;
  const shipping = /you (?:made (?:a|the) sale|sold)|please ship|ship (?:it|this|your|by|out)|ready to ship|shipping label|awaiting shipment|needs? shipping|pack (?:it|and)|^ship\b/i;
  const fulfilled = /has (?:been )?shipped|was shipped|has been delivered|order (?:shipped|delivered)|shipment delivered/i;
  if (shipping.test(text) && !fulfilled.test(text)) return 'sales';
  const role = /recruit|interview|hiring|job offer|role inquir|job opportunit|phone screen|assessment|availability|respond|reply required/i;
  const noReply = /unfortunately|not (?:moving|selected)|rejection|application (?:received|submitted)|thank you for applying/i;
  return role.test(text) && !noReply.test(text) ? 'roles' : 'mail';
}

function mailRows(snaps: Record<SourceId, SourceSnapshot>): Array<BriefRow & { category: 'mail' | 'roles' | 'sales' }> {
  const rows: Array<BriefRow & { category: 'mail' | 'roles' | 'sales' }> = [];
  for (const id of ['gmail', 'outlook'] as const) {
    const snap = snaps[id];
    const completed = new Set((snap?.tasks || []).filter(t => t.status === 'done').map(t => t.id));
    const items = new Map<string, { id: string; title: string; detail?: string; meta?: string; tag?: string; briefKind?: 'reply' | 'shipping' | 'mail' }>();
    for (const f of snap?.featured || []) if (!completed.has(f.id)) items.set(f.id, f);
    for (const t of snap?.tasks || []) if (t.status !== 'done') items.set(t.id, { ...items.get(t.id), ...t });
    for (const f of items.values()) rows.push({
      id: `mail:${id}:${f.id}`, title: f.title,
      note: [sourceById[id].shortName, f.tag || f.meta].filter(Boolean).join(' · '),
      go: id, pin: `${id}:${f.id}`, category: mailCategory(f),
    });
  }
  return rows;
}

const RESPONSE = /repl|respon|interview|recruit|offer|assess|screen|schedule/i;
function roleRows(snap?: SourceSnapshot): BriefRow[] {
  if (!snap) return [];
  const rows = new Map<string, BriefRow>();
  const completed = new Set(snap.tasks.filter(t => t.status === 'done').map(t => t.id));
  for (const f of snap.featured) {
    if (!completed.has(f.id) && RESPONSE.test(`${f.tag || ''} ${f.title}`)) rows.set(f.id, { id: `role:f:${f.id}`, title: f.title, note: f.meta || f.detail, go: 'role', pin: `role:${f.id}` });
  }
  for (const t of snap.tasks) {
    if (t.status === 'done' || rows.has(t.id)) continue;
    if (RESPONSE.test(`${t.tag || ''} ${t.title}`)) rows.set(t.id, { id: `role:t:${t.id}`, title: t.title, note: t.tag || 'Role Hub', go: 'role', pin: `role:${t.id}` });
  }
  return [...rows.values()];
}

function saleRows(snap?: SourceSnapshot): BriefRow[] {
  if (!snap) return [];
  return snap.tasks
    .filter(t => t.status !== 'done' && /ship|sold|offer|end listing/i.test(`${t.tag || ''} ${t.title}`))
    .map(t => ({ id: `sale:${t.id}`, title: t.title, note: t.tag || 'Resale', go: 'resale' as const, pin: `resale:${t.id}` }));
}

export function buildBrief(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[], now = new Date()): BriefSection[] {
  const mail = mailRows(snaps);
  return [
    { id: 'money', label: 'Money · overdue or due today', rows: money_(bills) },
    { id: 'tasks', label: 'Tasks · due today & overdue', rows: tasksDue(snaps, now) },
    { id: 'mail', label: 'Mail needing you', rows: mail.filter(r => r.category === 'mail') },
    { id: 'roles', label: 'Roles · replies & next steps', rows: [...mail.filter(r => r.category === 'roles'), ...roleRows(snaps.role)] },
    { id: 'sales', label: 'Sold & selling · to do', rows: [...mail.filter(r => r.category === 'sales'), ...saleRows(snaps.resale)] },
  ];
}

// ---------------------------------------------------------------------------
// Morning digest feed: Home pushes this to the Worker (PUT /api/brief) so Queen Bee's routine can read it.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { syncKeyHeader } from './cloudSync';
import { incomingDues, useIncoming } from './incoming';
import { loadCachedMoney, parseMoney } from './money';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export function briefPayload(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[], paydays: { source: string; due: string; amount?: number }[], cashAvailable: string | null, now = new Date()) {
  const open = bills.filter(d => !d.skipped && d.bill.kind !== 'plan');
  const line = (d: BillDue) => ({ name: d.bill.name, amount: d.bill.amount ?? null, dueDate: d.due });
  const sections = buildBrief(snaps, bills, now);
  const rows = (id: BriefSection['id']) => sections.find(s => s.id === id)?.rows || [];
  return {
    generatedAt: now.toISOString(),
    dueToday: open.filter(d => d.days === 0).map(line),
    overdue: open.filter(isOverdue).map(line),
    cashAvailable,
    nextPayday: paydays[0] ? { source: paydays[0].source, date: paydays[0].due, amount: paydays[0].amount ?? null } : null,
    tasksDueToday: rows('tasks').map(r => ({ title: r.title, note: r.note, link: `https://randymcfarland1227-wq.github.io/frontier/` })),
    mail: rows('mail').map(r => ({ title: r.title, note: r.note })),
    roles: rows('roles').map(r => ({ title: r.title, note: r.note })),
    soldItems: rows('sales').map(r => ({ title: r.title, note: r.note })),
  };
}

/** Pushes the brief when it changes (and at most every 5 minutes). Quiet when backup is off or offline. */
export function useBriefPush(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[]) {
  const incoming = useIncoming();
  const last = useRef({ sig: '', at: 0 });
  useEffect(() => {
    const t = window.setTimeout(() => {
      const headers = syncKeyHeader();
      if (!headers['X-Sync-Key']) return;
      let cash: string | null = null;
      try {
        const snap = loadCachedMoney();
        cash = (snap && parseMoney(snap).cashOnHand?.text) || null;
      } catch {
        cash = null;
      }
      const paydays = incomingDues(incoming, new Date(), 0, 30).filter(d => (d.item.amount || 0) > 0).map(d => ({ source: d.item.source, due: d.due, amount: d.item.amount }));
      const body = briefPayload(snaps, bills, paydays, cash);
      const sig = JSON.stringify({ ...body, generatedAt: '' });
      if (sig === last.current.sig && Date.now() - last.current.at < 30 * 60 * 1000) return;
      if (Date.now() - last.current.at < 5 * 60 * 1000) return;
      last.current = { sig, at: Date.now() };
      void fetch(`${WORKER_BASE}/api/brief`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [snaps, bills, incoming]);
}
