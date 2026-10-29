'use client';

import { createPortal } from 'react-dom';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  addDays,
  clashes,
  countdown,
  dayKey,
  dayName,
  eventEnd,
  eventStart,
  fromDayKey,
  googleCalendarLink,
  money,
  onDay,
  rangeLabel,
  sameDay,
  startOfDay,
  startOfWeek,
  timeLabel,
  type BillDue,
  type CalEvent,
  type CalTask,
  type ScheduleSnapshot,
} from '../../lib/schedule';
import { MONEY_KINDS } from '../../lib/money';
import { planSlot, usePlans, type Plan } from '../../lib/plans';
import { EVENTS_AHEAD_DAYS, eventDaysAway, eventTone, eventIcon, isAppointmentTitle, listKindOf, setEventMark, useEventMarks, type ListKind } from '../../lib/events';
import { readSaved, writeSaved } from '../../lib/storage';
import { BillsList } from './BillsList';
import { BillPinButton, useBillPin } from './BillControls';
import { useRowMenu } from './RowMenu';
import { BillChangeForm, FlagBadges, billChangeText } from './BillControls';
import { Circle, Dot, Group, ListHead, Row } from '../sticker/kit';
import { Icon } from '../sticker/Icon';
import { isOverdue } from '../../lib/billEdits';
import { CalendarView, type CalItem } from './CalendarView';

const PLAN_COLOR = '#7b4a68';
const EVENT_COLOR = '#b4532a';
const BILL_COLOR = '#a8632a';
const VIEW_KEY = 'lifehub-schedule-view';
const LAYERS_KEY = 'lifehub-schedule-layers';

/** Short tag for a money row: the pay-later provider, or Card / Sub / Bill. */
function moneyTag(due: BillDue) {
  const k = due.bill.kind;
  if (k === 'paylater') return due.bill.notes?.split(' · ')[1] || 'Pay later';
  if (k === 'plan') return 'Planned';
  if (k === 'card') return 'Card';
  if (k === 'sub') return 'Sub';
  return 'Bill';
}
const billColor = (due: BillDue) => (due.bill.kind ? MONEY_KINDS[due.bill.kind].color : BILL_COLOR);
const TASK_COLOR = '#2f6f6a';

/** Default day for a prep task: the day before the event (or the event day if that's already past). */
function prepDefault(eventDay: string) {
  const before = dayKey(addDays(fromDayKey(eventDay), -1));
  return before >= dayKey(new Date()) ? before : eventDay;
}

