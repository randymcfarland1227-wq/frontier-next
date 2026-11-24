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
  /** Logged skipped / uncompleted / won't do today in TickTick: shown struck through. */
  off?: string;
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
      if (t.status === 'done' || isHabit(t) || !(t.scheduled || t.due)) continue;
      // A scheduled ("do on") day decides when it shows; otherwise its due date.
      const due = (t.scheduled || t.due)!.slice(0, 10);
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

/** Tasks scheduled for a later day are left out of the brief until that day. */
export function withoutLater(snaps: Record<SourceId, SourceSnapshot>, now = new Date()): Record<SourceId, SourceSnapshot> {
  const today = dayKey(now);
  const out = { ...snaps };
  for (const id of Object.keys(snaps) as SourceId[]) {
    const s = snaps[id];
    if (!s?.tasks?.some(t => t.scheduled && t.scheduled.slice(0, 10) > today)) continue;
    const later = new Set(s.tasks.filter(t => t.scheduled && t.scheduled.slice(0, 10) > today).map(t => t.id));
    out[id] = { ...s, tasks: s.tasks.filter(t => !later.has(t.id)), featured: (s.featured || []).filter(f => !later.has(f.id)) };
  }
  return out;
}

export function buildBrief(snapsIn: Record<SourceId, SourceSnapshot>, bills: BillDue[], now = new Date()): BriefSection[] {
  const expanded = Object.fromEntries(Object.entries(snapsIn).map(([id,snap]) => [id,{...snap,tasks:snap.tasks.flatMap(t=>t.shippingTasks || [t])}])) as Record<SourceId, SourceSnapshot>;
  const snaps = withoutLater(expanded, now);
  const mail = mailRows(snaps);
  const roles = [...mail.filter(r => r.category === 'roles'), ...roleRows(snaps.role)];
  const sales = [...mail.filter(r => r.category === 'sales'), ...saleRows(snaps.resale)];
  // Scheduled work already represented as mail, a reply or a sale gets one row.
  const represented = new Set([...mail, ...roles, ...sales].map(row => row.pin).filter(Boolean));
  return [
    { id: 'money', label: 'Money · overdue or due today', rows: money_(bills) },
    { id: 'tasks', label: 'Tasks · due today & overdue', rows: tasksDue(snaps, now).filter(row => !row.pin || !represented.has(row.pin)) },
    { id: 'mail', label: 'Mail needing you', rows: mail.filter(r => r.category === 'mail') },
    { id: 'roles', label: 'Roles · replies & next steps', rows: roles },
    { id: 'sales', label: 'Sold & selling · to do', rows: sales },
  ];
}

// ---------------------------------------------------------------------------
// Urgency buckets (2026-11-16, Randy's option B): Do today / This week / Focus next steps.
// ---------------------------------------------------------------------------

export type BucketTag = 'ship' | '$' | 'task' | 'reply' | 'appt' | 'focus' | 'mail';
export type BucketRow = {
  id: string;
  title: string;
  note?: string;
  tag: BucketTag;
  tone?: 'late' | 'today' | 'week';
  /** Action List keys this row sends (more than one → they go as one mix named after the row) */
  pins: string[];
  /** Title stored on a hub-only pin (calendar events have no site item) */
  pinTitle?: string;
  /** Brief row ids this row stands for (clear ✕ / new marks) */
  ids: string[];
  go?: SourceId | 'money';
  billKey?: string;
  openPin?: string;
  when?: string;
  focusTag?: string;
  amount?: number;
  off?: string;
  /** Grouped line: tap to unfold */
  children?: BucketRow[];
};
export type Bucket = { id: 'today' | 'week' | 'focus'; title: string; hint: string; rows: BucketRow[] };
export type BucketEvent = { id: string; title: string; start: Date; allDay?: boolean };
export type BucketFocus = { id: string; title: string; date?: string; eventId?: string };
export type FocusStep = { id: string; title: string; detail?: string };

