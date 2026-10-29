'use client';

import { useMemo, useState } from 'react';
import type { CompletionLedger } from '../../lib/completions';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import {
  computeEnergy,
  DEFAULT_PACES,
  FOCUS_LABEL,
  loadAvailabilityHistory,
  PROGRESS_LABEL,
  type AreaEnergy,
  type Availability,
  type BalanceSettings,
  type EnergyWindow,
  type Suggestion,
} from '../../lib/energy';
import { Icon } from '../sticker/Icon';
import { ListHead, Tag, type Tone } from '../sticker/kit';

/** Items listed in the Charge pop-up before "+N more". */
const SHOW_SUGGESTIONS = 6;

/** e.g. "3 done · 2 more to In-Line · 1 more to Balanced" */
function meta(a: AreaEnergy) {
  if (a.idle) return 'Nothing on its plate right now';
  const parts = [`${a.done} done`];
  if (a.progress === 'charge') parts.push(`${a.toInLine} more to In-Line`);
  else if (a.goal > 0) parts.push(a.progress === 'onfire' ? 'well past its goal' : 'goal met');
  if (a.focus === 'under') parts.push(`${a.toBalanced} more to Balanced`);
  if (a.focus === 'over') parts.push(`${a.overBy} past its fair share`);
  return parts.join(' · ');
}



const PROGRESS_TONE: Record<string, Tone | undefined> = { charge: undefined, inline: 'open', onfire: 'ops' };
const FOCUS_TONE: Record<string, Tone> = { under: 'needs', balanced: 'done', over: 'alert' };

