'use client';

import { useMemo, useState } from 'react';
import { buildBrief, type BriefSection } from '../../lib/dailyBrief';
import { REFRESH_EVENT } from '../../lib/syncNow';
import { openTaskPanel } from '../../lib/priorityPins';
import { readSaved, writeSaved } from '../../lib/storage';
import type { BillDue } from '../../lib/schedule';
import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { Dot, Group, ListHead, Row } from '../sticker/kit';
import { Icon } from '../sticker/Icon';

const SEEN_KEY = 'lifehub-brief-seen';
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
  return useMemo(() => buildBrief(snapshots, bills).filter(s => s.id !== 'tasks'), [snapshots, bills]);
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

export function DailyBrief({ snapshots, bills, enter }: { snapshots: Record<SourceId, SourceSnapshot>; bills: BillDue[]; enter: (id: SpaceId) => void }) {
  const sections = useBrief(snapshots, bills);
  const [seen, setSeen] = useState<string[]>(() => readSaved<string[]>(SEEN_KEY, []));
  const [more, setMore] = useState<string | null>(null);
  const all = sections.flatMap(s => s.rows.map(r => r.id));
  const fresh = all.filter(id => !seen.includes(id)).length;
  const markSeen = () => {
    writeSaved(SEEN_KEY, all);
    setSeen(all);
  };
  const live = sections.filter(s => s.rows.length);
  return (
    <Group
      tone="needs"
      icon="sun"
      title="Daily Brief"
      className="sk-brief"
      meta={fresh ? `${fresh} new since you last looked` : 'Mail, roles, sales and money that need a reply or a step'}
      actions={
        <>
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
                <ListHead title={HEADS[s.id]} meta={s.rows.length} />
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
                      onOpen={() => (r.pin ? openTaskPanel(r.pin) : enter(r.go))}
                    />
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
        <p className="sk-empty">No replies, messages or sales waiting on you.</p>
      )}
    </Group>
  );
}
