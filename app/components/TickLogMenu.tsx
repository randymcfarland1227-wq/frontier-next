'use client';

import { useEffect, useRef, useState } from 'react';
import type { TaskItem } from '../../lib/types';
import { isHabitTask, logTickTick, LOG_LABEL, type LogOutcome } from '../../lib/ticktickLog';

/** Small "log it" menu on TickTick rows: habits → skipped / not done, tasks → won't do. */
export function TickLogMenu({ task, onDone }: { task: TaskItem; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const habit = isHabitTask(task);
  const options: Array<{ label: string; run: () => void }> = habit
    ? [
        { label: 'Done', run: () => onDone?.() },
        { label: 'Skip today', run: () => void write('skipped') },
        { label: 'Uncompleted', run: () => void write('notdone') },
      ]
    : [
        { label: 'Done', run: () => onDone?.() },
        { label: "Won't do", run: () => void write('wontdo') },
      ];

  async function write(o: LogOutcome) {
    setOpen(false);
    const ok = await logTickTick(task, o);
    if (!ok) {
      setMsg('Not saved to TickTick');
      window.setTimeout(() => setMsg(''), 4000);
    }
  }

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <span className="tlm" ref={ref}>
      <button
        type="button"
        className="row-action ghost tlm-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Log ${task.title}: ${habit ? 'done, skip or not done' : "done or won't do"}`}
        onClick={() => setOpen(v => !v)}
      >
        ⋯
      </button>
      {open ? (
        <span className="tlm-pop" role="menu">
          {options.map(o => (
            <button key={o.label} type="button" role="menuitem" className="tlm-item" onClick={() => { setOpen(false); o.run(); }}>
              {o.label}
            </button>
          ))}
        </span>
      ) : null}
      {msg ? <span className="tlm-msg" role="status">{msg}</span> : null}
    </span>
  );
}

export { LOG_LABEL };