/** Prep tasks under an event / maybe-plan ("Change oil" before the game), with a quick add. */
function PrepList({
  target,
  tasks,
  onAdd,
  onDone,
}: {
  target: { id: string; title: string; date: string };
  tasks: CalTask[];
  onAdd?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
  onDone?: (t: CalTask) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => prepDefault(target.date));
  if (!onAdd && !tasks.length) return null;
  return (
    <div className="sk-prep">
      {tasks.length ? (
        <ul className="sk-prep-list">
          {tasks.map(t => (
            <li key={t.id} className={t.done ? 'is-done' : ''}>
              <label className="sk-check">
                <input type="checkbox" checked={t.done} disabled={!onDone || !t.selfId} onChange={() => onDone?.(t)} />
                <span>{t.title}</span>
              </label>
              <span className="sk-cap">{t.date === target.date ? 'Same day' : dayName(fromDayKey(t.date))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {onAdd ? (
        adding ? (
          <form
            className="sk-form is-inline"
            onSubmit={e => {
              e.preventDefault();
              if (!title.trim()) return;
              onAdd(target, title.trim(), due || undefined);
              setTitle('');
              setAdding(false);
            }}
          >
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing first? e.g. Change oil" aria-label="Prep task" />
            <input type="date" value={due} max={target.date} onChange={e => setDue(e.target.value)} aria-label="Do it by" title="Do it by" />
            <button type="submit" className="sk-btn is-small" disabled={!title.trim()}>
              Add
            </button>
            <button type="button" className="sk-btn is-small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="sk-link" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Prep Task{tasks.length ? '' : ' (something to do before this)'}
          </button>
        )
      ) : null}
    </div>
  );
}

type Slot = { start: string; end: string; allDay?: boolean };

/** "Clashes with Dentist (2–3pm)" / "Free then" — how a maybe fits the confirmed schedule. */
function fitText(slot: Slot, events: CalEvent[], ignoreId?: string) {
  const hits = clashes(slot, events, ignoreId);
  if (hits.length) {
    const first = hits[0];
    return {
      tone: 'is-clash',
      text: `Clashes with ${first.title} (${rangeLabel(first)})${hits.length > 1 ? ` +${hits.length - 1} more` : ''}`,
    };
  }
  const day = sameDay(slot, events, ignoreId);
  if (slot.allDay) {
    return day.length
      ? { tone: 'is-busy', text: `That day: ${day.slice(0, 2).map(e => `${e.title}${e.allDay ? '' : ` ${timeLabel(eventStart(e))}`}`).join(', ')}${day.length > 2 ? ` +${day.length - 2}` : ''}` }
      : { tone: 'is-free', text: 'Nothing else that day' };
  }
  return { tone: 'is-free', text: day.length ? `Free then · ${day.length} other thing${day.length === 1 ? '' : 's'} that day` : 'Free then · nothing else that day' };
}

function whenText(slot: Slot) {
  return `${dayName(eventStart(slot))}${slot.allDay ? '' : ` · ${rangeLabel(slot)}`}`;
}

const isConfirmed = (e: CalEvent) => e.myStatus === 'owner' || e.myStatus === 'yes';
const isUnanswered = (e: CalEvent) => e.myStatus === 'invited' || e.myStatus === 'maybe';

function PlanForm({ onDone, date: initialDate }: { onDone: () => void; date?: string }) {
  const { add } = usePlans();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => initialDate || dayKey(new Date()));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    add({ title, date, from, to, note });
    onDone();
  };
  return (
    <form
      className="sk-form"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
    >
      <label className="sk-field is-wide">
        <span>What</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Jess's birthday dinner" required />
      </label>
      <label className="sk-field">
        <span>Day</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </label>
      <label className="sk-field">
        <span>From</span>
        <input type="time" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label className="sk-field">
        <span>To</span>
        <input type="time" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <label className="sk-field is-wide">
        <span>Who asked / notes</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
      </label>
      <div className="sk-form-actions">
        <button type="submit" className="sk-btn is-small">
          Add maybe
        </button>
        <button type="button" className="sk-btn is-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "TOM" / "SAT" over "Oct 24": a narrow date column so the bill names get the room. */
/** "Today" / "Tomorrow" / "Thu 29" — the day part of a row's subtitle. */
function shortDay(k: string) {
  const d = fromDayKey(k);
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${d.toLocaleDateString([], { weekday: 'short' })} ${d.getDate()}`;
}

/** How far off an event is, for the trailing value. */
function awayText(days: number) {
  return days < 0 ? 'Now' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}

/** The item's own colour (Google calendar, bill kind, task) as the row's lead. */
function EvDot({ color }: { color?: string }) {
  return <span className="sk-evdot" style={color ? ({ '--ev': color } as React.CSSProperties) : undefined} aria-hidden="true" />;
}

/** A bill in Upcoming: name, kind, amount. Pay ↗ / Pin live on right-click (long-press). */
function UpcomingBill({ due, onShow }: { due: BillDue; onShow: (date: string) => void }) {
  const pin = useBillPin(due);
  const { bind, menu } = useRowMenu(
    () => [
      { label: 'Pay ↗', href: due.bill.payUrl, hidden: !due.bill.payUrl },
      { label: pin.pinned ? 'Unpin from Doing now' : 'Pin to Doing now', onSelect: pin.toggle, on: pin.pinned, hidden: due.skipped },
    ],
    due.bill.name,
  );
  const b = due.bill;
  return (
    <>
      <Row
        bind={bind}
        className={due.skipped ? 'is-skipped' : undefined}
        lead={<EvDot color={billColor(due)} />}
        title={b.name}
        sub={[
          shortDay(due.due),
          due.skipped ? ['Skipped', due.editNote].filter(Boolean).join(' · ') : moneyTag(due),
          b.payBy ? `Pay by ${fromDayKey(b.payBy).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        value={money(b.amount)}
        valueTone="amt"
        hint={[moneyTag(due), b.name, money(b.amount), b.notes, 'Right-click or long-press for Pay and Pin'].filter(Boolean).join(' · ')}
        onOpen={() => onShow(due.due)}
      />
      {menu}
    </>
  );
}

/** Upcoming: the next 7 days as one list. With `bills` / `tasks`, those sit on their due day too. */
function Upcoming({
  events,
  bills,
  tasks,
  schedule,
  onShow,
  limit = 8,
}: {
  events: CalEvent[];
  bills?: BillDue[];
  tasks?: CalTask[];
  schedule: ScheduleSnapshot | null;
  onShow: (date: string, id?: string) => void;
  limit?: number;
}) {
  const today = startOfDay(new Date());
  const now = new Date();
  const weekOut = addDays(today, 8);
  type UpRow = { key: string; day: string; sort: number; event?: CalEvent; bill?: BillDue; task?: CalTask };
  const rows: UpRow[] = events
    .filter(e => isConfirmed(e) && eventEnd(e) > now && eventStart(e) < weekOut)
    .map(e => {
      const day = dayKey(eventStart(e) < today ? today : eventStart(e));
      return { key: e.id, day, sort: e.allDay ? 0 : eventStart(e).getTime(), event: e };
    });
  // Bills due this week. Past ones aren't here: unpaid ones are in Overdue below.
  for (const b of bills || []) {
    if (b.days > 7 || b.days < 0) continue;
    rows.push({ key: b.key, day: b.due, sort: -1, bill: b });
  }
  for (const t of tasks || []) {
    if (t.done) continue;
    const d = fromDayKey(t.date);
    if (d < today || d >= weekOut) continue;
    rows.push({ key: `task:${t.id}`, day: t.date, sort: -2, task: t });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.sort - b.sort);

  if (!rows.length) {
    return <p className="sk-empty">{schedule ? 'Nothing coming up this week.' : 'Shows your next 7 days once Google Calendar is connected.'}</p>;
  }
  return (
    <>
      {rows.slice(0, limit).map(r =>
        r.task ? (
          <Row
            key={r.key}
            lead={<Icon name="todo" size={14} />}
            title={r.task.title}
            sub={[shortDay(r.day), 'Task', r.task.forEvent ? `for ${r.task.forEvent.title}` : ''].filter(Boolean).join(' · ')}
            onOpen={() => onShow(r.day)}
          />
        ) : r.event ? (
          <Row
            key={r.key}
            lead={<EvDot color={r.event.color} />}
            title={r.event.title}
            sub={`${shortDay(r.day)} · ${r.event.allDay ? 'All day' : timeLabel(eventStart(r.event))}`}
            onOpen={() => onShow(r.day, r.event!.id)}
          />
        ) : (
          <UpcomingBill key={r.key} due={r.bill!} onShow={onShow} />
        ),
      )}
      {rows.length > limit ? <p className="sk-sec sk-sched-more">{rows.length - limit} more this week — open a day on the calendar.</p> : null}
    </>
  );
}

/** Short date for an Events row: "Sat, Oct 11" or "Fri, Oct 10 – Sun, Oct 12" for multi-day. */
function eventDates(slot: Slot) {
  const fmt = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const start = eventStart(slot);
  // All-day ends are exclusive (the day after); timed ends are the real end.
  // (a party ending at midnight is still one day)
  const last = slot.allDay ? addDays(fromDayKey(slot.end.slice(0, 10)), -1) : new Date(eventEnd(slot).getTime() - 1);
  const multi = dayKey(last) > dayKey(start);
  return `${fmt(start)}${multi ? ` – ${fmt(last)}` : slot.allDay ? '' : ` · ${timeLabel(start)}`}`;
}

function EventForm({ onDone, appt }: { onDone: () => void; appt?: boolean }) {
  const { addEvent } = usePlans();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    addEvent({ title, date, endDate, note, kind: appt ? 'appointment' : 'event' });
    onDone();
  };
  return (
    <form
      className="sk-form"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
    >
      <label className="sk-field is-wide">
        <span>{appt ? 'Appointment' : 'Event'}</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={appt ? 'e.g. Dentist — cleaning' : 'e.g. Trip to Morgantown'} required />
      </label>
      <label className="sk-field">
        <span>{appt ? 'Date' : 'From'}</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </label>
      {appt ? null : (
        <label className="sk-field">
          <span>To (optional)</span>
          <input type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
        </label>
      )}
      <label className="sk-field is-wide">
        <span>Note</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={appt ? 'Time, place — optional' : 'Optional'} />
      </label>
      <div className="sk-form-actions">
        <button type="submit" className="sk-btn is-small">
          {appt ? 'Add appointment' : 'Add event'}
        </button>
        <button type="button" className="sk-btn is-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Events: trips, parties, showers, appointments… over the next few months, apart from the
 * everyday calendar. Google events are picked automatically (see lib/events.ts); Remove (right-click)
 * hides one, ☆ in a day's pop-out adds one, and Add Event covers things not in Google Calendar.
 */
type EvRow = { id: string; title: string; slot: Slot; note?: string; url?: string; plan?: Plan };

function EventsList({
  list = 'event',
  title,
  events,
  plans,
  onShow,
  onDropPlan,
}: {
  list?: ListKind;
  title: string;
  events: CalEvent[];
  plans: Plan[];
  onShow: (date: string, id?: string) => void;
  onDropPlan: (p: Plan) => void;
}) {
  const marks = useEventMarks();
  const appt = list === 'appt';
  const [adding, setAdding] = useState(false);
  const now = new Date();
  const horizon = addDays(startOfDay(now), EVENTS_AHEAD_DAYS);
  const rows: EvRow[] = [
    ...events
      .filter(e => listKindOf(e, marks) === list && eventEnd(e) > now && eventStart(e) < horizon)
      .map(e => ({ id: e.id, title: e.title, slot: e as Slot, note: e.location, url: e.url })),
    ...plans
      .filter(p => (p.kind === 'appointment' ? 'appt' : p.kind) === list && p.status === 'yes')
      .map(p => ({ id: p.id, title: p.title, slot: planSlot(p) as Slot, note: p.note, plan: p }))
      .filter(r => eventEnd(r.slot) > now && eventStart(r.slot) < horizon),
  ].sort((a, b) => eventStart(a.slot).getTime() - eventStart(b.slot).getTime());

  return (
    <>
      <ListHead title={title} meta={rows.length || undefined}>
        <button type="button" className="sk-link" onClick={() => setAdding(true)} aria-expanded={adding}>
          <Icon name="plus" size={14} />
          {appt ? 'Add Appointment' : 'Add Event'}
        </button>
      </ListHead>
      {adding ? <EventForm appt={appt} onDone={() => setAdding(false)} /> : null}
      {rows.length
        ? rows.map(r => <EventRow key={r.id} r={r} appt={appt} now={now} onShow={onShow} onDropPlan={onDropPlan} />)
        : adding
          ? null
          : <p className="sk-empty">{appt ? 'No appointments coming up.' : 'No trips or events coming up. Add one, or press ☆ on anything in a day\'s pop-out.'}</p>}
    </>
  );
}

function EventRow({ r, appt, now, onShow, onDropPlan }: { r: EvRow; appt: boolean; now: Date; onShow: (date: string, id?: string) => void; onDropPlan: (p: Plan) => void }) {
  const start = eventStart(r.slot);
  const where = appt ? 'Appointments' : 'Events';
  const { bind, menu } = useRowMenu(
    () => [
      { label: 'Add to Google Calendar ↗', href: googleCalendarLink({ title: r.title, ...r.slot, details: r.note }), hidden: !r.plan },
      { label: `Remove from ${where}`, danger: true, onSelect: () => (r.plan ? onDropPlan(r.plan) : setEventMark(r.id, 'hide')) },
    ],
    r.title,
  );
  return (
    <>
      <Row
        bind={bind}
        className={eventTone(start, now) || undefined}
        lead={
          <span className="sk-emoji" aria-hidden="true">
            {eventIcon(r.title)}
          </span>
        }
        title={r.title}
        sub={eventDates(r.slot)}
        value={awayText(eventDaysAway(start, now))}
        hint={[r.title, r.note, 'Right-click or long-press for more'].filter(Boolean).join(' — ')}
        onOpen={() => onShow(dayKey(start < startOfDay(now) ? now : start), r.id)}
      />
      {menu}
    </>
  );
}

/** Bills past their day and not marked paid (or skipped): one summary row under Upcoming that opens the list. */
function Overdue({ bills, onBillPaid }: { bills: BillDue[]; onBillPaid: (due: BillDue) => void }) {
  const overdue = bills.filter(isOverdue);
  const [folded, setFolded] = useState(() => readSaved<boolean>('lifehub-overdue-folded', false));
  const [changing, setChanging] = useState<string | null>(null);
  if (!overdue.length) return null;
  const total = overdue.reduce((sum, d) => sum + (d.bill.amount || 0), 0);
  return (
    <>
      <Row
        className={`sk-overdue${folded ? '' : ' is-open'}`}
        bind={{ 'aria-expanded': !folded }}
        lead={<Dot tone="alert" />}
        title={`${overdue.length} overdue ${overdue.length === 1 ? 'bill' : 'bills'}`}
        sub="Not marked paid"
        value={money(total)}
        valueTone="late"
        hint={folded ? 'Show overdue items' : 'Hide overdue items'}
        onOpen={() => {
          writeSaved('lifehub-overdue-folded', !folded);
          setFolded(!folded);
        }}
      />
      {folded
        ? null
        : overdue.map(d => (
            <OverdueBill key={d.key} d={d} onPaid={onBillPaid} changing={changing === d.key} setChanging={on => setChanging(on ? d.key : null)} />
          ))}
    </>
  );
}

function OverdueBill({ d, onPaid, changing, setChanging }: { d: BillDue; onPaid: (due: BillDue) => void; changing: boolean; setChanging: (on: boolean) => void }) {
  const pin = useBillPin(d);
  const { bind, menu } = useRowMenu(
    () => [
      { label: 'Pay ↗', href: d.bill.payUrl, hidden: !d.bill.payUrl || d.skipped },
      { label: 'Mark paid', onSelect: () => onPaid(d), hidden: d.skipped },
      { label: pin.pinned ? 'Unpin from Doing now' : 'Pin to Doing now', onSelect: pin.toggle, on: pin.pinned, hidden: d.skipped },
      { label: 'Skip, move or change amount…', onSelect: () => setChanging(true) },
    ],
    d.bill.name,
  );
  const date = fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const late = -d.days;
  return (
    <>
      <Row
        bind={bind}
        className="is-nested"
        lead={d.skipped ? null : <Circle onDone={() => onPaid(d)} label={`Mark ${d.bill.name} paid for ${date}`} />}
        title={d.bill.name}
        sub={
          <>
            {[`${late} ${late === 1 ? 'day' : 'days'} late`, date, billChangeText(d)].filter(Boolean).join(' · ')}
            <FlagBadges d={d} />
          </>
        }
        value={money(d.bill.amount)}
        valueTone="late"
        hint="Right-click or long-press for Pay, Pin, Skip or change"
      >
        {changing ? <BillChangeForm due={d} onDone={() => setChanging(false)} /> : null}
      </Row>
      {menu}
    </>
  );
}

/** Needs to confirm: Google invitations not answered yet + maybe-plans, each with how it fits. */
function MaybeList({
  title,
  invites,
  plans,
  events,
  onShow,
  onAnswer,
}: {
  title: string;
  invites: CalEvent[];
  plans: Plan[];
  events: CalEvent[];
  onShow: (date: string, id?: string) => void;
  onAnswer: (p: Plan, yes: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const today = startOfDay(new Date());
  return (
    <>
      <ListHead title={title} meta={invites.length + plans.length}>
        <button type="button" className="sk-link" onClick={() => setAdding(true)} aria-expanded={adding}>
          <Icon name="plus" size={14} />
          Add Maybe
        </button>
      </ListHead>
      {adding ? <PlanForm onDone={() => setAdding(false)} /> : null}
      {invites.map(e => {
        const fit = fitText(e, events, e.id);
        return (
          <Row
            key={e.id}
            highlight
            lead={<Dot tone="needs" />}
            title={e.title}
            sub={`${whenText(e)} · ${e.myStatus === 'maybe' ? 'You said maybe' : `Invited${e.organizer ? ` by ${e.organizer}` : ''}`}`}
            onOpen={() => onShow(dayKey(eventStart(e)), e.id)}
          >
            <span className="sk-ract">
              <span className={`sk-fit ${fit.tone}`}>{fit.text}</span>
              {e.url ? (
                <a className="sk-btn is-small" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={`Reply to ${e.title} in Google Calendar`}>
                  Reply ↗
                </a>
              ) : null}
            </span>
          </Row>
        );
      })}
      {plans.map(p => {
        const slot = planSlot(p);
        const past = eventEnd(slot) < today;
        const fit = fitText(slot, events);
        return (
          <Row
            key={p.id}
            highlight={!past}
            lead={<Dot tone="needs" />}
            title={p.title}
            sub={`${whenText(slot)}${p.note ? ` · ${p.note}` : ''}`}
            onOpen={() => onShow(p.date, p.id)}
          >
            <span className="sk-ract">
              {past ? <span className="sk-fit is-busy">That date has passed</span> : <span className={`sk-fit ${fit.tone}`}>{fit.text}</span>}
              {past ? null : (
                <button type="button" className="sk-btn is-small" onClick={() => onAnswer(p, true)} title="Opens Google Calendar with it filled in" aria-label={`Yes to ${p.title}: add it to Google Calendar`}>
                  Yes
                </button>
              )}
              <button type="button" className="sk-btn is-small" onClick={() => onAnswer(p, false)} aria-label={past ? `Clear ${p.title}` : `No to ${p.title}`}>
                {past ? 'Clear' : 'No'}
              </button>
            </span>
          </Row>
        );
      })}
      {!invites.length && !plans.length && !adding ? <p className="sk-empty">Nothing waiting on an answer. Add something you&apos;ve been asked to, to see how it fits.</p> : null}
    </>
  );
}

const thisMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/** A small mark after the month's name, like v5's 🎃🦇. */
const MONTH_MARK = ['❄️', '💘', '🍀', '🌷', '🌼', '☀️', '🎆', '🌻', '🍎', '🎃', '🍂', '🎄'];

/** ‹ Today › beside the month name. */
function MonthNav({ setMonth }: { setMonth: (fn: (m: Date) => Date) => void }) {
  return (
    <div className="sk-mnav">
      <button type="button" className="sk-mbtn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Previous month">
        <Icon name="chevron" className="is-flip" />
      </button>
      <button type="button" className="sk-mbtn is-text" onClick={() => setMonth(() => thisMonth())}>
        Today
      </button>
      <button type="button" className="sk-mbtn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Next month">
        <Icon name="chevron" />
      </button>
    </div>
  );
}

type Layers = { google: boolean; money: boolean; tasks: boolean };

/** What the calendar shows: Google events, money due, dated tasks. */
function LayerSeg({ layers, toggle }: { layers: Layers; toggle: (k: keyof Layers) => void }) {
  return (
    <div className="sk-seg sk-layers" role="group" aria-label="Show on the calendar">
      <button type="button" aria-pressed={layers.google} onClick={() => toggle('google')} title="Google Calendar events">
        Google
      </button>
      <button type="button" aria-pressed={layers.money} onClick={() => toggle('money')} title="Bills, card minimums, subscriptions and pay-later from the Radall sheet">
        Money
      </button>
      <button type="button" aria-pressed={layers.tasks} onClick={() => toggle('tasks')} title="Self tasks with a day, and Priority items you gave a day">
        Tasks
      </button>
    </div>
  );
}

/** Month at a glance: up to two lines per day; pick a day to see all of it. */
function MonthMini({ month, items, picked, onPick }: { month: Date; items: CalItem[]; picked?: string; onPick: (day: string, cell: HTMLElement) => void }) {
  const today = dayKey(new Date());
  const start = startOfWeek(month);
  const weeks = Math.ceil((month.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const names = cells.slice(0, 7).map(d => d.toLocaleDateString([], { weekday: 'narrow' }));
  return (
    <div className="sk-mgrid">
      {names.map((n, i) => (
        <span key={i} className="sk-dow" aria-hidden="true">
          {n}
        </span>
      ))}
      {cells.map(d => {
        const k = dayKey(d);
        const dayItems = items
          .filter(it => onDay(it, d))
          .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStart(a).getTime() - eventStart(b).getTime());
        const label = `${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}: ${
          dayItems.length ? `${dayItems.length} thing${dayItems.length === 1 ? '' : 's'}` : 'nothing'
        }`;
        return (
          <button
            key={k}
            type="button"
            className={`sk-day${d.getMonth() !== month.getMonth() ? ' is-other' : ''}${k < today ? ' is-past' : ''}${k === today ? ' is-today' : ''}${k === picked ? ' is-picked' : ''}${
              dayItems.some(i => i.kind === 'plan' || i.kind === 'invite') ? ' has-maybe' : ''
            }`}
            onClick={e => onPick(k, e.currentTarget)}
            aria-label={label}
            aria-haspopup="dialog"
            title={dayItems.map(it => it.title).join('\n') || undefined}
          >
            <span className="sk-dnum">{d.getDate()}</span>
            {/* Two lines per day: two titles, or one title and "+N". */}
            {dayItems.slice(0, dayItems.length > 2 ? 1 : 2).map(it => (
              <span key={it.id} className={`sk-ditem kind-${it.kind}`} style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined}>
                {it.kind === 'bill' ? '$ ' : it.kind === 'task' ? (it.task?.done ? '✓ ' : '☐ ') : ''}
                {it.title}
              </span>
            ))}
            {dayItems.length > 2 ? <span className="sk-ditem is-more">+{dayItems.length - 1} more</span> : null}
            <span className="sk-ddots" aria-hidden="true">
              {dayItems.slice(0, 4).map(it => (
                <i key={it.id} style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pop-out for one day: everything on it, with the same actions as the lists. */
/** ☆ / ★ in a day's pop-out: show this event in Events (or take it out). */
function EventStar({ event }: { event: CalEvent }) {
  const marks = useEventMarks();
  const kind = listKindOf(event, marks);
  const on = kind !== null;
  const name = (kind ?? (isAppointmentTitle(event.title) ? 'appt' : 'event')) === 'appt' ? 'Appointment' : 'Event';
  const listName = name === 'Appointment' ? 'Appointments' : 'Events';
  return (
    <button
      type="button"
      className={`sk-btn is-small${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={() => setEventMark(event.id, on ? 'hide' : name === 'Appointment' ? 'appt' : 'event')}
      title={on ? `In ${listName} — click to take it out` : `Show in ${listName}`}
      aria-label={on ? `Take ${event.title} out of ${listName}` : `Show ${event.title} in ${listName}`}
    >
      {on ? `★ ${name}` : `☆ ${name}`}
    </button>
  );
}

function DayPopover({
  day,
  pos,
  items,
  events,
  plans,
  onAnswer,
  onBillPaid,
  tasks,
  onTaskDone,
  onAddPrep,
  onWeek,
  onClose,
}: {
  day: string;
  pos: { top: number; left: number; above: boolean; maxHeight?: number };
  items: CalItem[];
  events: CalEvent[];
  plans: Plan[];
  onAnswer: (p: Plan, yes: boolean) => void;
  onBillPaid: (due: BillDue) => void;
  tasks: CalTask[];
  onTaskDone?: (t: CalTask) => void;
  onAddPrep?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
  onWeek: (day: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const closeLatest = useRef(onClose);
  useEffect(() => {
    closeLatest.current = onClose;
  }, [onClose]);
  useEffect(() => {
    headRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLatest.current();
    // Close on a click outside (a click on another day re-opens it there).
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.sk-day')) closeLatest.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [day]);

  const date = fromDayKey(day);
  const dayItems = items
    .filter(it => onDay(it, date))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStart(a).getTime() - eventStart(b).getTime());
  const title = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const rel = dayName(date);
  const heading = ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? `${rel} · ${title}` : title;

  void pos;
  const host = typeof document !== 'undefined' ? document.querySelector('.sk-app') || document.querySelector('.frontier-shell') || document.body : null;
  if (!host) return null;
  return createPortal(
    <div className="sk-dialog-back" role="presentation">
      <div ref={ref} className="sk-dialog sk-daypop" role="dialog" aria-modal="true" aria-label={heading}>
        <header className="sk-dialog-head">
          <h3 ref={headRef} tabIndex={-1} className="sk-title">
            {heading}
          </h3>
          <button type="button" className="sk-btn is-small is-icon" onClick={onClose} aria-label="Close day">
            <Icon name="close" />
          </button>
        </header>
        {dayItems.length ? (
          dayItems.map(it => {
            const plan = it.kind === 'plan' ? plans.find(p => p.id === it.id) : undefined;
            const fit = it.kind === 'plan' || it.kind === 'invite' ? fitText(it, events, it.id) : null;
            const calEvent = it.kind === 'event' ? events.find(e => e.id === it.id) : undefined;
            const when = it.kind === 'bill' ? 'Bill' : it.kind === 'task' ? 'Task' : it.allDay ? 'All day' : rangeLabel(it);
            const sub =
              it.kind === 'bill' && it.bill
                ? [when, money(it.bill.bill.amount), it.bill.bill.notes, it.bill.bill.kind && it.bill.days < 0 ? 'Earlier' : countdown(it.bill.days), it.bill.bill.autopay ? 'Autopay' : '']
                : [when, it.sub];
            return (
              <Row key={it.id} className={`kind-${it.kind}`} highlight={Boolean(fit)} lead={<EvDot color={it.color} />} title={it.title} sub={sub.filter(Boolean).join(' · ')}>
                <span className="sk-ract">
                  {fit ? <span className={`sk-fit ${fit.tone}`}>{fit.text}</span> : null}
                  {plan ? (
                    <>
                      <button type="button" className="sk-btn is-small" onClick={() => onAnswer(plan, true)} aria-label={`Yes to ${plan.title}: add it to Google Calendar`}>
                        Yes
                      </button>
                      <button type="button" className="sk-btn is-small" onClick={() => onAnswer(plan, false)} aria-label={`No to ${plan.title}`}>
                        No
                      </button>
                    </>
                  ) : null}
                  {it.kind === 'bill' && it.bill ? (
                    <>
                      {it.url ? (
                        <a className="sk-btn is-small" href={it.url} target="_blank" rel="noopener noreferrer" aria-label={`Pay ${it.title}`}>
                          Pay ↗
                        </a>
                      ) : null}
                      <button type="button" className="sk-btn is-small" onClick={() => onBillPaid(it.bill!)} aria-label={`Mark ${it.title} paid`}>
                        Paid
                      </button>
                      <BillPinButton due={it.bill} className="sk-btn is-small" />
                    </>
                  ) : null}
                  {it.kind === 'task' && it.task?.selfId && onTaskDone ? (
                    <button type="button" className="sk-btn is-small" onClick={() => onTaskDone(it.task!)}>
                      {it.task.done ? 'Undo' : 'Done'}
                    </button>
                  ) : null}
                  {calEvent ? <EventStar event={calEvent} /> : null}
                  {(it.kind === 'event' || it.kind === 'invite') && it.url ? (
                    <a className="sk-btn is-small" href={it.url} target="_blank" rel="noopener noreferrer" aria-label={`${it.kind === 'invite' ? 'Reply to' : 'Open'} ${it.title} in Google Calendar`}>
                      {it.kind === 'invite' ? 'Reply ↗' : 'Open ↗'}
                    </a>
                  ) : null}
                </span>
                {it.kind === 'event' || it.kind === 'invite' || it.kind === 'plan' ? (
                  <PrepList
                    target={{ id: it.id, title: it.title, date: dayKey(eventStart(it)) }}
                    tasks={tasks.filter(t => t.forEvent?.id === it.id)}
                    onAdd={onAddPrep}
                    onDone={onTaskDone}
                  />
                ) : null}
              </Row>
            );
          })
        ) : (
          <p className="sk-empty">Nothing planned this day.</p>
        )}
        {adding ? (
          <PlanForm date={day} onDone={() => setAdding(false)} />
        ) : (
          <div className="sk-dfoot">
            <button type="button" className="sk-link" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              Add Maybe This Day
            </button>
            <button type="button" className="sk-btn is-small" onClick={() => onWeek(day)}>
              See the Week
              <Icon name="chevron" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>,
    host,
  );
}

/**
 * Schedule, at the very top. Default view: Upcoming | Needs to confirm | month calendar (pick a
 * day for a pop-out). Expanded view: the rail (Coming up, Not confirmed yet, Bills due) beside a
 * week / month calendar with times.
 */
export function ScheduleSection({
  schedule,
  bills,
  onBillPaid,
  tasks = [],
  onTaskDone,
  onAddPrep,
}: {
  schedule: ScheduleSnapshot | null;
  bills: BillDue[];
  onBillPaid: (due: BillDue) => void;
  /** Dated Self tasks and Priority items (calendar only) */
  tasks?: CalTask[];
  onTaskDone?: (t: CalTask) => void;
  onAddPrep?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
}) {
  const { plans, update } = usePlans();
  const [expanded, setExpanded] = useState(() => readSaved<string>(VIEW_KEY, 'compact') === 'expanded');
  const [selected, setSelected] = useState<CalItem | null>(null);
  const [focus, setFocus] = useState<{ date: string; nonce: number } | undefined>();
  const [pop, setPop] = useState<{ day: string; top: number; left: number; above: boolean; maxHeight?: number } | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const [layers, setLayers] = useState(() => ({ tasks: true, ...readSaved<{ google: boolean; money: boolean; tasks?: boolean }>(LAYERS_KEY, { google: true, money: true }) }));
  const toggleLayer = (k: keyof Layers) =>
    setLayers(l => {
      const next = { ...l, [k]: !l[k] };
      writeSaved(LAYERS_KEY, next);
      return next;
    });
  const monthBox = useRef<HTMLDivElement>(null);
  const events = useMemo(() => (layers.google ? schedule?.events || [] : []), [schedule, layers.google]);
  const shownBills = useMemo(() => (layers.money ? bills : []), [bills, layers.money]);
  const shownTasks = useMemo(() => (layers.tasks ? tasks : []), [tasks, layers.tasks]);
  const today = startOfDay(new Date());

  const openPlans = plans.filter(p => p.status === 'open').sort((a, b) => a.date.localeCompare(b.date) || (a.from || '').localeCompare(b.from || ''));
  const invites = events.filter(e => isUnanswered(e) && eventEnd(e) >= today).sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());

  const items: CalItem[] = useMemo(() => {
    const out: CalItem[] = events.map(e => ({
      id: e.id,
      kind: isUnanswered(e) ? 'invite' : 'event',
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      color: e.color,
      url: e.url,
      sub: [e.calendar, e.location, e.myStatus === 'invited' ? `Invited${e.organizer ? ` by ${e.organizer}` : ''}` : e.myStatus === 'maybe' ? 'You said maybe' : '']
        .filter(Boolean)
        .join(' · '),
    }));
    for (const p of plans.filter(p => p.status === 'open')) {
      out.push({ id: p.id, kind: 'plan', title: p.title, ...planSlot(p), color: PLAN_COLOR, sub: p.note });
    }
    // Events added on Life Hub (Schedule → Events) sit on the calendar like confirmed events.
    for (const p of plans.filter(p => (p.kind === 'event' || p.kind === 'appointment') && p.status === 'yes')) {
      out.push({ id: p.id, kind: 'event', title: p.title, ...planSlot(p), color: EVENT_COLOR, sub: ['Added on Life Hub', p.note].filter(Boolean).join(' · ') });
    }
    for (const b of shownBills) {
      out.push({
        id: b.key,
        kind: 'bill',
        title: b.bill.name,
        start: b.due,
        end: dayKey(addDays(fromDayKey(b.due), 1)),
        allDay: true,
        color: billColor(b),
        url: b.bill.payUrl,
        sub: b.bill.notes,
        bill: b,
      });
    }
    for (const t of shownTasks) {
      out.push({
        id: `task:${t.id}`,
        kind: 'task',
        title: t.title,
        start: t.date,
        end: dayKey(addDays(fromDayKey(t.date), 1)),
        allDay: true,
        color: TASK_COLOR,
        sub: [t.kind === 'priority' ? `Priority${t.sourceName ? ` · ${t.sourceName}` : ''}` : 'Self task', t.forEvent ? `for ${t.forEvent.title}` : '']
          .filter(Boolean)
          .join(' · '),
        task: t,
      });
    }
    return out;
  }, [events, plans, shownBills, shownTasks]);

  const setView = (next: boolean) => {
    setExpanded(next);
    setPop(null);
    writeSaved(VIEW_KEY, next ? 'expanded' : 'compact');
  };

  /** Open a day's pop-out under (or above) its cell, kept inside the month box. */
  const openDay = (day: string, cell?: HTMLElement | null) => {
    const box = monthBox.current;
    const target = cell || box?.querySelector<HTMLElement>(`.sk-day[aria-label^="${fromDayKey(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}"]`);
    if (!box || !target) {
      setPop({ day, top: 0, left: 0, above: false });
      return;
    }
    // Layout units (offsets), not screen pixels: the page zoom (Auto 112% / 125%) would skew them.
    let x = 0;
    let y = 0;
    for (let el: HTMLElement | null = target; el && el !== box; el = el.offsetParent as HTMLElement | null) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    const width = Math.min(360, box.offsetWidth);
    const left = Math.max(0, Math.min(x + target.offsetWidth / 2 - width / 2, box.offsetWidth - width));
    // Open toward the roomier side and stay inside the calendar box (scrolls if it's a busy day).
    const below = box.offsetHeight - (y + target.offsetHeight) - 12;
    const above = y - 12 > below;
    const room = Math.max(200, above ? y - 12 : below);
    setPop({ day, left, top: above ? y - 6 : y + target.offsetHeight + 6, above, maxHeight: room });
  };

  // From the lists: compact view opens that day's pop-out; expanded view jumps the week there.
  const show = (date: string, id?: string) => {
    if (!expanded) {
      openDay(date);
      return;
    }
    setFocus(f => ({ date, nonce: (f?.nonce || 0) + 1 }));
    if (id) setSelected(items.find(i => i.id === id) || null);
  };

  const answer = (p: Plan, yes: boolean) => {
    if (yes) window.open(googleCalendarLink({ title: p.title, ...planSlot(p), details: p.note }), '_blank', 'noopener');
    update(p.id, { status: yes ? 'yes' : 'no' });
    if (selected?.id === p.id) setSelected(null);
  };

  const selPlan = selected?.kind === 'plan' ? plans.find(p => p.id === selected.id) : undefined;
  const selEvent = selected && (selected.kind === 'event' || selected.kind === 'invite') ? events.find(e => e.id === selected.id) : undefined;

  const sync = schedule ? `Google Calendar · updated ${new Date(schedule.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Google Calendar not connected yet';
  const dropPlan = (p: Plan) => update(p.id, { status: 'dropped' });

  return (
    <Group
      tone="sched"
      icon="calendar"
      title="Calendar"
      meta={sync}
      className={`sk-sched${expanded ? ' is-expanded' : ''}`}
      actions={
        <>
          {expanded ? <LayerSeg layers={layers} toggle={toggleLayer} /> : null}
          <button type="button" className="sk-btn is-small" onClick={() => setView(!expanded)} aria-pressed={expanded}>
            {expanded ? 'Month View' : 'Week View'}
          </button>
        </>
      }
    >
      {!expanded ? (
        <div className="sk-sched-grid">
          <div className="sk-col">
            <ListHead title="Upcoming" meta="Next 7 days" />
            <Upcoming events={events} bills={shownBills} tasks={shownTasks} schedule={schedule} onShow={show} limit={16} />
            <Overdue bills={bills} onBillPaid={onBillPaid} />
          </div>
          <div className="sk-col">
            <MaybeList title="Needs to Confirm" invites={invites} plans={openPlans} events={events} onShow={show} onAnswer={answer} />
            <EventsList title="Events" events={events} plans={plans} onShow={show} onDropPlan={dropPlan} />
            <EventsList list="appt" title="Appointments" events={events} plans={plans} onShow={show} onDropPlan={dropPlan} />
          </div>
          <div className="sk-month" ref={monthBox}>
            <div className="sk-mtop">
              <h3 className="sk-mtitle" aria-live="polite">
                {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
                <span aria-hidden="true"> {MONTH_MARK[month.getMonth()]}</span>
              </h3>
              <MonthNav
                setMonth={fn => {
                  setPop(null);
                  setMonth(fn);
                }}
              />
            </div>
            <LayerSeg layers={layers} toggle={toggleLayer} />
            {!schedule ? <p className="sk-mnote">Google Calendar isn&apos;t connected yet — maybes and bills still show.</p> : null}
            <MonthMini month={month} items={items} picked={pop?.day} onPick={openDay} />
            {pop ? (
              <DayPopover
                key={pop.day}
                day={pop.day}
                pos={pop}
                items={items}
                events={events}
                plans={plans}
                onAnswer={answer}
                onBillPaid={onBillPaid}
                tasks={tasks}
                onTaskDone={onTaskDone}
                onAddPrep={onAddPrep}
                onWeek={day => {
                  setView(true);
                  setFocus(f => ({ date: day, nonce: (f?.nonce || 0) + 1 }));
                }}
                onClose={() => setPop(null)}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="sched-grid">
          <aside className="sched-rail sk-col" aria-label="Coming up, events, not confirmed, bills">
            <ListHead title="Coming Up" meta="Next 7 days" />
            <Upcoming events={events} schedule={schedule} onShow={show} />
            <Overdue bills={bills} onBillPaid={onBillPaid} />
            <EventsList title="Events" events={events} plans={plans} onShow={show} onDropPlan={dropPlan} />
            <EventsList list="appt" title="Appointments" events={events} plans={plans} onShow={show} onDropPlan={dropPlan} />
            <MaybeList title="Not Confirmed Yet" invites={invites} plans={openPlans} events={events} onShow={show} onAnswer={answer} />
            <ListHead title="Money Due" meta="From the Radall sheet" />
            <BillsList
              dues={shownBills.filter(b => b.days >= 0 && b.days <= 14)}
              onPaid={onBillPaid}
              compact
              limit={5}
              empty={schedule ? 'No bills due in the next two weeks.' : 'Shows bills from the Finances "Bills" tab once it’s connected.'}
            />
          </aside>

          <div className="sched-cal">
            {selected ? (
              <div className={`cal-detail kind-${selected.kind}`} style={selected.color ? ({ '--ev': selected.color } as React.CSSProperties) : undefined}>
                <div className="cal-detail-main">
                  <strong>{selected.title}</strong>
                  <span>
                    {dayName(eventStart(selected))}
                    {selected.allDay ? '' : ` · ${rangeLabel(selected)}`}
                    {selected.sub ? ` · ${selected.sub}` : ''}
                  </span>
                  {selPlan || selected.kind === 'invite' ? (
                    <span className={`maybe-fit ${fitText(selected, events, selected.id).tone}`}>{fitText(selected, events, selected.id).text}</span>
                  ) : null}
                  {selected.bill ? (
                    <span>{[countdown(selected.bill.days), money(selected.bill.bill.amount)].filter(Boolean).join(' · ')}</span>
                  ) : null}
                  {selected.kind === 'event' || selected.kind === 'invite' || selected.kind === 'plan' ? (
                    <PrepList
                      key={selected.id}
                      target={{ id: selected.id, title: selected.title, date: dayKey(eventStart(selected)) }}
                      tasks={tasks.filter(t => t.forEvent?.id === selected.id)}
                      onAdd={onAddPrep}
                      onDone={onTaskDone}
                    />
                  ) : null}
                </div>
                <div className="cal-detail-actions">
                  {selPlan ? (
                    <>
                      <button type="button" className="sk-btn is-small" onClick={() => answer(selPlan, true)}>
                        Yes — add to Google Calendar
                      </button>
                      <button type="button" className="sk-btn is-small" onClick={() => answer(selPlan, false)}>
                        No
                      </button>
                    </>
                  ) : null}
                  {selected.kind === 'task' && selected.task?.selfId && onTaskDone ? (
                    <button type="button" className="sk-btn is-small" onClick={() => onTaskDone(selected.task!)}>
                      {selected.task.done ? 'Undo' : 'Done'}
                    </button>
                  ) : null}
                  {selEvent?.url ? (
                    <a className="sk-btn is-small" href={selEvent.url} target="_blank" rel="noopener noreferrer">
                      {selected.kind === 'invite' ? 'Reply in Google Calendar ↗' : 'Open in Google Calendar ↗'}
                    </a>
                  ) : null}
                  {selected.bill ? (
                    <>
                      {selected.bill.bill.payUrl ? (
                        <a className="sk-btn is-small" href={selected.bill.bill.payUrl} target="_blank" rel="noopener noreferrer">
                          Pay ↗
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="sk-btn is-small"
                        onClick={() => {
                          onBillPaid(selected.bill!);
                          setSelected(null);
                        }}
                      >
                        Mark paid
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="sk-btn is-small" onClick={() => setSelected(null)} aria-label="Close details">
                    ✕
                  </button>
                </div>
              </div>
            ) : null}
            <CalendarView items={items} focus={focus} connected={Boolean(schedule)} onSelect={setSelected} selectedId={selected?.id} />
          </div>
        </div>
      )}
    </Group>
  );
}
