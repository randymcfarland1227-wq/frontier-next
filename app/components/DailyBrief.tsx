'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildBrief, type BriefSection } from '../../lib/dailyBrief';
import { REFRESH_EVENT } from '../../lib/syncNow';
import { doneInMix, endMix, groupSteps, openTaskPanel, requestOpenMix, unpin } from '../../lib/priorityPins';
import { useFeaturedLevels } from '../../lib/featuredLevels';
import { openMoneyDue } from './MoneyPage';
import type { PriorityItem } from './PriorityPanel';
import { LOCAL_WRITE_EVENT, readSaved, writeSaved } from '../../lib/storage';
import { eventEnd, eventStart, type BillDue, type ScheduleSnapshot } from '../../lib/schedule';
import { usePlan } from './FocusDrawer';
import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { Circle, Dot, Group, ListHead } from '../sticker/kit';
import { Icon } from '../sticker/Icon';
import { useDayKey } from '../../lib/dayKey';
import { FOCUS_PRIORITY_LABEL, type FocusPriority } from '../../lib/focusPriority';
import { FocusEntryDialog, type LinkItem, type OpenFinance } from './FocusCards';
import type { Entry, useShortTermFocus } from './FocusSection';
import { sourceById } from '../../lib/sources';
import { focusCollections } from '../../lib/focusRouting';

const SEEN_KEY = 'lifehub-brief-seen';
const DISMISS_KEY = 'lifehub-brief-dismissed';
const DISMISS_EVENT = 'lifehub-brief-dismissed-changed';
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
/** Items Randy cleared from today's brief: id → the day it was cleared. They return on a later day. */
function readDismissed(): Record<string, string> {
  const all = readSaved<Record<string, string>>(DISMISS_KEY, {});
  const day = todayKey();
  return Object.fromEntries(Object.entries(all).filter(([, d]) => d === day));
}
function useDismissed() {
  const [map, setMap] = useState(readDismissed);
  useEffect(() => {
    const sync = () => setMap(readDismissed());
    window.addEventListener(DISMISS_EVENT, sync);
    const t = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(DISMISS_EVENT, sync);
      window.clearInterval(t);
    };
  }, []);
  return map;
}
function dismissIds(ids: string[]) {
  const next = { ...readDismissed() };
  for (const id of ids) next[id] = todayKey();
  writeSaved(DISMISS_KEY, next);
  window.dispatchEvent(new Event(DISMISS_EVENT));
}
function restoreAll() {
  writeSaved(DISMISS_KEY, {});
  window.dispatchEvent(new Event(DISMISS_EVENT));
}
const FOLDS_KEY = 'sk-fold-brief-sections';

/** Column names (Title Case) for the brief's sections. */
const HEADS: Record<BriefSection['id'], string> = {
  money: 'Finance · due & overdue',
  tasks: 'Tasks due today',
  mail: 'Other Mail',
  roles: 'Replies & Role Inquiries',
  sales: 'Shipping & Sales',
};
const SHORT: Record<BriefSection['id'], [string, string]> = {
  money: ['bill due', 'bills due'],
  tasks: ['task due', 'tasks due'],
  mail: ['mail', 'mail'],
  roles: ['role reply', 'role replies'],
  sales: ['sale to do', 'sales to do'],
};

/** Live source sections; date-sensitive rows refresh when the day changes. */
export function useBrief(snapshots: Record<SourceId, SourceSnapshot>, bills: BillDue[]) {
  const gone = useDismissed();
  const day = useDayKey();
  return useMemo(
    () =>
      buildBrief(snapshots, bills, new Date(`${day}T12:00:00`))
        .map(s => ({ ...s, rows: s.rows.filter(r => !gone[r.id] && (s.id !== 'tasks' || r.tone === 'today')) })),
    [snapshots, bills, gone, day],
  );
}

/** "2 mail · 1 role reply · 1 bill due" — only sections that have something. */
export function briefParts(sections: BriefSection[]) {
  return sections.filter(s => s.rows.length).map(s => `${s.rows.length} ${SHORT[s.id][s.rows.length === 1 ? 0 : 1]}`);
}

/** The one-line summary on the Today section head. */
export function BriefSummary({ snapshots, bills }: { snapshots: Record<SourceId, SourceSnapshot>; bills: BillDue[] }) {
  const parts = briefParts(useBrief(snapshots, bills));
  return <>{parts.length ? parts.join(' · ') : 'All clear: nothing waiting on you'}</>;
}

