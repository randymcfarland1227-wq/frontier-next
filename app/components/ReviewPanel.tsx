'use client';

import { useMemo, useState } from 'react';
import type { CompletionEntry, CompletionLedger, CompletionStats, SourceShare } from '../../lib/completions';
import type { EnergyWindow } from '../../lib/energy';
import { sourceById } from '../../lib/sources';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import { BalanceStrip } from './BalanceStrip';
import { CloudBackup } from './CloudBackup';
import { Dot, Group, ListHead, Row } from '../sticker/kit';
import { Icon } from '../sticker/Icon';

const SHOW_DONE = 40;

const PERIODS: Array<{ id: EnergyWindow; label: string; key: keyof CompletionStats }> = [
  { id: 'today', label: 'Today', key: 'today' },
  { id: 'last7', label: 'Past 7 days', key: 'last7' },
  { id: 'month', label: 'This month', key: 'month' },
  { id: 'all', label: 'All time', key: 'allTime' },
];

function periodStart(period: EnergyWindow, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === 'today') return today;
  if (period === 'last7') return today - 6 * 86400000;
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return -Infinity;
}

function doneWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  // Date-only completions (e.g. Role Hub applied dates) land at local midnight — show just the day.
  const time = d.getHours() || d.getMinutes() ? ` ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  return `${sameDay ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })}${time}`;
}

export function ReviewPanel({
  stats,
  ledger,
  focusConfig,
  renderBalance,
  renderSorting,
}: {
  stats: CompletionStats;
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
  /** Balance strip from LifeHub, drawn for the period chosen here */
  renderBalance?: (period: EnergyWindow) => React.ReactNode;
  /** "Needs a bucket or goal" box for this period's completions */
  renderSorting?: (entries: CompletionEntry[]) => React.ReactNode;
}) {
  // One period for the whole panel: the tiles pick it; By source and Balance follow.
  const [period, setPeriod] = useState<EnergyWindow>('today');
  const inPeriod = useMemo(() => {
    const start = periodStart(period);
    return Object.values(ledger.entries)
      .filter(e => Date.parse(e.completedAt) >= start)
      .sort((x, y) => Date.parse(y.completedAt) - Date.parse(x.completedAt));
  }, [ledger, period]);
  const periodShares: SourceShare[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of inPeriod) counts.set(e.source, (counts.get(e.source) || 0) + 1);
    const total = inPeriod.length;
    return [...counts.entries()]
      .map(([id, count]) => ({
        id: id as SourceShare['id'],
        name: sourceById[id as SourceShare['id']]?.shortName || id,
        count,
        percent: total ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [inPeriod]);
  const periodLabel = PERIODS.find(p => p.id === period)!.label.toLowerCase();
  const max = Math.max(1, ...periodShares.map(s => s.count));
  const [openSource, setOpenSource] = useState<string | null>(null);
  return (
    <div className="sk-review" aria-label="Completion review">
      <Group tone="done" title="Completions Across Sites" meta={`${stats.allTime} total · ${stats.openAcrossSources} open now · ${stats.inventoryTasks} in hub inventory`}>
        <div className="sk-review-grid">
          <div className="sk-review-col">
            <div className="sk-periods" role="group" aria-label="Choose a period">
              {PERIODS.map(p => (
                <button type="button" key={p.id} aria-pressed={p.id === period} onClick={() => setPeriod(p.id)}>
                  <b>{stats[p.key] as number}</b>
                  <span>{p.id === 'today' ? 'Completed Today' : p.label}</span>
                </button>
              ))}
            </div>
            <ListHead title="By Source" meta={periodLabel} />
            {periodShares.length === 0 ? (
              <p className="sk-empty">Nothing completed {period === 'all' ? 'yet' : periodLabel}.</p>
            ) : (
              periodShares.map(row => {
                const done = inPeriod.filter(e => e.source === row.id);
                const open = openSource === row.id;
                return (
                  <div className={`sk-bar${open ? ' is-open' : ''}`} key={row.id}>
                    <button type="button" className="sk-bar-line" aria-expanded={open} onClick={() => setOpenSource(open ? null : row.id)}>
                      <Icon name="chevron" size={14} className="sk-bar-chev" />
                      <span className="sk-rt">{row.name}</span>
                      <span className="sk-rv">
                        {row.count} · {row.percent}%
                      </span>
                      <span className="sk-meter" aria-hidden="true">
                        <i style={{ width: `${(row.count / max) * 100}%` }} />
                      </span>
                    </button>
                    {open ? (
                      <div className="sk-bar-done">
                        {done.slice(0, SHOW_DONE).map(e => (
                          <Row
                            key={`${e.taskId}-${e.completedAt}`}
                            className="is-done"
                            lead={<Dot tone="done" />}
                            title={e.title || e.taskId}
                            value={<time dateTime={e.completedAt}>{doneWhen(e.completedAt)}</time>}
                          />
                        ))}
                        {done.length > SHOW_DONE ? <p className="sk-sec sk-more">+ {done.length - SHOW_DONE} earlier</p> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          {focusConfig ? (
            <div className="sk-review-col">
              {renderBalance ? (
                renderBalance(period)
              ) : (
                <BalanceStrip ledger={ledger} config={focusConfig} today={{}} settings={{ paces: {}, updatedAt: '' }} onSaveSettings={() => undefined} window={period} />
              )}
            </div>
          ) : null}
          {renderSorting ? <div className="sk-review-col">{renderSorting(inPeriod)}</div> : null}
        </div>
      </Group>
      <CloudBackup />
    </div>
  );
}
