'use client';

import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CAPTURE_KINDS,
  type Capture,
  type CaptureKind,
  type CaptureStatus,
} from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import type { SelfItem } from '../../lib/adapters/self';
import { useRowMenu, type RowMenuItem } from './RowMenu';
import { Circle, ListHead, Row, Tag } from '../sticker/kit';
import { Icon } from '../sticker/Icon';
import { usePriorityPins } from '../../lib/priorityPins';

/** Where a Self task can be moved (it then shows in that site's card). */
const MOVE_TO: Array<[string, string]> = [
  ['radall', 'Finances'],
  ['repair', 'Repair Log'],
  ['role', 'Role Hub'],
  ['move', 'Move OS'],
  ['income', 'Venture Lab'],
  ['resale', 'Resale Hub'],
  ['candle', 'Peculiar Candle'],
];

type Tab = CaptureStatus | 'tasks';
type Kind = 'task' | 'log' | CaptureKind;

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'task', label: 'Task' },
  { id: 'log', label: 'Log done' },
  ...CAPTURE_KINDS,
];

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today → now; an earlier day → noon that day, so it lands on the right day everywhere. */
function loggedAt(day: string) {
  if (!day || day >= localDay()) return new Date().toISOString();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Sat, Oct 10" for a YYYY-MM-DD day */
function dueLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Date picker for a Self task's day; opened from the row menu. */
function DueInput({ due, onChange, onClose }: { due?: string; onChange: (due?: string) => void; onClose: () => void }) {
  return (
    <input
      type="date"
      className="sk-capdue"
      autoFocus
      defaultValue={due || localDay()}
      aria-label="Day for this task"
      onBlur={e => {
        onClose();
        if (e.target.value && e.target.value !== due) onChange(e.target.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onClose();
      }}
    />
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'parked', label: 'Parked' },
  { id: 'promoted', label: 'Promoted' },
  { id: 'dropped', label: 'Dropped' },
];

const KIND_LABEL = Object.fromEntries(CAPTURE_KINDS.map(k => [k.id, k.label])) as Record<CaptureKind, string>;

function ago(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function CapturesPanel({
  captures,
  areas,
  selfItems,
  onAdd,
  onStatus,
  onPromote,
  onAddTask,
  onLogTask,
  onTaskDone,
  onTaskUndo,
  onTaskStar,
  onTaskDue,
  onTaskMove,
}: {
  captures: Capture[];
  areas: FocusArea[];
  selfItems: SelfItem[];
  onAdd: (input: { kind: CaptureKind; title: string; notes: string; url: string; focusAreaId: string }) => void;
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPromote: (capture: Capture) => void;
  onAddTask: (title: string, detail: string, focusAreaId: string, due?: string) => void;
  /** Record something already done (off-site) so it counts */
  onLogTask: (title: string, detail: string, focusAreaId: string, at: string) => void;
  onTaskDone: (id: string) => void;
  onTaskUndo: (id: string) => void;
  onTaskStar: (id: string) => void;
  /** Set or clear a task's optional day */
  onTaskDue: (id: string, due?: string) => void;
  /** Move a task to another site's card */
  onTaskMove?: (id: string, home: string) => void;
}) {
  const { isPinned, addPin, removePin } = usePriorityPins();
  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [area, setArea] = useState('');
  // Open on the inbox only when it has something in it; otherwise on your tasks.
  const [tab, setTab] = useState<Tab>(() => (captures.some(c => c.status === 'inbox') ? 'inbox' : 'tasks'));
  const [doneDay, setDoneDay] = useState(() => localDay());
  const [taskDay, setTaskDay] = useState('');
  const [logged, setLogged] = useState('');
  // The form starts as one line; the kind buttons, link, area and notes open when you click in.
  const [expanded, setExpanded] = useState(false);
  const formOpen = expanded || Boolean(title || url || notes);
  const formRef = useRef<HTMLFormElement>(null);
  // Close only when you click or tab somewhere outside the form (Safari doesn't focus buttons on
  // click, so a blur check would fold the form away mid-tap on "Log done").
  useEffect(() => {
    if (!expanded) return;
    const away = (e: Event) => {
      if (!formRef.current || formRef.current.contains(e.target as Node)) return;
      setExpanded(false);
      // Nothing typed: fold back to a plain "Task" box for next time.
      if (!title && !url && !notes) setKind('task');
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [expanded, title, url, notes]);

  const areaName = (id?: string) => areas.find(a => a.id === id)?.name;
  const [dayFor, setDayFor] = useState<string | null>(null);
  const dayShift = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return localDay(d);
  };
  /** Everything a Self task row used to show as buttons — star, pin, day, move — lives in its right-click / long-press menu. */
  const taskMenu = (t: SelfItem): RowMenuItem[] => [
    { label: t.starred ? 'Unstar' : 'Star', onSelect: () => onTaskStar(t.id), hidden: t.done },
    { label: 'Pin to Priority', onSelect: () => addPin('self', t.id), hidden: t.done || !t.starred || isPinned('self', t.id) },
    { label: 'Take off Priority', onSelect: () => removePin('self', t.id), hidden: t.done || !isPinned('self', t.id) },
    { label: 'Day: today', onSelect: () => onTaskDue(t.id, dayShift(0)), hidden: t.done },
    { label: 'Day: tomorrow', onSelect: () => onTaskDue(t.id, dayShift(1)), hidden: t.done },
    { label: t.due ? 'Change day…' : 'Pick a day…', onSelect: () => setDayFor(t.id), hidden: t.done },
    { label: 'Clear the day', onSelect: () => onTaskDue(t.id, undefined), hidden: t.done || !t.due },
    ...(onTaskMove && !t.done ? MOVE_TO.map(([id, name]) => ({ label: `Move → ${name}`, onSelect: () => onTaskMove(t.id, id) })) : []),
  ];
  // Dated tasks first (soonest first), then the rest in the order they were added.
  // Tasks moved to another site live in that site's card now.
  const mine = selfItems.filter(i => !i.home);
  const allOpen = mine
    .filter(i => !i.done)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.due && b.t.due ? a.t.due.localeCompare(b.t.due) : a.t.due ? -1 : b.t.due ? 1 : a.i - b.i))
    .map(x => x.t);
  // Starred ones sit in their own list above the tabs; Pin there is what sends one to Priority.
  const starredTasks = allOpen.filter(t => t.starred);
  const openTasks = allOpen.filter(t => !t.starred);
  // Finished ones are kept on the Self page, not on the Daily Ops card.
  const counts: Record<Tab, number> = Object.fromEntries(
    TABS.map(t => [t.id, t.id === 'tasks' ? openTasks.length : captures.filter(c => c.status === t.id).length]),
  ) as Record<Tab, number>;
  const visible = tab === 'tasks' ? [] : captures.filter(c => c.status === tab);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (kind === 'log') {
      if (!area) return;
      onLogTask(title, [notes, url].filter(Boolean).join('\n'), area, loggedAt(doneDay));
      setLogged(`Logged “${title.trim()}” · ${areaName(area)}${doneDay < localDay() ? ` · ${shortDay(loggedAt(doneDay))}` : ''}`);
      setDoneDay(localDay());
      setTab('tasks');
    } else if (kind === 'task') {
      onAddTask(title, [notes, url].filter(Boolean).join('\n'), area, taskDay || undefined);
      setTaskDay('');
      setTab('tasks');
    } else {
      onAdd({ kind, title, notes, url, focusAreaId: area });
      setTab('inbox');
    }
    setTitle('');
    setUrl('');
    setNotes('');
    setArea('');
  }

  return (
    <div className="sk-captures" aria-label="Thoughts, ideas, research and tasks">
      <form className={`sk-capform${formOpen ? ' is-open' : ''}`} onSubmit={submit} ref={formRef} onFocus={() => setExpanded(true)}>
        <div className="sk-fc-add">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={
              !formOpen
                ? 'Capture a task or thought'
                : kind === 'task'
                  ? 'What needs doing?'
                  : kind === 'log'
                    ? 'What did you get done?'
                    : "What's the thought, idea, or question?"
            }
            aria-label="Capture title"
          />
          <button type="submit" className="sk-btn is-small" disabled={!title.trim() || (kind === 'log' && !area)}>
            <Icon name="plus" size={14} />
            {!formOpen ? 'Add' : kind === 'task' ? 'Add Task' : kind === 'log' ? 'Log as Done' : 'Capture'}
          </button>
        </div>
        {formOpen ? (
          <>
            <div className="sk-chips" role="group" aria-label="Capture kind">
              {KINDS.map(k => (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={k.id === kind}
                  onClick={() => {
                    setKind(k.id);
                    setLogged('');
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="sk-sec">
              {kind === 'task'
                ? 'Tasks count toward Review when done.'
                : kind === 'log'
                  ? 'Log done records something you already finished off-site.'
                  : 'Thoughts, ideas and research stay off task boards and Balance. Promote one when it becomes a task.'}
            </p>
            <div className="sk-capfields">
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Link (optional)" aria-label="Link" inputMode="url" />
              {kind === 'log' ? (
                <input
                  type="date"
                  value={doneDay}
                  max={localDay()}
                  onChange={e => setDoneDay(e.target.value)}
                  aria-label="Day it was done"
                  title="Day it was done"
                />
              ) : null}
              {kind === 'task' ? (
                <input
                  type="date"
                  value={taskDay}
                  onChange={e => setTaskDay(e.target.value)}
                  aria-label="Day for it (optional)"
                  title="Day for it (optional) — shows on the calendar"
                />
              ) : null}
              <select value={area} onChange={e => setArea(e.target.value)} aria-label="Focus area" required={kind === 'log'}>
                <option value="">{kind === 'log' ? 'Pick an area…' : 'No area'}</option>
                {areas.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" aria-label="Notes" />
          </>
        ) : null}
        {kind === 'log' && logged ? (
          <p className="sk-caplogged" role="status">
            <Icon name="check" size={14} />
            {logged}
          </p>
        ) : null}
      </form>

      {starredTasks.length ? (
        <div className="sk-src-starred" aria-label="Starred Self tasks">
          <ListHead
            title={
              <>
                <Icon name="star" size={14} className="sk-starred" />
                Starred
              </>
            }
            meta={starredTasks.length}
          />
          {starredTasks.map(t => {
            const pinned = isPinned('self', t.id);
            return (
              <SelfTaskRow
                key={t.id}
                t={t}
                items={() => taskMenu(t)}
                onDone={() => onTaskDone(t.id)}
                onUndo={() => onTaskUndo(t.id)}
                sub={
                  pinned ? (
                    <span className="sk-facts">
                      <span className="sk-fact" title="On your Priority list">
                        <Icon name="pin" size={14} />
                        Pinned
                      </span>
                    </span>
                  ) : undefined
                }
              >
                {dayFor === t.id ? <DueInput due={t.due} onChange={due => onTaskDue(t.id, due)} onClose={() => setDayFor(null)} /> : null}
              </SelfTaskRow>
            );
          })}
        </div>
      ) : null}

      <div className="sk-chips sk-captabs" role="tablist" aria-label="Capture status">
        {/* Empty tabs step aside (the open one always shows). */}
        {TABS.filter(t => t.id === tab || t.id === 'inbox' || t.id === 'tasks' || counts[t.id] > 0).map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            {t.label}
            <span className="sk-chipcount">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {tab === 'tasks' ? (
        <div className="sk-list" role="tabpanel" aria-label="Tasks">
          {openTasks.length === 0 ? <p className="sk-empty">No Self tasks yet.</p> : null}
          {openTasks.map(t => (
            <SelfTaskRow
              key={t.id}
              t={t}
              items={() => taskMenu(t)}
              onDone={() => onTaskDone(t.id)}
              onUndo={() => onTaskUndo(t.id)}
              sub={
                <>
                  <span className="sk-facts">
                    {areaName(t.focusAreaId) ? <span>{areaName(t.focusAreaId)}</span> : null}
                    <span>{t.done ? `done · ${shortDay(t.createdAt)}` : ago(t.createdAt)}</span>
                    {t.forEvent ? (
                      <span className="sk-fact">
                        <Icon name="calendar" size={14} />
                        for {t.forEvent.title}
                      </span>
                    ) : null}
                  </span>
                  {t.detail ? <span className="sk-capnote">{t.detail}</span> : null}
                </>
              }
            >
              {dayFor === t.id ? <DueInput due={t.due} onChange={due => onTaskDue(t.id, due)} onClose={() => setDayFor(null)} /> : null}
            </SelfTaskRow>
          ))}
        </div>
      ) : (
        <div className="sk-list" role="tabpanel" aria-label={TABS.find(t => t.id === tab)?.label}>
          {visible.length === 0 ? (
            <p className="sk-empty">{tab === 'inbox' ? 'Inbox clear.' : `Nothing ${tab}.`}</p>
          ) : (
            visible.map(c => {
              const task = c.promotedTo?.source === 'self' ? selfItems.find(i => i.id === c.promotedTo?.taskId) : undefined;
              return (
                <Row
                  key={c.id}
                  className={`sk-capture is-${c.status}`}
                  title={
                    c.url ? (
                      <a className="sk-shelf-link" href={c.url} target="_blank" rel="noopener noreferrer">
                        {c.title}
                        <Icon name="external" size={14} />
                      </a>
                    ) : (
                      c.title
                    )
                  }
                  sub={
                    <>
                      <span className="sk-facts">
                        {areaName(c.focusAreaId) ? <span>{areaName(c.focusAreaId)}</span> : null}
                        <span>{ago(c.createdAt)}</span>
                      </span>
                      {c.notes ? <span className="sk-capnote">{c.notes}</span> : null}
                      {c.status === 'promoted' ? (
                        <span className="sk-capnote">Now a Self task · {task ? (task.done ? 'done' : 'open') : 'removed'}</span>
                      ) : null}
                    </>
                  }
                  value={<Tag>{KIND_LABEL[c.kind]}</Tag>}
                >
                  {c.status === 'inbox' || c.status === 'parked' ? (
                    <div className="sk-ract">
                      <button type="button" className="sk-link" onClick={() => onPromote(c)}>
                        Promote
                      </button>
                      <button type="button" className="sk-link" onClick={() => onStatus(c.id, c.status === 'inbox' ? 'parked' : 'inbox')}>
                        {c.status === 'inbox' ? 'Park' : 'Unpark'}
                      </button>
                      <button type="button" className="sk-link" onClick={() => onStatus(c.id, 'dropped')}>
                        Drop
                      </button>
                    </div>
                  ) : null}
                  {c.status === 'dropped' ? (
                    <div className="sk-ract">
                      <button type="button" className="sk-link" onClick={() => onStatus(c.id, 'inbox')}>
                        Restore
                      </button>
                    </div>
                  ) : null}
                </Row>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** A Self task in the kit row: circle to finish, the day as its value, everything else in the right-click / long-press menu. */
function SelfTaskRow({
  t,
  items,
  sub,
  onDone,
  onUndo,
  children,
}: {
  t: SelfItem;
  items: () => RowMenuItem[];
  sub?: ReactNode;
  onDone: () => void;
  onUndo: () => void;
  children?: ReactNode;
}) {
  const { bind, menu } = useRowMenu(items, t.title);
  const late = Boolean(t.due && !t.done && t.due < localDay());
  return (
    <>
      <Row
        bind={bind}
        className={t.done ? 'is-done' : undefined}
        lead={t.done ? null : <Circle onDone={onDone} label={`Done: ${t.title}`} />}
        title={t.title}
        sub={sub}
        value={t.due ? dueLabel(t.due) : undefined}
        valueTone={late ? 'late' : undefined}
        hint={[t.title, t.detail, 'Right-click or long-press to star, pin, set a day or move'].filter(Boolean).join(' — ')}
      >
        {t.done ? (
          <div className="sk-ract">
            <button type="button" className="sk-link" onClick={onUndo}>
              Undo
            </button>
          </div>
        ) : null}
        {children}
      </Row>
      {menu}
    </>
  );
}