const WEEKS_AHEAD = 3;
/** "Today" / "Tomorrow" / "in 5 days" for an upcoming date. */
const whenLabel = (d: Date) => {
  const t = new Date();
  const n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
  return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
};
type BRow = { id: string; title: string; note: string; tone?: string; pin?: string; go?: SpaceId; mix?: string; focusId?: string; priority?: FocusPriority; marker?: string; when?: string; finish?: () => void };
type BCol = { id: string; title: string; rows: BRow[]; compact?: boolean; keepAll?: boolean; empty: string };

export function DailyBrief({ snapshots, bills, schedule, enter, focus, events, openFinance, complete }: {
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  schedule: ScheduleSnapshot | null;
  enter: (id: SpaceId) => void;
  focus: ReturnType<typeof useShortTermFocus>;
  events: LinkItem[];
  openFinance: OpenFinance;
  /** Mark an Action List item done (same as its circle in Doing Now). */
  complete?: (source: SourceId, item: PriorityItem) => void;
}) {
  const sections = useBrief(snapshots, bills);
  const gone = useDismissed();
  const { plan, lanes } = usePlan(snapshots, bills);
  const { isCritical, toggleCritical } = useFeaturedLevels();
  // Same as the circle in Doing Now: done on its site, off the list; a mix member stays struck through in its mix.
  const finishPlan = (item: PriorityItem) => {
    if (!complete) return;
    complete(item.source, item);
    unpin(item.key);
    if (isCritical(item.source, item.id)) toggleCritical(item.source, item.id);
    const mix = lanes[item.key]?.mix;
    if (!mix) return;
    const left = plan.filter(i => lanes[i.key]?.mix === mix).length;
    if (left <= 1) endMix(mix);
    else doneInMix(item.key, item.title);
  };
  const hidden = Object.keys(gone).length;
  const [folds, setFolds] = useState<Record<string, boolean>>(() => readSaved(FOLDS_KEY, {}));
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const sync = (e: Event) => {
      if ((e as CustomEvent).detail === FOLDS_KEY || e.type === 'storage') setFolds(readSaved(FOLDS_KEY, {}));
    };
    window.addEventListener(LOCAL_WRITE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(LOCAL_WRITE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const toggle = (id: string) => {
    const next = { ...readSaved<Record<string, boolean>>(FOLDS_KEY, {}), [id]: !folds[id] };
    writeSaved(FOLDS_KEY, next);
    setFolds(next);
  };
  const [openFocusId, setOpenFocusId] = useState<string | null>(null);
  const focusLists = focusCollections(focus).map(c => c.list);
  const selectedList = focusLists.find(([items]) => items.some(i => i.id === openFocusId));
  const selected = selectedList?.[0].find(i => i.id === openFocusId);
  const updateFocus = (patch: Partial<Entry>) => {
    if (selectedList && selected) selectedList[1](selectedList[0].map(i => i.id === selected.id ? { ...i, ...patch } : i));
  };
  const stamp = Math.max(0, ...(['gmail', 'outlook', 'role', 'radall', 'resale', 'ticktick'] as SourceId[]).map(id => Date.parse(snapshots[id]?.refreshedAt || '') || 0));
  const updated = stamp ? `${new Date(stamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${new Date(stamp).toDateString() === new Date().toDateString() ? '' : ` · ${new Date(stamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}` : null;
  const [seen, setSeen] = useState<string[]>(() => readSaved<string[]>(SEEN_KEY, []));
  const soon = (schedule?.events || [])
    .filter(e => (e.myStatus === 'owner' || e.myStatus === 'yes') && eventEnd(e).getTime() > nowMs && eventStart(e).getTime() < nowMs + WEEKS_AHEAD * 7 * 86400000)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const cols: BCol[] = [
    { id: 'doing', title: 'Action List', keepAll: true, empty: 'Nothing selected in your Action List yet.', rows: groupSteps(plan, lanes).map((st): BRow => st.kind === 'one'
      ? { id: `plan:${st.item.key}`, title: st.item.title, note: sourceById[st.item.source].shortName, pin: st.item.key, finish: complete ? () => finishPlan(st.item) : undefined }
      : { id: `mix:${st.id}`, title: st.name, mix: st.id, note: [st.done.length ? `${st.done.length} of ${st.items.length + st.done.length} done` : `${st.items.length} items`, [...new Set(st.items.map(i => sourceById[i.source].shortName))].join(' · ')].join(' · ') }) },
    { id: 'mail', title: 'Mail', empty: 'Nothing waiting in the current feed.', rows: (['roles', 'sales', 'mail'] as const).flatMap(id => (sections.find(s => s.id === id)?.rows || []).map(r => ({ ...r, marker: id === 'roles' ? 'Role reply' : id === 'sales' ? 'Sales / shipping' : 'Other mail' }))) },
    { id: 'money', title: HEADS.money, compact: true, empty: 'Nothing due today or overdue.', rows: sections.find(s => s.id === 'money')?.rows || [] },
    ...((sections.find(s => s.id === 'tasks')?.rows.length || 0) ? [{ id: 'tasks', title: HEADS.tasks, compact: true, empty: 'Nothing due today.', rows: sections.find(s => s.id === 'tasks')!.rows }] : []),
    { id: 'soon', title: `Coming Up · ${WEEKS_AHEAD} Weeks`, empty: 'No upcoming events in the current calendar.', rows: soon.map(e => ({ id: `ev:${e.id}`, title: e.title, when: whenLabel(eventStart(e)), note: e.allDay ? eventStart(e).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : `${eventStart(e).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${eventStart(e).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` })).filter(r => !gone[r.id]) },
  ];
  const all = sections.flatMap(s => s.rows.map(r => r.id));
  const fresh = all.filter(id => !seen.includes(id)).length;
  const markSeen = () => { writeSaved(SEEN_KEY, all); setSeen(all); };
  return <>
    <Group tone="needs" icon="sun" title="Daily Brief" className="sk-brief" meta={fresh ? `${fresh} new since you last looked` : 'Your actions, replies, focus and due items'} actions={<>
      <span className="sk-updated" title="Newest source update; each section uses its latest available feed"><Icon name="refresh" size={12} />{updated ? `Updated ${updated}` : 'Not updated yet'}</span>
      {hidden ? <button type="button" className="sk-link" onClick={restoreAll} title="Bring back what you cleared today"><Icon name="eye" size={14} />Show {hidden} Cleared</button> : null}
      {fresh ? <button type="button" className="sk-link" onClick={markSeen} title="Clears the new marks; items stay until they’re dealt with"><Icon name="eye" size={14} />Mark Seen</button> : null}
      <button type="button" className="sk-link" onClick={() => window.dispatchEvent(new Event(REFRESH_EVENT))} title="Pull the latest available source feeds"><Icon name="refresh" size={14} />Refresh Sources</button>
    </>}>
      <div className="sk-brief-sections">
        {cols.map(s => <section key={s.id} className={`sk-brief-section${s.compact ? ' is-compact' : ''}${s.id === 'doing' ? ' is-numbered' : ''}`} aria-label={s.title}>
          <ListHead title={s.title} meta={s.rows.length} shut={Boolean(folds[s.id])} onToggle={() => toggle(s.id)} />
          {folds[s.id] ? null : <>
            {s.rows.length ? <ul className="sk-brief-items">{s.rows.map(r => {
              const isNew = !s.keepAll && !seen.includes(r.id);
              const open = r.id.startsWith('bill:') ? () => openMoneyDue(r.id.slice(5)) : r.mix ? () => requestOpenMix(r.mix!) : r.focusId ? () => setOpenFocusId(r.focusId!) : r.pin ? () => openTaskPanel(r.pin!) : r.go ? () => enter(r.go!) : undefined;
              return <li key={r.id} className="sk-brief-entry" data-focus-priority={r.priority}>
                {open ? <button type="button" className="sk-brief-open" onClick={open} title={[r.title, r.note, r.priority ? FOCUS_PRIORITY_LABEL[r.priority] : ''].filter(Boolean).join(' · ')}>
                  <span className="sk-brief-title">{isNew && !s.compact ? <Dot tone="needs" hint="New since you last looked" /> : null}{r.marker ? <span className="sk-brief-kind">{r.marker}</span> : null}{r.title}{r.when ? <em className="sk-brief-when">{r.when}</em> : null}</span>
                  {r.note ? <small>{r.note}</small> : null}
                </button> : <span className="sk-brief-open"><span className="sk-brief-title">{r.title}{r.when ? <em className="sk-brief-when">{r.when}</em> : null}</span><small>{r.note}</small></span>}
                {r.finish ? <span className="sk-brief-done"><Circle onDone={r.finish} label={`Done: ${r.title}`} /></span> : null}
                {s.keepAll ? null : <button type="button" className="sk-brief-clear" aria-label={`Clear ${r.title} from today’s brief`} title="Clear from today’s brief (it can come back tomorrow)" onClick={() => dismissIds([r.id])}><Icon name="close" size={12} /></button>}
              </li>;
            })}</ul> : <p className="sk-brief-empty">{s.empty}</p>}
          </>}
        </section>)}
      </div>
    </Group>
    {selected && selectedList ? <FocusEntryDialog item={selected} events={events} bills={bills} openFinance={openFinance} update={updateFocus} remove={() => selectedList[1](selectedList[0].filter(i => i.id !== selected.id))} close={() => setOpenFocusId(null)} /> : null}
  </>;
}