function round(n: number) {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

function tip(a: AreaEnergy, window: EnergyWindow) {
  const span = window === 'today' ? 'today' : window === 'last7' ? 'over the past 7 days' : window === 'month' ? 'this month' : 'overall';
  return `${a.name}: ${a.done} done ${span} · goal ≈ ${round(a.goal)} (of ${a.available} available) · ${Math.round(a.share * 100)}% of your completions vs a fair ${Math.round(a.fairShare * 100)}%`;
}

function summary(areas: AreaEnergy[]) {
  const inLine = areas.filter(a => a.progress !== 'charge').length;
  const over = areas.filter(a => a.focus === 'over').map(a => a.name);
  const parts = [`${inLine} of ${areas.length} In-Line or better`];
  if (over.length) parts.push(`Overfocused on ${over.join(', ')}`);
  else if (areas.every(a => a.focus === 'balanced')) parts.push('Balanced across the board');
  return parts.join(' · ');
}

export function BalanceStrip({
  ledger,
  config,
  today,
  settings,
  onSaveSettings,
  window,
  suggestions = {},
}: {
  ledger: CompletionLedger;
  config: FocusAreaConfig;
  today: Availability;
  settings: BalanceSettings;
  onSaveSettings: (paces: Record<string, number>) => void;
  /** Period chosen in the Review panel */
  window: EnergyWindow;
  /** Open work per bucket that would charge it */
  suggestions?: Record<string, Suggestion[]>;
}) {
  const [editing, setEditing] = useState(false);
  /** Charge pop-up opened by tap (touch screens); hover/focus opens it on desktop. */
  const [openCharge, setOpenCharge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});

  const report = useMemo(
    () => computeEnergy(ledger, config, window, settings, loadAvailabilityHistory(), today),
    [ledger, config, window, settings, today],
  );

  const openSettings = () => {
    setDraft(Object.fromEntries(config.areas.map(a => [a.id, Math.round((settings.paces[a.id] ?? DEFAULT_PACES[a.id] ?? 0.2) * 100)])));
    setEditing(true);
  };

  const periodName = window === 'today' ? 'Today' : window === 'last7' ? 'Past 7 days' : window === 'month' ? 'This month' : 'All time';
  return (
    <div className="sk-balance" aria-label="Balance across life buckets">
      <ListHead title="Balance" meta={periodName}>
        <button
          type="button"
          className="sk-link"
          aria-label="Balance settings"
          aria-expanded={editing}
          title="Set each bucket's pace"
          onClick={() => (editing ? setEditing(false) : openSettings())}
        >
          <Icon name="settings" size={14} />
          Pace
        </button>
      </ListHead>
      <p className="sk-sec sk-bal-sum">{report.totalDone ? summary(report.areas) : 'Nothing completed in this window yet.'}</p>

      {editing ? (
        <form
          className="sk-form sk-pace-form"
          onSubmit={e => {
            e.preventDefault();
            onSaveSettings(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Math.max(1, Math.min(100, v)) / 100])));
            setEditing(false);
          }}
        >
          <p className="sk-sec sk-field is-wide">
            <b>Pace</b> = how much of a bucket&apos;s available work makes a good day. Lower it as a site&apos;s list shrinks and each task
            gets harder.
          </p>
          {config.areas.map(a => {
            const pct = draft[a.id] ?? 0;
            const avail = today[a.id] || 0;
            return (
              <label key={a.id} className="sk-field is-wide sk-pace">
                <span>{a.name}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={pct}
                  onChange={e => setDraft(d => ({ ...d, [a.id]: Number(e.target.value) }))}
                  aria-label={`${a.name} pace`}
                />
                <span>
                  {pct}% · ≈ {round((avail * pct) / 100)} of {avail} today
                </span>
              </label>
            );
          })}
          <div className="sk-form-actions">
            <button type="submit" className="sk-btn is-small">
              Save
            </button>
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => setDraft(Object.fromEntries(config.areas.map(a => [a.id, Math.round((DEFAULT_PACES[a.id] ?? 0.2) * 100)])))}>
              Reset to Defaults
            </button>
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="sk-bal-list">
        {report.areas.map(a => {
          const sugg = suggestions[a.id] || [];
          const canCharge = (a.progress === 'charge' || a.focus === 'under') && sugg.length > 0;
          const isOpen = openCharge === a.id;
          return (
            <div className="sk-bal" key={a.id}>
              <div className="sk-bal-line">
                <span className="sk-rt">{a.name}</span>
                <span className="sk-bal-tags">
                  {canCharge ? (
                    <button
                      type="button"
                      className="sk-tagbtn"
                      aria-expanded={isOpen}
                      aria-label={`${PROGRESS_LABEL[a.progress]} — show what could charge ${a.name}`}
                      onClick={() => setOpenCharge(o => (o === a.id ? null : a.id))}
                    >
                      <Tag tone={PROGRESS_TONE[a.progress]}>{PROGRESS_LABEL[a.progress]}</Tag>
                      <Icon name={isOpen ? 'chevronDown' : 'chevron'} size={14} />
                    </button>
                  ) : (
                    <Tag tone={PROGRESS_TONE[a.progress]}>{PROGRESS_LABEL[a.progress]}</Tag>
                  )}
                  <Tag tone={FOCUS_TONE[a.focus]}>{FOCUS_LABEL[a.focus]}</Tag>
                </span>
              </div>
              <div className="sk-meter has-goal" role="img" aria-label={tip(a, window)}>
                {a.ratio > 0 ? <i style={{ width: `${Math.min(100, (a.ratio / 1.5) * 100)}%` }} /> : null}
                <span className="sk-goal-tick" style={{ left: `${(1 / 1.5) * 100}%` }} />
              </div>
              <p className="sk-rs">{meta(a)}</p>
              {isOpen ? (
                <div className="sk-charge" role="region" aria-label={`Could charge ${a.name}`}>
                  <span className="sk-hl">Could Charge It</span>
                  {sugg.slice(0, SHOW_SUGGESTIONS).map(s => (
                    <span key={s.title} className="sk-rt">
                      {s.title}
                      {s.why === 'habit' ? <span className="sk-sec"> · habit</span> : null}
                    </span>
                  ))}
                  {sugg.length > SHOW_SUGGESTIONS ? <span className="sk-sec">+{sugg.length - SHOW_SUGGESTIONS} more</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="sk-sec sk-bal-legend">
        Bar = progress toward each bucket&apos;s goal (tick = goal met). Longer periods average the days.
        {report.estimated ? ' Earlier days use today’s workload until Life Hub has seen them.' : ''}
      </p>
    </div>
  );
}