const STOP = new Set('made sale sold your item items listing listings end ending depop ebay poshmark mercari please ship shipping order with from that this have the and for you was been just new size'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
const itemName = (s: string) => s.replace(/^.*?(?:you made (?:a|the) sale(?: for| of|:)?|you sold|end listing:?|sold:?)\s*/i, '').replace(/^[-:·\s"“]+|["”]+$/g, '').trim() || s;
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const names = (rows: BucketRow[], n = 3) => rows.slice(0, n).map(r => r.title.replace(/^Pay /, '')).join(', ') + (rows.length > n ? ` +${rows.length - n}` : '');
const sum = (rows: BucketRow[]) => rows.reduce((t, r) => t + (r.amount || 0), 0);

function group(id: string, label: string, tag: BucketTag, tone: BucketRow['tone'], rows: BucketRow[]): BucketRow[] {
  if (rows.length < 2) return rows;
  const total = sum(rows);
  return [{
    id, tag, tone, title: label, pinTitle: `${label} ${tag === '$' ? 'bills' : 'mail'}`.replace(' mail mail', ' mail'), note: [names(rows), total ? money(total) : ''].filter(Boolean).join(' · '),
    pins: rows.flatMap(r => r.pins), ids: rows.flatMap(r => r.ids), children: rows,
  }];
}

/** Buckets for the right column. `sections` are buildBrief's (already filtered for cleared rows). */
export function briefBuckets(sections: BriefSection[], bills: BillDue[], events: BucketEvent[], focusCards: BucketFocus[], steps: FocusStep[], now = new Date()): Bucket[] {
  const rows = (id: BriefSection['id']) => sections.find(s => s.id === id)?.rows || [];
  const live = new Set(rows('money').map(r => r.id));
  // Sales: a "you made the sale" email and its End Listing row become one Ship + end listing row.
  const sales = rows('sales');
  const ends = sales.filter(r => /end listing/i.test(`${r.title} ${r.note}`));
  const used = new Set<string>();
  const ship: BucketRow[] = [];
  for (const r of sales) {
    if (ends.includes(r)) continue;
    const w = words(itemName(r.title));
    // Same item = two shared words (one when the listing name only has one).
    const end = ends.find(e => { const ew = [...words(itemName(e.title))]; return !used.has(e.id) && ew.filter(x => w.has(x)).length >= Math.min(2, ew.length || 9); });
    if (end) used.add(end.id);
    const name = itemName(r.title);
    ship.push({ id: `ship:${r.id}`, tag: 'ship', tone: 'today', title: end ? `Ship ${name} + end listing` : `Ship ${name}`, note: [r.note, end?.note].filter(Boolean).join(' · '),
      pins: [r.pin, end?.pin].filter((k): k is string => Boolean(k)), ids: [r.id, ...(end ? [end.id] : [])], openPin: r.pin, go: r.go });
  }
  for (const e of ends) if (!used.has(e.id)) ship.push({ id: `ship:${e.id}`, tag: 'ship', tone: 'today', title: /end listing/i.test(e.title) ? e.title : `End listing: ${e.title}`, note: e.note, pins: e.pin ? [e.pin] : [], ids: [e.id], openPin: e.pin, go: e.go });
  // Bills: overdue and due today, one grouped line each.
  const billRow = (d: BillDue): BucketRow => ({ id: `bill:${d.key}`, tag: '$', tone: d.days < 0 ? 'late' : 'today', title: d.bill.name, amount: d.bill.amount || 0,
    note: [d.bill.amount ? money(d.bill.amount) : '', d.days < 0 ? `${-d.days}d overdue` : 'due today'].filter(Boolean).join(' · '),
    pins: [`radall:${d.key}`], ids: [`bill:${d.key}`], billKey: d.key, go: 'money' });
  const open = bills.filter(d => live.has(`bill:${d.key}`)).sort((a, b) => a.due.localeCompare(b.due));
  const late = open.filter(d => d.days < 0).map(billRow);
  const due = open.filter(d => d.days === 0).map(billRow);
  const tasks: BucketRow[] = rows('tasks').map(r => ({ id: r.id, tag: 'task', tone: 'today', title: r.title, note: r.note, pins: r.pin ? [r.pin] : [], ids: [r.id], openPin: r.pin, go: r.go, off: r.off }));
  const replies: BucketRow[] = rows('roles').map(r => ({ id: r.id, tag: 'reply', tone: 'today', title: r.title, note: r.note, pins: r.pin ? [r.pin] : [], ids: [r.id], openPin: r.pin, go: r.go }));
  // This week: events in the next 7 days; a "visit on 11/20" email folds into its appointment.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).getTime();
  const mail = [...rows('mail')];
  const week: BucketRow[] = events.filter(e => e.start.getTime() < end).map(e => {
    const day = md(e.start);
    const fold = mail.filter(m => /visit|appointment|appt|check.?in/i.test(m.title) && new RegExp(`\\b${day.replace('/', '\\/')}\\b`).test(`${m.title} ${m.note}`));
    for (const f of fold) mail.splice(mail.indexOf(f), 1);
    const card = focusCards.find(c => (c.eventId && c.eventId === e.id) || (c.date && c.date === `${e.start.getFullYear()}-${String(e.start.getMonth() + 1).padStart(2, '0')}-${String(e.start.getDate()).padStart(2, '0')}`));
    const t = e.allDay ? '' : e.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const n = Math.round((new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
    return { id: `ev:${e.id}`, tag: 'appt' as const, tone: 'week' as const, title: e.title,
      when: sameDay(e.start, now) ? 'Today' : n === 1 ? 'Tomorrow' : e.start.toLocaleDateString([], { weekday: 'short' }),
      note: [e.start.toLocaleDateString([], { month: 'short', day: 'numeric' }), t, ...fold.map(f => `✉ ${f.title}`)].filter(Boolean).join(' · '),
      focusTag: card?.title, pins: [`self:brief:ev:${e.id}`, ...fold.flatMap(f => f.pin ? [f.pin] : [])], pinTitle: `${e.title} · ${day}${t ? ` ${t}` : ''}`,
      ids: [`ev:${e.id}`, ...fold.map(f => f.id)] };
  });
  const other: BucketRow[] = mail.map(r => ({ id: r.id, tag: 'mail', title: r.title, note: r.note, pins: r.pin ? [r.pin] : [], ids: [r.id], openPin: r.pin, go: r.go }));
  // Focus next steps: the next open task of each short-term focus card.
  const seenCard = new Set<string>();
  const focus: BucketRow[] = [];
  for (const s of steps) {
    const card = s.id.split(':').slice(1, 3).join(':');
    if (seenCard.has(card)) continue;
    seenCard.add(card);
    focus.push({ id: `fstep:${s.id}`, tag: 'focus', title: s.title, note: s.detail, pins: [`self:${s.id}`], ids: [`fstep:${s.id}`], openPin: `self:${s.id}` });
  }
  return [
    { id: 'today', title: 'Do today', hint: 'Ship, pay, reply, do', rows: [...ship, ...group('g:late', `${late.length} overdue`, '$', 'late', late), ...group('g:due', `${due.length} due today`, '$', 'today', due), ...replies, ...tasks] },
    { id: 'week', title: 'This week', hint: 'Next 7 days', rows: [...week, ...group('g:mail', `${other.length} other mail`, 'mail', undefined, other)] },
    { id: 'focus', title: 'Focus next steps', hint: 'Next open task per focus card', rows: focus },
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

/** Remove Action List members before rendering a bucket, including partially pinned groups. */
export function withoutActionListRows(rows: BucketRow[], isOnList: (pin: string) => boolean): BucketRow[] {
  return rows.flatMap(row => {
    if (!row.children) return row.pins.length && row.pins.every(isOnList) ? [] : [row];
    const children = withoutActionListRows(row.children, isOnList);
    if (!children.length) return [];
    if (children.every((child, i) => child === row.children![i]) && children.length === row.children.length) return [row];
    const label = row.id === 'g:late' ? `${children.length} overdue` : row.id === 'g:due' ? `${children.length} due today` : row.title;
    return [{ ...row, title: label, children, amount: children.reduce((sum, child) => sum + (child.amount || 0), 0),
      pinTitle: `${label}${row.tag === '$' ? ' bills' : ''}`,
      note: [names(children), sum(children) ? money(sum(children)) : ''].filter(Boolean).join(' · '),
      pins: children.flatMap(child => child.pins), ids: children.flatMap(child => child.ids) }];
  });
}
