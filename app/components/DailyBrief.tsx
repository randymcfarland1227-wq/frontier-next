'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildBrief, type BriefSection } from '../../lib/dailyBrief';
import { REFRESH_EVENT } from '../../lib/syncNow';
import { openTaskPanel } from '../../lib/priorityPins';
import { readSaved, writeSaved } from '../../lib/storage';
import { eventEnd, eventStart, type BillDue, type ScheduleSnapshot } from '../../lib/schedule';
import { usePlan } from './FocusDrawer';
import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { Dot, Group, ListHead, Row } from '../sticker/kit';
import { Icon } from '../sticker/Icon';

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
const SHOWN = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 4 : 6;

/** Column names (Title Case) for the brief's sections. */
const HEADS: Record<BriefSection['id'], string> = {
  money: 'Money Due Now',
  tasks: 'Tasks Due Today',
  mail: 'Mail Waiting',
  roles: 'Role Replies',
  sales: 'Sales & Listings',
};
const SHORT: Record<BriefSection['id'], [string, string]> = {
  money: ['bill due', 'bills due'],
  tasks: ['task today', 'tasks today'],
  mail: ['mail', 'mail'],
  roles: ['role reply', 'role replies'],
  sales: ['sale to do', 'sales to do'],
};

/** The brief's sections that can need you (tasks due today live in Doing now and the site cards). */
export function useBrief(snapshots: Record<SourceId, SourceSnapshot>, bills: BillDue[]) {
  const gone = useDismissed();
  return useMemo(
    () =>
      buildBrief(snapshots, bills)
        .filter(s => s.id !== 'tasks')
        .map(s => ({ ...s, rows: s.rows.filter(r => !gone[r.id]) })),
    [snapshots, bills, gone],
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
type BRow = { id: string; title: string; note: string; tone?: string; pin?: string; go?: SpaceId };
type BCol = { id: string; title: string; rows: BRow[] };

export function DailyBrief({
  snapshots,
  bills,
  schedule,
  enter,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  schedule: ScheduleSnapshot | null;
  enter: (id: SpaceId) => void;
}) {
  const sections = useBrief(snapshots, bills);
  const gone = useDismissed();
  const { plan } = usePlan(snapshots, bills);
  const hidden = Object.keys(useDismissed()).length;
  const stamp = Math.max(
    0,
    ...(['gmail', 'outlook', 'role', 'radall', 'resale', 'ticktick'] as SourceId[]).map(id => Date.parse(snapshots[id]?.refreshedAt || '') || 0),
  );
  const updated = stamp
    ? `${new Date(stamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${
        new Date(stamp).toDateString() === new Date().toDateString() ? '' : ` · ${new Date(stamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      }`
    : null;
  const [seen, setSeen] = useState<string[]>(() => readSaved<string[]>(SEEN_KEY, []));
  const [more, setMore] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());
  const soon = (schedule?.events || [])
    .filter(e => (e.myStatus === 'owner' || e.myStatus === 'yes') && eventEnd(e).getTime() > nowMs && eventStart(e).getTime() < nowMs + WEEKS_AHEAD * 7 * 86400000)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const extra = (id: string, title: string, rows: BRow[]): BCol => ({ id, title, rows: rows.filter(r => !gone[r.id]) });
  const cols: BCol[] = [
    extra('doing', 'Doing Now', plan.map(i => ({ id: `plan:${i.key}`, title: i.title, note: i.source, go: i.source as SpaceId }))),
    ...sections.map(s => ({ id: s.id, title: HEADS[s.id], rows: s.rows as BRow[] })),
    extra(
      'soon',
      `Coming Up · ${WEEKS_AHEAD} Weeks`,
      soon.map(e => ({
        id: `ev:${e.id}`,
        title: e.title,
        note: e.allDay
          ? eventStart(e).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
          : `${eventStart(e).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${eventStart(e).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      })),
    ),
  ];
  const all = sections.flatMap(s => s.rows.map(r => r.id));
  const fresh = all.filter(id => !seen.includes(id)).length;
  const markSeen = () => {
    writeSaved(SEEN_KEY, all);
    setSeen(all);
  };
  const live = cols.filter(c => c.rows.length);
  return (
    <Group
      tone="needs"
      icon="sun"
      title="Daily Brief"
      className="sk-brief"
      meta={fresh ? `${fresh} new since you last looked` : 'Doing Now, bills, replies and what’s coming in three weeks'}
      actions={
        <>
          <span className="sk-updated" title="Newest pull across mail, roles, sales, money and TickTick">
            <Icon name="refresh" size={12} />
            {updated ? `Updated ${updated}` : 'Not updated yet'}
          </span>
          {hidden ? (
            <button type="button" className="sk-link" onClick={restoreAll} title="Bring back what you cleared today">
              <Icon name="eye" size={14} />
              Show {hidden} Cleared
            </button>
          ) : null}
          {fresh ? (
            <button type="button" className="sk-link" onClick={markSeen} title="Clears the new marks; items stay until they’re dealt with">
              <Icon name="eye" size={14} />
              Mark Seen
            </button>
          ) : null}
          <button type="button" className="sk-link" onClick={() => window.dispatchEvent(new Event(REFRESH_EVENT))} title="Pull mail, roles and sales again">
            <Icon name="refresh" size={14} />
            Check for Replies
          </button>
        </>
      }
    >
      {live.length ? (
        <div className="sk-cols" style={{ '--cols': Math.min(live.length, 4) } as React.CSSProperties}>
          {live.map(s => {
            const rows = more === s.id ? s.rows : s.rows.slice(0, SHOWN);
            return (
              <div key={s.id} className="sk-col">
                <ListHead title={s.title} meta={s.rows.length} />
                {rows.map(r => {
                  const isNew = !seen.includes(r.id);
                  return (
                    <Row
                      key={r.id}
                      highlight={isNew}
                      lead={isNew ? <Dot tone="needs" hint="New since you last looked" /> : null}
                      title={r.title}
                      sub={r.note}
                      value={r.tone === 'late' ? 'Overdue' : r.tone === 'today' ? 'Today' : undefined}
                      valueTone={r.tone === 'late' ? 'late' : undefined}
                      hint={`${r.title} — ${r.note}`}
                      onOpen={r.pin || r.go ? () => (r.pin ? openTaskPanel(r.pin) : enter(r.go as SpaceId)) : undefined}
                    >
                      <button
                        type="button"
                        className="sk-dismiss"
                        aria-label={`Clear ${r.title} from today’s brief`}
                        title="Clear from today’s brief (it can come back tomorrow)"
                        onClick={() => dismissIds([r.id])}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </Row>
                  );
                })}
                {s.rows.length > SHOWN ? (
                  <button type="button" className="sk-link sk-more" onClick={() => setMore(more === s.id ? null : s.id)}>
                    {more === s.id ? 'Show Fewer' : `${s.rows.length - SHOWN} more`}
                    <Icon name={more === s.id ? 'chevronDown' : 'chevron'} size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="sk-empty">Nothing in Doing Now, no bills, replies or events in the next three weeks.</p>
      )}
    </Group>
  );
}
