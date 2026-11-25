'use client';

import { useEffect, useState } from 'react';
import { INBOX_GROUPS, needsYou, replyToInbox, setInboxStatus, type InboxItem } from '../../lib/routineInbox';
import { Icon } from '../sticker/Icon';

const md = (d?: string) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

/** One line for Do today, e.g. "Packages 1 · Sheet 1 · 1 waiting on the daily check". */
export function inboxSummary(items: InboxItem[]) {
  const now = needsYou(items);
  const counts = INBOX_GROUPS.map((g) => [g.title.split(' ')[0], now.filter((i) => i.group === g.id).length] as const).filter(([, n]) => n);
  const waiting = items.length - now.length;
  return [...counts.map(([t, n]) => `${t} ${n}`), waiting ? `${waiting} waiting on the daily check` : ''].filter(Boolean).join(' · ');
}

function Row({ r }: { r: InboxItem }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(r.reply || '');
  const save = () => { replyToInbox(r.id, text); setWriting(false); };
  return (
    <li className={r.status ? `is-${r.status}` : undefined}>
      <div className="sk-inbox-text">
        <b>{r.title}</b>
        {r.detail ? <small>{r.detail}</small> : null}
        {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="sk-inbox-link">Open email <Icon name="external" size={11} /></a> : null}
        {r.reply && !writing ? <p className="sk-inbox-reply"><span>You{r.repliedAt ? ` · ${md(r.repliedAt)}` : ''}</span>{r.reply}</p> : null}
        {r.status === 'replied' && !writing ? <em className="sk-inbox-wait">Waiting for the next daily check</em> : null}
        {r.answer && !writing ? <p className="sk-inbox-answer"><span>Daily check{r.answeredAt ? ` · ${md(r.answeredAt)}` : ''}</span>{r.answer}</p> : null}
        {writing ? (
          <div className="sk-inbox-write">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus placeholder="Tell the daily check what to do, e.g. “Klarna is right, change the sheet to Dec 12, Dec 26, Jan 9.”" aria-label={`Reply about ${r.title}`}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
            <div>
              <button type="button" className="sk-btn is-small" onClick={save} disabled={!text.trim() && !r.reply}>{text.trim() ? 'Send to the daily check' : 'Take reply back'}</button>
              <button type="button" className="sk-link" onClick={() => { setText(r.reply || ''); setWriting(false); }}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
      {r.status === 'answered' ? null : <button type="button" className={`sk-inbox-btn is-reply${r.reply ? ' is-on' : ''}`} onClick={() => setWriting((w) => !w)} aria-label={`${r.reply ? 'Edit reply' : 'Reply'}: ${r.title}`} title={r.reply ? 'Edit your reply' : 'Answer it: the next daily check reads this and acts on it'}><Icon name="pencil" size={12} /></button>}
      <button type="button" className="sk-inbox-btn is-done" onClick={() => setInboxStatus([r.id], 'done')} aria-label={`Done: ${r.title}`} title={r.status === 'answered' ? 'Looks good, clear it' : 'Handled'}><Icon name="check" size={13} /></button>
      {r.status === 'answered' ? null : <button type="button" className="sk-inbox-btn" onClick={() => setInboxStatus([r.id], 'dismissed')} aria-label={`Dismiss: ${r.title}`} title="Dismiss (won’t come back)"><Icon name="close" size={12} /></button>}
    </li>
  );
}

/** Pop-out: one list per kind of finding. ✎ = answer it for the next run, ✓ = handled, ✕ = dismiss (won't come back). */
export function RoutineInboxPop({ items, close }: { items: InboxItem[]; close: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  useEffect(() => { if (!items.length) close(); }, [items.length, close]);
  const groups = INBOX_GROUPS.map((g) => ({ ...g, rows: items.filter((i) => i.group === g.id) })).filter((g) => g.rows.length);
  const runs = [...new Set(items.map((i) => i.run).filter(Boolean))].sort();
  const now = needsYou(items);
  return (
    <div className="sk-subpop-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sk-subpop sk-inbox" role="dialog" aria-modal="true" aria-label="Needs you: findings to confirm">
        <header className="sk-subpop-head">
          <Icon name="bell" size={15} />
          <b className="sk-subpop-title">Needs you · {now.length} to confirm</b>
          <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={close} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <p className="sk-subpop-from">From the daily Life Hub check{runs.length ? ` (${runs.map(md).join(', ')})` : ''}. ✎ answer it and the next check acts on your answer. ✓ when it’s handled. ✕ to dismiss it so it won’t come back.</p>
        <div className="sk-inbox-lists">
          {groups.map((g) => (
            <section key={g.id} className="sk-inbox-list" data-group={g.id} aria-label={g.title}>
              <h3>{g.title}<span>{g.rows.length}</span></h3>
              <ul>{g.rows.map((r) => <Row key={r.id} r={r} />)}</ul>
            </section>
          ))}
        </div>
        <footer className="sk-inbox-foot">
          {now.some((i) => !i.status) ? <button type="button" className="sk-link" onClick={() => setInboxStatus(now.filter((i) => !i.status).map((i) => i.id), 'dismissed')}>Dismiss the rest</button> : null}
        </footer>
      </div>
    </div>
  );
}
