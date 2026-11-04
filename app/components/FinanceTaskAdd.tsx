'use client';

import { useState } from 'react';
import { addSelfItem, setSelfHome } from '../../lib/adapters/self';

/**
 * Add a task to Finance tasks. It's a Life Hub task homed on the Finances card (synced like Self
 * tasks); the Radall sheet's own Task List isn't written.
 */
export function FinanceTaskAdd() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const reset = () => {
    setTitle('');
    setDue('');
    setNote('');
    setOpen(false);
  };
  if (!open)
    return (
      <div className="fin-task-add">
        <button type="button" className="sk-btn is-small is-prominent" onClick={() => setOpen(true)}>
          + Add finance task
        </button>
      </div>
    );
  return (
    <form
      className="sub-form fin-task-add"
      onSubmit={e => {
        e.preventDefault();
        if (!title.trim()) return;
        const [made] = addSelfItem(title, note, due ? { due } : undefined);
        setSelfHome(made.id, 'radall');
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
    </form>
  );
}
