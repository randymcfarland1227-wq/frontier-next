'use client';

import { useState } from 'react';
import { addSelfItem, setSelfHome, setSelfSheet } from '../../lib/adapters/self';
import { saveMoneyEdits } from '../../lib/money';
import { REFRESH_EVENT } from '../../lib/syncNow';

type Status = { kind: 'saving' | 'ok' | 'fail'; text: string };

/**
 * Add a task to Finance tasks. It's saved on Life Hub right away (homed on the Finances card) and
 * also written as a row in the Radall sheet's Task List. Once the sheet has it, the card shows the
 * sheet's row instead (matched by title), so the task appears once.
 */
export function FinanceTaskAdd() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const reset = () => {
    setTitle('');
    setDue('');
    setNote('');
    setOpen(false);
  };
  const add = async (t: string, d: string, n: string) => {
    const [made] = addSelfItem(t, n, d ? { due: d } : undefined);
    setSelfHome(made.id, 'radall');
    setSelfSheet(made.id, 'pending');
    setStatus({ kind: 'saving', text: `Added “${t}” · writing it to the sheet’s Task List…` });
    const res = await saveMoneyEdits([{ tab: 'Task List', appendTask: true, title: t, ...(d ? { due: d } : {}), ...(n ? { note: n } : {}) }]);
    const r = res.results[0];
    if (res.ok && r?.ok) {
      setSelfSheet(made.id, 'written');
      setStatus({
        kind: 'ok',
        text: r.existed
          ? `“${t}” was already on the sheet’s Task List (row ${r.row}) · not added twice ✓`
          : `Added “${t}” · written to the sheet’s Task List, row ${r.row} ✓`,
      });
      window.dispatchEvent(new Event(REFRESH_EVENT));
    } else {
      setSelfSheet(made.id, 'failed');
      const why = r?.error || res.error || 'no answer';
      setStatus({ kind: 'fail', text: `Added “${t}” on Life Hub only · NOT written to the sheet (${why}). Add it to the Task List by hand.` });
    }
  };
  const statusLine = status && (
    <p className={`mb-saved${status.kind === 'fail' ? ' is-fail' : ''}`} role="status">
      {status.text}
    </p>
  );
  if (!open)
    return (
      <div className="fin-task-add">
        <button type="button" className="sk-btn is-small is-prominent" onClick={() => { setStatus(null); setOpen(true); }}>
          + Add finance task
        </button>
        {statusLine}
      </div>
    );
  return (
    <form
      className="sub-form fin-task-add"
      onSubmit={e => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        void add(t, due, note.trim());
        reset();
      }}
      onKeyDown={e => e.key === 'Escape' && reset()}
    >
      <label className="sub-form-wide">
        <span>Task</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Call Fortiva about the late fee" required />
      </label>
      <label>
        <span>Day (optional)</span>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} />
      </label>
      <label className="sub-form-wide">
        <span>Note</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
      </label>
      <div className="sub-form-actions">
        <button type="submit" className="sk-btn is-small is-prominent">Add task</button>
        <button type="button" className="sk-btn is-small" onClick={reset}>Cancel</button>
      </div>
      <p className="sub-form-wide fin-task-hint">Also written as a row on the Radall sheet’s Task List.</p>
    </form>
  );
}
