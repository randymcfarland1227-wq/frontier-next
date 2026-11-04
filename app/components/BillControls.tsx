'use client';

import { useState, type FormEvent } from 'react';
import { fromDayKey, type BillDue } from '../../lib/schedule';
import { billRuleKey, loadBillDays, loadBillEdits, setBillAmount, setBillDay, setBillEdit, setBillEnd, setBillFlags, setBillLevel, setBillName, billLevel, useBillEdits } from '../../lib/billEdits';
import { money } from '../../lib/schedule';
import { loadLifeSubs, updateLifeSub } from '../../lib/lifeSubs';
import { pinKey, updatePinDetails, usePriorityPins } from '../../lib/priorityPins';

/** Writes a this-month change into the sheet's row (registered by life-hub.tsx, which holds the sheet model). */
export type SheetChange = { key: string; amount?: number; date?: string; rename?: string };
let sheetWriter: ((c: SheetChange) => Promise<string>) | undefined;
export function setSheetWriter(fn: ((c: SheetChange) => Promise<string>) | undefined) {
  sheetWriter = fn;
}

const shortDay = (k: string) => fromDayKey(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Delete a bill / subscription for good: every payment from `fromMonth` (YYYY-MM) on. Subscriptions made on
 * Life Hub are removed outright; sheet rows get a hub-side "ended" rule (the sheet isn't written).
 */
export function deleteForGood(bill: { name: string; kind?: string; id?: string }, fromMonth: string) {
  const mine = loadLifeSubs().filter(x => !x.removed && x.name.trim().toLowerCase() === bill.name.trim().toLowerCase());
  mine.forEach(x => updateLifeSub(x.id, { removed: true }));
  if (!(bill.id || '').startsWith('money:lhsub:')) setBillEnd(billRuleKey(bill), fromMonth, bill.name.trim());
}

/** "Skipped · shopping for cheaper" / "Moved from Thu, Oct 10" — what was changed on Life Hub. */
export function billChangeText(d: BillDue): string {
  return [
    d.skipped ? 'Skipped' : '',
    d.orig ? `Moved from ${shortDay(d.orig)}` : '',
    d.everyMonth && !d.orig ? `Due the ${ordinal(d.everyMonth)} each month` : '',
    d.editNote || '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/**
 * Non Critical (overdue shows orange, not red) and Pay by (the last day before a late fee or
 * suspension; it still counts as overdue after the due date). Saved on Life Hub right away (synced);
 * the sheet's "Item Flags" block on the Randy tab sets the starting values.
 */
export function BillFlagsFields({ due, dueKeys }: { due: BillDue; dueKeys?: string[] }) {
  const saved = useBillEdits()[due.key];
  const level = billLevel(due.bill);
  const payBy = saved?.payBy !== undefined ? saved.payBy : due.bill.payBy || '';
  const ruleKey = billRuleKey(due.bill);
  return (
    <div className="bill-flags" role="group" aria-label={`Flags for ${due.bill.name}`}>
      <div className="bill-change-modes bill-level" role="radiogroup" aria-label={`${due.bill.name} level`}>
        {(
          [
            ['normal', 'Normal'],
            ['noncritical', 'Non critical'],
            ['priority', 'Priority'],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={`is-${id}${level === id ? ' is-on' : ''}`}>
            <input type="radio" name={`level-${due.key}`} checked={level === id} onChange={() => setBillLevel(ruleKey, id, [due.key, ...(dueKeys || [])])} />
            {label}
          </label>
        ))}
      </div>
      <small className="bill-level-hint">Every payment of {due.bill.name}: non critical shows orange; priority shows red and goes first.</small>
      <label className="bill-change-field">
        <span>Pay by</span>
        <input type="date" value={payBy} min={due.orig || due.due} onChange={e => setBillFlags(due.key, { payBy: e.target.value })} aria-label={`Pay by date for ${due.bill.name}`} />
      </label>
      {payBy ? (
        <button type="button" className="row-action ghost" onClick={() => setBillFlags(due.key, { payBy: '' })}>
          Clear pay by
        </button>
      ) : null}
    </div>
  );
}

const payByText = (k: string) => fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' });

const payLeft = (k: string) => Math.round((fromDayKey(k).getTime() - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) / 86400000);

/** "Pay by Oct 23" (grace / suspension date after the due date) and "Non critical" chips. */
export function FlagBadges({ d }: { d: BillDue }) {
  if (!d.bill.payBy && !d.bill.nonCritical && !d.bill.priority) return null;
  return (
    <>
      {d.bill.payBy ? (
        <small className={`mny-flag is-payby${payLeft(d.bill.payBy) <= 3 ? ' is-urgent' : ''}`} title="Still overdue after its due date — pay by this day to avoid a late fee or suspension">
          Pay by {payByText(d.bill.payBy)} · {payLeft(d.bill.payBy) < 0 ? 'PASSED' : payLeft(d.bill.payBy) === 0 ? 'TODAY' : `${payLeft(d.bill.payBy)} day${payLeft(d.bill.payBy) === 1 ? '' : 's'} left`}
        </small>
      ) : null}
      {d.bill.priority ? <small className="mny-flag is-priority" title="Priority: pay this one first">Priority</small> : null}
      {d.bill.nonCritical ? <small className="mny-flag is-noncritical" title="Non critical: shown orange when overdue">Non critical</small> : null}
    </>
  );
}

/** Pin this due date to Priority ("Doing now"). Checking it off there marks it paid. */
/** Pin / unpin one bill due date to Doing now (for row menus and the Pin button). */
export function useBillPin(due: BillDue) {
  const { isPinned, addPin, removePin } = usePriorityPins();
  const pinned = isPinned('radall', due.key);
  const toggle = () => {
    if (pinned) return removePin('radall', due.key);
    addPin('radall', due.key);
    // Its due date shows as the item's day in Doing now (and on the calendar)
    updatePinDetails(pinKey('radall', due.key), { due: due.due });
  };
  return { pinned, toggle };
}

export function BillPinButton({ due, className = 'row-action ghost' }: { due: BillDue; className?: string }) {
  const { pinned, toggle } = useBillPin(due);
  return (
    <button
      type="button"
      className={`${className} bill-pin${pinned ? ' is-on' : ''}`}
      aria-pressed={pinned}
      onClick={toggle}
      aria-label={pinned ? `Unpin ${due.bill.name} from Doing now` : `Pin ${due.bill.name} to Doing now`}
      title={pinned ? 'Pinned to Doing now — tap to unpin' : 'Pin to Doing now'}
    >
      {pinned ? 'Pinned' : 'Pin'}
    </button>
  );
}

/**
 * Change one due date of a bill: pay as usual, skip it this time, or move it — plus an amount for
 * this time and a note. Saved on Life Hub (synced), not in the sheet.
 */
export function BillChangeForm({ due, onDone, onGone, hideFlags, onSaved }: { due: BillDue; onDone: () => void; onGone?: () => void; hideFlags?: boolean; /** What was saved and where (shown under the form after Save) */ onSaved?: (msg: string) => void }) {
  const saved = loadBillEdits()[due.key];
  const original = due.orig || due.due;
  const [mode, setMode] = useState<'usual' | 'skip' | 'move'>(saved?.skip ? 'skip' : saved?.moveTo ? 'move' : 'usual');
  const [moveTo, setMoveTo] = useState(saved?.moveTo || original);
  const [amount, setAmount] = useState(saved?.amount !== undefined ? String(saved.amount) : '');
  const [note, setNote] = useState(saved?.note || '');
  const ruleKey = billRuleKey(due.bill);
  const rule = loadBillDays()[ruleKey];
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const everyMonth = scope === 'all';
  const amountOnward = scope === 'all';
  const name = due.bill.name;
  const sheetName = due.bill.origName ?? due.bill.name;
  const [newName, setNewName] = useState(name);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = amount.trim() === '' ? undefined : Number(amount.replace(/[$,]/g, ''));
    // Every month: the bill's day changes from this month on (not just this one payment).
    const repeat = mode === 'move' && everyMonth && moveTo;
    if (repeat) setBillDay(ruleKey, Number(moveTo.slice(8, 10)), original.slice(0, 7));
    const ok = n !== undefined && Number.isFinite(n);
    // Price changed: the new amount is the usual one from this month on (this one included).
    const onward = ok && amountOnward && mode !== 'skip';
    if (onward) setBillAmount(ruleKey, n!, original.slice(0, 7));
    setBillEdit(due.key, {
      skip: mode === 'skip',
      moveTo: mode === 'move' && !repeat && moveTo && moveTo !== original ? moveTo : undefined,
      amount: ok && !onward ? n : undefined,
      note,
    });
    const nm = newName.trim();
    const renamed = Boolean(nm && nm !== name);
    if (renamed) setBillName(ruleKey, nm === sheetName ? null : nm, sheetName);
    // What changed, said back in plain words, and the sheet row updated to match (this month's row).
    const newDay = mode === 'move' && moveTo && moveTo !== original ? moveTo : undefined;
    const newAmt = ok && mode !== 'skip' && n !== due.bill.amount ? n : undefined;
    const parts = [
      nm && nm !== name ? `name → ${nm}` : '',
      newDay ? `due ${shortDay(original)} → ${shortDay(newDay)}${repeat ? ' (every month)' : ''}` : '',
      newAmt !== undefined ? `${money(due.bill.amount) || '?'} → ${money(newAmt)}${onward ? ' (every payment)' : ''}` : '',
      mode === 'skip' ? 'skipped this one' : '',
    ].filter(Boolean);
    const said = parts.length ? `Saved: ${parts.join(' · ')}.` : 'Saved.';
    onDone();
    if (sheetWriter && (newDay || newAmt !== undefined || renamed)) {
      onSaved?.(`${said} Writing it to the sheet…`);
      void sheetWriter({ key: due.key, amount: newAmt, date: newDay, rename: renamed ? nm : undefined }).then(m => onSaved?.(`${said} ${m}`));
    } else onSaved?.(said);
  };

  return (
    <form
      className="bill-change"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
      aria-label={`Change ${name} due ${shortDay(original)}`}
    >
      <p className="bill-change-title">
        {name} · due {shortDay(original)}
      </p>
      <div className="bill-change-modes" role="radiogroup" aria-label="This time">
        {(
          [
            ['usual', 'Pay as usual'],
            ['skip', 'Skip this one'],
            ['move', 'Change the due date'],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={mode === id ? 'is-on' : ''}>
            <input type="radio" name={`mode-${due.key}`} checked={mode === id} onChange={() => setMode(id)} />
            {label}
          </label>
        ))}
      </div>
      {mode !== 'skip' ? (
        <div className="bill-change-modes" role="radiogroup" aria-label="Apply the amount and day to">
          <span className="bill-change-scope">Apply to:</span>
          {(
            [
              ['one', 'This payment only'],
              ['all', 'Every payment from now on'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className={scope === id ? 'is-on' : ''}>
              <input type="radio" name={`scope-${due.key}`} checked={scope === id} onChange={() => setScope(id)} />
              {label}
            </label>
          ))}
        </div>
      ) : null}
      <label className="bill-change-field is-wide">
        <span>Name (every payment, on Life Hub)</span>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={sheetName} />
      </label>
      {due.bill.origName ? (
        <p className="bill-change-rule">
          Renamed on Life Hub — the sheet calls it “{sheetName}”.{' '}
          <button
            type="button"
            className="row-action ghost"
            onClick={() => {
              setBillName(ruleKey, null);
              onDone();
            }}
          >
            Back to the sheet’s name
          </button>
        </p>
      ) : null}
      {mode === 'move' ? (
        <>
          <label className="bill-change-field">
            <span>New day</span>
            <input type="date" value={moveTo} onChange={e => setMoveTo(e.target.value)} required />
          </label>
        </>
      ) : null}
      {rule?.day ? (
        <p className="bill-change-rule">
          Due the {ordinal(rule.day)} every month (changed on Life Hub).{' '}
          <button
            type="button"
            className="row-action ghost"
            onClick={() => {
              setBillDay(ruleKey, null, rule.from);
              onDone();
            }}
          >
            Back to the sheet’s day
          </button>
        </p>
      ) : null}
      {mode !== 'skip' ? (
        <label className="bill-change-field">
          <span>{scope === 'all' ? 'New amount (every payment from now on)' : 'Amount this time'}</span>
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={due.bill.amount !== undefined ? String(due.bill.amount) : 'Same as usual'} />
        </label>
      ) : null}
      {rule?.amount !== undefined ? (
        <p className="bill-change-rule">
          Usual amount ${rule.amount} from {rule.amountFrom} (changed on Life Hub).{' '}
          <button
            type="button"
            className="row-action ghost"
            onClick={() => {
              setBillAmount(ruleKey, null, rule.amountFrom || original.slice(0, 7));
              onDone();
            }}
          >
            Back to the sheet’s amount
          </button>
        </p>
      ) : null}
      <label className="bill-change-field is-wide">
        <span>Note</span>
        <input
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={mode === 'skip' ? 'Why? e.g. Shopping for cheaper insurance' : 'Optional'}
        />
      </label>
      {hideFlags ? null : <BillFlagsFields due={due} />}
      <div className="bill-change-actions">
        <button type="submit" className="row-action">
          Save
        </button>
        <button type="button" className="row-action ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="row-action ghost bill-change-reset"
          title="Takes this payment off every Life Hub list (the sheet isn't changed)"
          onClick={() => {
            if (!window.confirm(`Remove ${name} (${due.due}) from your lists?`)) return;
            setBillEdit(due.key, { removed: true });
            (onGone || onDone)();
          }}
        >
          Remove this payment
        </button>
        <button
          type="button"
          className="row-action ghost bill-change-reset is-danger"
          title="Deletes it from every Life Hub list from this payment on (the sheet isn't changed)"
          onClick={() => {
            if (!window.confirm(`Delete ${name} for good — this payment and every later one?`)) return;
            deleteForGood(due.bill, (due.orig || due.due).slice(0, 7));
            (onGone || onDone)();
          }}
        >
          Delete for good
        </button>
        {saved && (saved.skip || saved.moveTo || saved.amount !== undefined || saved.note) ? (
          <button
            type="button"
            className="row-action ghost bill-change-reset"
            onClick={() => {
              setBillEdit(due.key, null);
              onDone();
            }}
          >
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
