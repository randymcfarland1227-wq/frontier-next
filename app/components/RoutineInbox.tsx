'use client';

import { useEffect } from 'react';
import { INBOX_GROUPS, setInboxStatus, type InboxItem } from '../../lib/routineInbox';
import { Icon } from '../sticker/Icon';

const md = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

/** One line for Do today: "Needs you · 3 to confirm". */
export function inboxSummary(items: InboxItem[]) {
  const counts = INBOX_GROUPS.map((g) => [g.title.split(' ')[0], items.filter((i) => i.group === g.id).length] as const).filter(([, n]) => n);
  return counts.map(([t, n]) => `${t} ${n}`).join(' · ');
}

/** Pop-out: one list per kind of finding. ✓ = handled, ✕ = dismiss (the daily check won't bring it back). */
export function RoutineInboxPop({ items, close }: { items: InboxItem[]; close: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  useEffect(() => { if (!items.length) close(); }, [items.length, close]);
  const groups = INBOX_GROUPS.map((g) => ({ ...g, rows: items.filter((i) => i.group === g.id) })).filter((g) => g.rows.length);
  const runs = [...new Set(items.map((i) => i.run).filter(Boolean))].sort();
  return (
    <div className="sk-subpop-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sk-subpop sk-inbox" role="dialog" aria-modal="true" aria-label="Needs you: findings to confirm">
        <header className="sk-subpop-head">
          <Icon name="bell" size={15} />
          <b className="sk-subpop-title">Needs you · {items.length} to confirm</b>
          <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={close} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <p className="sk-subpop-from">From the daily Life Hub check{runs.length ? ` (${runs.map(md).join(', ')})` : ''}. ✓ when it’s handled. ✕ to dismiss it so it won’t come back.</p>
        <div className="sk-inbox-lists">
          {groups.map((g) => (
            <section key={g.id} className="sk-inbox-list" data-group={g.id} aria-label={g.title}>
              <h3>{g.title}<span>{g.rows.length}</span></h3>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <div className="sk-inbox-text">
                      <b>{r.title}</b>
                      {r.detail ? <small>{r.detail}</small> : null}
                      {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="sk-inbox-link">Open email <Icon name="external" size={11} /></a> : null}
                    </div>
                    <button type="button" className="sk-inbox-btn is-done" onClick={() => setInboxStatus([r.id], 'done')} aria-label={`Done: ${r.title}`} title="Handled"><Icon name="check" size={13} /></button>
                    <button type="button" className="sk-inbox-btn" onClick={() => setInboxStatus([r.id], 'dismissed')} aria-label={`Dismiss: ${r.title}`} title="Dismiss (won’t come back)"><Icon name="close" size={12} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="sk-inbox-foot">
          <button type="button" className="sk-link" onClick={() => setInboxStatus(items.map((i) => i.id), 'dismissed')}>Dismiss all</button>
        </footer>
      </div>
    </div>
  );
}
