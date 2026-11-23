'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { briefBuckets, buildBrief, type BriefSection, type BucketRow, type BucketTag } from '../../lib/dailyBrief';
import { focusPinItems } from '../../lib/focusPins';
import { REFRESH_EVENT } from '../../lib/syncNow';
import { createMix, doneInMix, endMix, groupSteps, openTaskPanel, placePin, PLAN, requestOpenMix, unpin, updatePinDetails } from '../../lib/priorityPins';
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
import { withoutActionListRows } from '../../lib/dailyBrief';
import { FocusEntryDialog, type LinkItem, type OpenFinance } from './FocusCards';
import type { Entry, useShortTermFocus } from './FocusSection';
import { sourceById } from '../../lib/sources';
import { focusCollections } from '../../lib/focusRouting';
import { LOG_LABEL, useTickTickOff } from '../../lib/ticktickLog';

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
/** Words too common to tell two ship items apart. */
const STOP = new Set(['the', 'and', 'for', 'with', 'size', 'men', 'mens', "men's", 'women', 'womens', 'new', 'nwt']);
const TAG_LABEL: Record<BucketTag, string> = { ship: 'ship', $: '$', task: 'task', reply: 'reply', appt: 'appt', focus: 'focus', mail: 'mail' };

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
  const ttOff = useTickTickOff();
  return useMemo(
    () =>
      buildBrief(snapshots, bills, new Date(`${day}T12:00:00`))
        .map(s => ({ ...s, rows: s.rows.map(r => (r.pin?.startsWith('ticktick:') && ttOff[r.pin.slice(9)] ? { ...r, off: LOG_LABEL[ttOff[r.pin.slice(9)]] } : r)) }))
        .map(s => ({ ...s, rows: s.rows.filter(r => !gone[r.id] && (s.id !== 'tasks' || r.tone === 'today')) })),
    [snapshots, bills, gone, day, ttOff],
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

const WEEKS_AHEAD = 1;
type BRow = { id: string; title: string; note: string; tone?: string; pin?: string; go?: SpaceId; mix?: string; focusId?: string; priority?: FocusPriority; marker?: string; when?: string; finish?: () => void; off?: string };
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
  const briefOff = useTickTickOff();
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
  ];
  const focusCards = useMemo(() => [...focus.now[0], ...focus.weeks[0]].filter(c => c.date || c.eventId).map(c => ({ id: c.id, title: c.title, date: c.date, eventId: c.eventId })), [focus.now, focus.weeks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const steps = useMemo(() => focusPinItems().filter(i => i.id.startsWith('ftask:')).map(i => ({ id: i.id, title: i.title, detail: i.detail })), [focus.now, focus.weeks, focus.ongoing]);
  const onList = (r: BucketRow) => r.pins.length > 0 && r.pins.every(k => lanes[k]?.lane === PLAN);
  // A ship row whose item is already on the Action List (pinned, or a "Ship …" task naming the same item) stays off Do today.
  const shipWords = (t: string) => new Set(t.toLowerCase().replace(/^\s*(ship|end listing:?)\s+/, '').replace(/\+ end listing.*$/, '').split(/[^a-z0-9']+/).filter(w => w.length > 2 && !STOP.has(w)));
  const planShips = plan.filter(i => /^\s*ship\b/i.test(lanes[i.key]?.title || i.title)).map(i => shipWords(lanes[i.key]?.title || i.title));
  const shipOnList = (r: BucketRow) => {
    if (onList(r)) return true;
    const w = [...shipWords(r.title)];
    return planShips.some(p => w.filter(x => p.has(x)).length >= Math.min(3, w.length));
  };
  const buckets = briefBuckets(sections, bills,
    soon.map(e => ({ id: e.id, title: e.title, start: eventStart(e), allDay: e.allDay })),
    focusCards, steps, new Date(nowMs))
    .map(b => ({ ...b, rows: withoutActionListRows(b.rows, key => lanes[key]?.lane === PLAN).filter(r => !r.ids.every(id => gone[id]) && !(r.tag === 'ship' && shipOnList(r))) }));
  const [unfold, setUnfold] = useState<Record<string, boolean>>({});
  const sendToList = (r: BucketRow) => {
    if (onList(r)) { r.pins.forEach(unpin); return; }
    // Hub-only pins (appointments) carry their own title; the catalog reads it from the pin.
    for (const k of r.pins) if (k.startsWith('self:brief:')) updatePinDetails(k, { title: r.pinTitle || r.title });
    if (r.pins.length > 1) createMix(r.pinTitle || r.title, r.pins);
    else placePin(r.pins[0], PLAN);
  };
  const all = [...sections.flatMap(s => s.rows.map(r => r.id)), ...buckets.flatMap(b => b.rows.flatMap(r => r.ids))];
  const fresh = all.filter(id => !seen.includes(id)).length;
  const markSeen = () => { writeSaved(SEEN_KEY, all); setSeen(all); };
  const bucketRow = (r: BucketRow, depth: number): ReactNode => {
    const kids = r.children;
    const isOpen = Boolean(unfold[r.id]);
    const isNew = r.ids.some(id => !seen.includes(id));
    const open = kids ? () => setUnfold(u => ({ ...u, [r.id]: !u[r.id] })) : r.billKey ? () => openMoneyDue(r.billKey!) : r.openPin ? () => openTaskPanel(r.openPin!) : r.go && r.go !== 'money' ? () => enter(r.go as SpaceId) : undefined;
    const pinned = onList(r);
    return <li key={r.id} className={`sk-brow${r.tone ? ` is-${r.tone}` : ''}${kids ? ' is-group' : ''}${isOpen ? ' is-open' : ''}${r.off ? ' is-off' : ''}`}>
      <div className="sk-brow-line">
        <span className="sk-btag" data-tag={r.tag}>{TAG_LABEL[r.tag]}</span>
        <button type="button" className="sk-brow-main" onClick={open} aria-expanded={kids ? isOpen : undefined} title={[r.title, r.note].filter(Boolean).join(' · ')}>
          <span className="sk-brow-title">{isNew && !depth ? <Dot tone="needs" hint="New since you last looked" /> : null}<span className="sk-brow-text">{r.title}</span>{r.when ? <em className="sk-brow-when">{r.when}</em> : null}{r.focusTag ? <span className="sk-brow-focus" title="Linked to a short-term focus card">◎ {r.focusTag}</span> : null}{kids ? <Icon name="chevron" size={9} className="sk-brow-chev" /> : null}</span>
          {r.note || r.off ? <small>{[r.off, r.note].filter(Boolean).join(' · ')}</small> : null}
        </button>
        {r.pins.length ? <button type="button" className={`sk-brow-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned} aria-label={pinned ? `Take ${r.title} off the Action List` : `Send ${r.title} to the Action List`} title={pinned ? 'On your Action List (tap to take it off)' : kids ? 'Send all of these to the Action List as one list' : 'Send to the Action List'} onClick={() => sendToList(r)}><Icon name="pin" size={12} /></button> : null}
        {depth ? null : <button type="button" className="sk-brow-clear" aria-label={`Clear ${r.title} from today’s brief`} title="Clear from today’s brief (it can come back tomorrow)" onClick={() => dismissIds(r.ids)}><Icon name="close" size={11} /></button>}
      </div>
      {kids && isOpen ? <ul className="sk-brow-kids">{kids.map(k => bucketRow(k, depth + 1))}</ul> : null}
    </li>;
  };
  return <>
    <Group tone="needs" icon="sun" title="Daily Brief" className="sk-brief" meta={fresh ? `${fresh} new since you last looked` : 'Your actions, replies, focus and due items'} actions={<>
      <span className="sk-updated" title="Newest source update; each section uses its latest available feed"><Icon name="refresh" size={12} />{updated ? `Updated ${updated}` : 'Not updated yet'}</span>
      {hidden ? <button type="button" className="sk-link" onClick={restoreAll} title="Bring back what you cleared today"><Icon name="eye" size={14} />Show {hidden} Cleared</button> : null}
      {fresh ? <button type="button" className="sk-link" onClick={markSeen} title="Clears the new marks; items stay until they’re dealt with"><Icon name="eye" size={14} />Mark Seen</button> : null}
      <button type="button" className="sk-link sk-brief-refresh" onClick={() => window.dispatchEvent(new Event(REFRESH_EVENT))} title="Pull the latest available source feeds"><Icon name="refresh" size={14} />Refresh Sources</button>
    </>}>
      <div className="sk-brief-sections">
        {/* Action List is its own column; Mail → Coming Up always stack in the right column. */}
        {(() => { const sec = (s: BCol) => <section key={s.id} className={`sk-brief-section${s.compact ? ' is-compact' : ''}${s.id === 'doing' ? ' is-numbered' : ''}`} aria-label={s.title}>
          <ListHead title={s.title} meta={s.rows.length} shut={Boolean(folds[s.id])} onToggle={() => toggle(s.id)} />
          {folds[s.id] ? null : <>
            {s.rows.length ? <ul className="sk-brief-items">{s.rows.map(r0 => {
              const ttId = r0.pin?.startsWith('ticktick:') ? r0.pin.slice(9) : '';
              const r = !r0.off && ttId && briefOff[ttId] ? { ...r0, off: LOG_LABEL[briefOff[ttId]] } : r0;
              const isNew = !s.keepAll && !seen.includes(r.id);
              const open = r.id.startsWith('bill:') ? () => openMoneyDue(r.id.slice(5)) : r.mix ? () => requestOpenMix(r.mix!) : r.focusId ? () => setOpenFocusId(r.focusId!) : r.pin ? () => openTaskPanel(r.pin!) : r.go ? () => enter(r.go!) : undefined;
              return <li key={r.id} className={`sk-brief-entry${r.off ? ' is-off' : ''}`} data-focus-priority={r.priority}>
                {open ? <button type="button" className="sk-brief-open" onClick={open} title={[r.title, r.note, r.priority ? FOCUS_PRIORITY_LABEL[r.priority] : ''].filter(Boolean).join(' · ')}>
                  <span className="sk-brief-title">{isNew && !s.compact ? <Dot tone="needs" hint="New since you last looked" /> : null}{r.marker ? <span className="sk-brief-kind">{r.marker}</span> : null}{r.title}{r.when ? <em className="sk-brief-when">{r.when}</em> : null}</span>
                  {r.note || r.off ? <small>{[r.off, r.note].filter(Boolean).join(' · ')}</small> : null}
                </button> : <span className="sk-brief-open"><span className="sk-brief-title">{r.title}{r.when ? <em className="sk-brief-when">{r.when}</em> : null}</span><small>{r.note}</small></span>}
                {r.finish && !r.off ? <span className="sk-brief-done"><Circle onDone={r.finish} label={`Done: ${r.title}`} /></span> : null}
                {s.keepAll ? null : <button type="button" className="sk-brief-clear" aria-label={`Clear ${r.title} from today’s brief`} title="Clear from today’s brief (it can come back tomorrow)" onClick={() => dismissIds([r.id])}><Icon name="close" size={12} /></button>}
              </li>;
            })}</ul> : <p className="sk-brief-empty">{s.empty}</p>}
          </>}
        </section>; return <>{sec(cols[0])}<div className="sk-brief-rest sk-buckets" id="sk-brief-buckets">{buckets.map(b => <section key={b.id} className={`sk-bucket is-${b.id}`} aria-label={b.title}>
          <header className="sk-bucket-head">
            <button type="button" className="sk-bucket-fold" aria-expanded={!folds[`b:${b.id}`]} onClick={() => toggle(`b:${b.id}`)}>
              <span className="sk-bucket-title">{b.title}</span><span className="sk-bucket-count">{b.rows.length}</span>
            </button>
            <span className="sk-bucket-hint">{b.hint}</span>
          </header>
          {folds[`b:${b.id}`] ? null : b.rows.length ? <ul className="sk-bucket-rows">{b.rows.map(r => bucketRow(r, 0))}</ul> : <p className="sk-bucket-empty">{b.id === 'today' ? 'Nothing due today. Nice.' : b.id === 'week' ? 'Nothing on the calendar this week.' : 'No open focus tasks.'}</p>}
        </section>)}</div></>; })()}
      </div>
    </Group>
    {selected && selectedList ? <FocusEntryDialog item={selected} events={events} bills={bills} openFinance={openFinance} update={updateFocus} remove={() => selectedList[1](selectedList[0].filter(i => i.id !== selected.id))} close={() => setOpenFocusId(null)} /> : null}
  </>;
}
