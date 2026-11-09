'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FeaturedItem, SourceId } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { DECK, PLAN, updatePinDetails, type BeforeStep, type Lane, type LaneEntry } from '../../lib/priorityPins';
import { LEVEL_LABEL, type Level } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';
import { SiteIcon } from './SiteIcon';
import { SearchPick } from '../sticker/SearchPick';
import { habitOptions, todayIso, type Lock, type LockState } from '../../lib/locks';
import { Icon } from '../sticker/Icon';
import { MenuRow, useRowMenu } from './RowMenu';
import './priority-panel.css';

type PickOpt = { key: string; label: string; sub?: string };

export type PriorityItem = FeaturedItem & { source: SourceId; key: string };

function moveRadio(e: ReactKeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const current = buttons.indexOf(e.target as HTMLButtonElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
    : (current + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
  e.preventDefault();
  buttons[next]?.focus();
  if (buttons[next]?.getAttribute('aria-checked') !== 'true') buttons[next]?.click();
}

/**
 * Side panel for one Priority item: the full note from its site, a link into it, "Before this"
 * (anything in the way / that has to happen first, tick them off), and a free plan note.
 * Saved on the item's priority entry, so it cloud-syncs with the rest of Priority.
 */
export function PriorityPanel({
  item,
  entry,
  lane,
  level,
  critical,
  onCycleLevel,
  onSetLevel,
  onToggleCritical,
  onMove,
  onDone,
  onRemove,
  onRename,
  onDelete,
  enter,
  close,
  lock,
  lockOptions,
}: {
  /** Its lock, worked out (open or not, and what it waits on) */
  lock?: LockState;
  /** What a lock can wait on: other tasks and site lists */
  lockOptions?: { tasks: PickOpt[]; lists: PickOpt[] };
  /** New name for the task everywhere it shows ('' = back to the site's own name) */
  onRename?: (title: string) => void;
  /** Delete it from Life Hub (every list, card and count) */
  onDelete?: () => void;
  item: PriorityItem;
  entry?: LaneEntry;
  lane: Lane | null;
  level: Level | null;
  critical: boolean;
  onCycleLevel: () => void;
  /** Pick red / yellow / green directly (null clears) */
  onSetLevel?: (level: Level | null) => void;
  onToggleCritical: () => void;
  onMove: (lane: Lane) => void;
  onDone?: () => void;
  onRemove: () => void;
  enter: (id: SourceId) => void;
  close: () => void;
}) {
  const def = sourceById[item.source];
  const [name, setName] = useState(item.title);
  // A rename (here or elsewhere) changes item.title: follow it.
  const [shownTitle, setShownTitle] = useState(item.title);
  if (shownTitle !== item.title) {
    setShownTitle(item.title);
    setName(item.title);
  }
  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(item.title);
    if (next !== item.title) onRename?.(next);
  };
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState(entry?.note || '');
  const [newStep, setNewStep] = useState('');
  const before = entry?.before || [];
  const [newSub, setNewSub] = useState('');
  const subs = entry?.subs || [];
  // The origin's own steps (Peculiar Candle's stepped tasks) come first; they're filled in on that site.
  const originSteps = item.steps || [];
  const allSubs = originSteps.length + subs.length;
  const subsDone = originSteps.filter(x => x.done).length + subs.filter(x => x.done).length;
  const tools = useRowMenu([
    { label: 'Critical', on: critical, onSelect: onToggleCritical },
    { label: 'Take off the plan', hidden: !lane, onSelect: onRemove },
    { label: 'Delete', hidden: !onDelete, danger: true, onSelect: () => {
      if (window.confirm(`Delete “${item.title}” from Life Hub? It leaves every list, card and count.`)) onDelete?.();
    } },
  ], item.title);

  // Both editable text fields start at one line and grow only as their content needs it.
  useLayoutEffect(() => {
    const resize = () => {
      for (const field of [nameRef.current, noteRef.current]) {
        if (!field) continue;
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [name, note]);

  // Auto page zoom can differ from the saved zoom token. Use the actual scale for this
  // editing surface and its portalled menus, without changing the user's page setting.
  useLayoutEffect(() => {
    const app = panelRef.current?.closest<HTMLElement>('.sk-app');
    if (!app) return;
    const previous = app.style.getPropertyValue('--pp-page-zoom');
    const resize = () => app.style.setProperty('--pp-page-zoom', String(parseFloat(getComputedStyle(document.documentElement).zoom) || 1));
    resize();
    window.addEventListener('resize', resize);
    const observer = new MutationObserver(resize);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      window.removeEventListener('resize', resize);
      observer.disconnect();
      if (previous) app.style.setProperty('--pp-page-zoom', previous);
      else app.style.removeProperty('--pp-page-zoom');
    };
  }, []);

  // Behave like a dialog: focus moves in once when it opens, Escape closes it.
  const closeLatest = useRef(close);
  useEffect(() => {
    closeLatest.current = close;
  }, [close]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('.row-menu')) || document.querySelector('.row-menu')) return;
      if (e.key === 'Escape') closeLatest.current();
      if (e.key !== 'Tab') return;
      const fields = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || [])].filter(el => el.getClientRects().length);
      const first = fields[0], last = fields[fields.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, []);

  // Save the plan note a moment after typing stops, and on close if a save is still pending.
  const saved = useRef(entry?.note || '');
  const pending = useRef(note);
  useEffect(() => {
    pending.current = note;
    if (note === saved.current) return;
    const t = window.setTimeout(() => {
      saved.current = note;
      updatePinDetails(item.key, { note: note.trim() ? note : undefined });
    }, 500);
    return () => window.clearTimeout(t);
  }, [note, item.key]);
  useEffect(
    () => () => {
      const last = pending.current;
      if (last !== saved.current) updatePinDetails(item.key, { note: last.trim() ? last : undefined });
    },
    [item.key],
  );

  const setBefore = (next: BeforeStep[]) => updatePinDetails(item.key, { before: next.length ? next : undefined });
  const addStep = (e: FormEvent) => {
    e.preventDefault();
    const text = newStep.trim();
    if (!text) return;
    setBefore([...before, { id: `b-${Date.now()}`, text, done: false }]);
    setNewStep('');
  };

  const setSubs = (next: BeforeStep[]) => updatePinDetails(item.key, { subs: next.length ? next : undefined });
  const addSub = (e: FormEvent) => {
    e.preventDefault();
    const text = newSub.trim();
    if (!text) return;
    setSubs([...subs, { id: `s-${Date.now()}`, text, done: false }]);
    setNewSub('');
  };

  // Rendered inside the themed app so the Priority box's blur effect
  // doesn't trap a fixed-position panel inside it.
  const host = typeof document !== 'undefined' ? document.querySelector('.sk-app') || document.querySelector('.frontier-shell') || document.body : null;
  if (!host) return null;
  return createPortal(
    <div className="drawer-wrap open plan-panel-wrap">
      <button className="drawer-scrim" onClick={close} aria-label="Close details" />
      <aside
        ref={panelRef}
        className="plan-panel plan-panel-compact"
        style={{ '--card-accent': `var(--c-${item.source})` } as CSSProperties}
        role="dialog" aria-modal="true" aria-labelledby="plan-panel-title">
        <header className="plan-panel-header">
        <div className="plan-panel-head" {...tools.bind}>
          <button type="button" className="plan-panel-site" onClick={() => enter(item.source)} title={`Open ${def.name} page`}>
            <SiteIcon source={item.source} className="plan-panel-icon" />
            {def.name}
          </button>
          <div className="plan-panel-head-tools">
            <button type="button" className="plan-panel-tools" onClick={e => tools.open(e.currentTarget)} aria-label="Task tools" aria-haspopup="menu"><Icon name="more" /></button>
            <button ref={closeRef} type="button" className="plan-panel-close" onClick={close} aria-label="Close details"><Icon name="close" /></button>
          </div>
          {tools.menu}
        </div>

        {onRename ? (
          <h2 id="plan-panel-title" className="plan-panel-titlebox">
            <textarea
              ref={nameRef}
              rows={1}
              className="plan-panel-name"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setName(item.title);
                }
              }}
              aria-label="Task name (renames it everywhere on Life Hub)"
              title="Rename — it changes everywhere this task shows"
              maxLength={160}
            />
          </h2>
        ) : (
          <h2 id="plan-panel-title">{item.title}</h2>
        )}
        <div className="plan-panel-marks">
          {lane ? <span className="plan-panel-where">{lane === PLAN ? 'In Doing Now · action list' : 'In Doing Now · on deck'}</span> : <button type="button" className="plan-panel-action plan-panel-add" onClick={() => onMove(PLAN)}>＋ Add to Doing Now</button>}
          {critical ? <CriticalFlag on={critical} title={item.title} onToggle={onToggleCritical} /> : null}
          <span className="plan-panel-priority">
          <strong>Priority</strong>
          {onSetLevel ? (
            <span className="plan-levels" role="radiogroup" aria-label="Priority" onKeyDown={moveRadio}>
              {(['red', 'yellow', 'green'] as const).map(l => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  tabIndex={level === l || (!level && l === 'red') ? 0 : -1}
                  className={`plan-level is-${l}${level === l ? ' is-on' : ''}`}
                  onClick={() => onSetLevel(level === l ? null : l)}
                  title={level === l ? `${LEVEL_LABEL[l]} — click to clear` : LEVEL_LABEL[l]}
                >
                  {l === 'red' ? 'High' : l === 'yellow' ? 'Med' : 'Low'}
                </button>
              ))}
            </span>
          ) : (
            <LevelDot level={level} title={item.title} onCycle={onCycleLevel} />
          )}
          </span>
        </div>
        {item.detail ? <p className="plan-panel-detail">{item.detail}</p> : null}
        {item.originUrl ? (
          <a className="plan-panel-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
            Open in {def.shortName} ↗
          </a>
        ) : null}
        </header>

        <div className="plan-panel-body">
        <section className="plan-panel-sec plan-panel-property">
          <h3>
            <label htmlFor="plan-due">Day</label>
            <PlanHelp text={`Puts it on the calendar. It stays in Priority only — ${def.shortName} keeps its own date.`} />
          </h3>
          <div className="plan-due-row">
            <input
              id="plan-due"
              type="date"
              value={entry?.due || ''}
              onChange={e => updatePinDetails(item.key, { due: e.target.value || undefined })}
            />
            {entry?.due ? (
              <button type="button" className="plan-panel-action ghost" onClick={() => updatePinDetails(item.key, { due: undefined })}>
                Clear
              </button>
            ) : null}
          </div>
        </section>

        <LockSection itemKey={item.key} saved={entry?.lock} state={lock} options={lockOptions} />

        <section className="plan-panel-sec plan-panel-property" aria-labelledby="plan-before">
          <h3 id="plan-before">Before this<PlanHelp text="Anything in the way, or that has to happen first." /></h3>
          <div className="plan-panel-value">
          {before.length ? (
            <ul className="plan-before-list">
              {before.map(step => (
                <MenuRow key={step.id} className={step.done ? 'is-done' : ''} title={step.text}
                  items={[{ label: 'Remove', danger: true, onSelect: () => setBefore(before.filter(b => b.id !== step.id)) }]}>
                  <label>
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={() => setBefore(before.map(b => (b.id === step.id ? { ...b, done: !b.done } : b)))}
                    />
                    <span>{step.text}</span>
                  </label>
                </MenuRow>
              ))}
            </ul>
          ) : null}
          <form className="plan-before-add" onSubmit={addStep}>
            <input
              value={newStep}
              onChange={e => setNewStep(e.target.value)}
              placeholder="e.g. Get the account number from Mom"
              aria-label="Add something that has to happen first"
            />
            <button type="submit" className="plan-panel-action">
              + Add
            </button>
          </form>
          </div>
        </section>

        <section className="plan-panel-sec plan-panel-subtasks" aria-labelledby="plan-subs">
          <h3 id="plan-subs">
            Subtasks
            <PlanHelp text={originSteps.length
              ? `Steps from ${def.shortName || def.name} tick off there as you fill them in; add your own below.`
              : 'The pieces this task is made of. They never change any task count.'} />
            {allSubs ? (
              <span className="plan-subs-count">
                <span className="plan-subs-meter" role="progressbar" aria-label="Subtasks done" aria-valuemin={0} aria-valuemax={allSubs} aria-valuenow={subsDone}><span style={{ width: `${subsDone / allSubs * 100}%` }} /></span>
                {subsDone}/{allSubs} done
              </span>
            ) : null}
          </h3>
          {originSteps.length ? (
            <ul className="plan-before-list plan-subs-list plan-origin-steps">
              {originSteps.map(step => (
                <li key={step.id} className={step.done ? 'is-done' : ''}>
                  <label>
                    <input type="checkbox" checked={step.done} disabled readOnly />
                    <span>{step.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {subs.length ? (
            <ul className="plan-before-list plan-subs-list">
              {subs.map(step => (
                <MenuRow key={step.id} className={step.done ? 'is-done' : ''} title={step.text}
                  items={[{ label: 'Remove', danger: true, onSelect: () => setSubs(subs.filter(b => b.id !== step.id)) }]}>
                  <label>
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={() => setSubs(subs.map(b => (b.id === step.id ? { ...b, done: !b.done } : b)))}
                    />
                    <span>{step.text}</span>
                  </label>
                </MenuRow>
              ))}
            </ul>
          ) : null}
          <form className="plan-before-add" onSubmit={addSub}>
            <input value={newSub} onChange={e => setNewSub(e.target.value)} placeholder="Add a subtask…" aria-label="Add a subtask" />
            <button type="submit" className="plan-panel-action">
              + Add
            </button>
          </form>
        </section>

        <section className="plan-panel-sec plan-panel-property plan-panel-note">
          <h3>
            <label htmlFor="plan-note">Plan</label>
          </h3>
          <textarea
            ref={noteRef}
            id="plan-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={1}
            placeholder="How you'll go about it…"
          />
        </section>
        </div>

        <div className="plan-panel-actions">
          {lane === PLAN ? (
            <button type="button" className="plan-panel-action ghost" onClick={() => onMove(DECK)}>
              ← Back to on deck
            </button>
          ) : (
            <button type="button" className="plan-panel-action" onClick={() => onMove(PLAN)}>
              Add to action list →
            </button>
          )}
          {onDone ? (
            <button type="button" className="plan-panel-action plan-panel-done" onClick={onDone} disabled={lock?.open === false} title={lock?.open === false ? lock.text : undefined}>
              {lock?.open === false ? 'Locked' : 'Done'}
            </button>
          ) : null}
        </div>
      </aside>
    </div>,
    host,
  );
}

/**
 * Keep the original explanations available to keyboard, pointer and touch users without
 * making every property occupy another line.
 */
function PlanHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="plan-panel-help-wrap">
      <button type="button" className="plan-panel-help" aria-label={text} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open ? <span id={id} role="tooltip" className="plan-panel-help-tip">{text}</span> : null}
    </span>
  );
}

/**
 * "Locked until": a task can wait on (A) a site list being finished, (B) another task being done, or
 * (C) a TickTick habit checked in N times. Saved on the task's priority entry (cloud-synced).
 */
function LockSection({ itemKey, saved, state, options }: { itemKey: string; saved?: Lock; state?: LockState; options?: { tasks: PickOpt[]; lists: PickOpt[] } }) {
  const [kind, setKind] = useState<'task' | 'list' | 'habit'>(saved?.kind || 'task');
  const [habitId, setHabitId] = useState(saved?.kind === 'habit' ? saved.habitId : '');
  const [count, setCount] = useState(saved?.kind === 'habit' ? String(saved.count) : '5');
  const [from, setFrom] = useState(saved?.kind === 'habit' ? saved.from : todayIso());
  const [editing, setEditing] = useState(!saved);
  const habits = habitOptions();
  const set = (lock: Lock | undefined) => {
    updatePinDetails(itemKey, { lock });
    setEditing(!lock);
  };
  const saveHabit = () => {
    const h = habits.find(x => x.id === habitId);
    const n = Math.round(Number(count));
    if (!h || !(n > 0)) return;
    set({ kind: 'habit', habitId: h.id, title: h.title, count: n, from: from || todayIso() });
  };
  return (
    <section className="plan-panel-sec plan-panel-property" aria-labelledby="plan-lock">
      <h3 id="plan-lock">Locked until<PlanHelp text="Optional. The task can't be checked off until this happens." /></h3>
      <div className="plan-panel-value">
      {saved && !editing ? (
        <>
          <p className={`plan-lock-state${state?.open ? ' is-open' : ''}`} role="status">
            {state?.open ? '🔓' : '🔒'} {state?.text || 'Locked'}
          </p>
          {state?.progress ? (
            <div className="plan-lock-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (state.progress[0] / Math.max(1, state.progress[1])) * 100)}%` }} />
            </div>
          ) : null}
          <div className="plan-due-row">
            <button type="button" className="plan-panel-action ghost" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="plan-panel-action ghost" onClick={() => set(undefined)}>Remove lock</button>
          </div>
        </>
      ) : (
        <>
          <div className="plan-lock-editor">
          <div className="plan-lock-kinds" role="radiogroup" aria-label="Lock kind" onKeyDown={moveRadio}>
            {([['task', 'A task is done'], ['list', 'A list is finished'], ['habit', 'A habit is done N times']] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={kind === id} tabIndex={kind === id ? 0 : -1} aria-label={label} title={label}
                className={kind === id ? 'is-on' : ''} onClick={() => setKind(id)}>
                {id === 'task' ? 'Task' : id === 'list' ? 'List' : 'Habit'}
              </button>
            ))}
          </div>
          {kind === 'task' ? (
            <SearchPick options={options?.tasks || []} label="Task it waits on" placeholder="Search for the task…" onPick={o => set({ kind: 'task', key: o.key, label: o.label })} />
          ) : kind === 'list' ? (
            options?.lists.length ? (
              <SearchPick options={options.lists} label="List it waits on" placeholder="Search your lists…" onPick={o => set({ kind: 'list', listId: o.key, label: o.label })} />
            ) : (
              <p className="plan-panel-hint">No site lists yet. Make one on a site first.</p>
            )
          ) : (
            <div className="plan-lock-habit">
              <select value={habitId} onChange={e => setHabitId(e.target.value)} aria-label="TickTick habit">
                <option value="">Pick a TickTick habit…</option>
                {habits.map(h => (
                  <option key={h.id} value={h.id}>{h.title}</option>
                ))}
              </select>
              <label>
                <span>Times</span>
                <input type="number" min={1} max={365} value={count} onChange={e => setCount(e.target.value)} />
              </label>
              <label>
                <span>Counting from</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </label>
              <button type="button" className="plan-panel-action" disabled={!habitId || !(Number(count) > 0)} onClick={saveHabit}>Lock</button>
              {!habits.length ? <small className="plan-panel-hint">Habits show up here after the TickTick pull (open the Habits tab once).</small> : null}
            </div>
          )}
          </div>
          {saved ? <button type="button" className="plan-panel-action ghost" onClick={() => setEditing(false)}>Cancel</button> : null}
        </>
      )}
      </div>
    </section>
  );
}
