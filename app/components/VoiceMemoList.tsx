'use client';

import { useState } from 'react';
import type { Capture, CaptureStatus } from '../../lib/captures';
import { useFold } from './Collapsible';
import { ListHead, Row, Tag } from '../sticker/kit';
import { Icon } from '../sticker/Icon';
import { VoicePlayer } from './VoicePlayer';

const MEMO_SITE = 'https://randymcfarland1227-wq.github.io/voice-memos/';

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === dayKey(y.toISOString())) return 'Yesterday';
  const [yr, m, d] = key.split('-').map(Number);
  const date = new Date(yr, m - 1, d);
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: yr === new Date().getFullYear() ? undefined : 'numeric' });
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const loggedOf = (c: Capture) => c.loggedAt || c.createdAt;

/**
 * Voice memos from the voice-memos site, as their own foldable list inside Self.
 * Grouped by the day they were logged for; Archive parks one, Promote makes it a Self task.
 */
export function VoiceMemoList({
  memos,
  onStatus,
  onPromote,
}: {
  memos: Capture[];
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPromote: (capture: Capture) => void;
}) {
  const [shut, toggle] = useFold('self-voice-memos');
  const [showArchived, setShowArchived] = useState(false);
  const live = memos.filter(m => m.status === 'inbox' || m.status === 'promoted');
  const archived = memos.filter(m => m.status === 'parked');
  const shown = (showArchived ? [...live, ...archived] : live).sort((a, b) => loggedOf(b).localeCompare(loggedOf(a)));
  const days: Array<[string, Capture[]]> = [];
  for (const m of shown) {
    const k = dayKey(loggedOf(m));
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(m);
    else days.push([k, [m]]);
  }
  const minutes = Math.round(live.reduce((n, m) => n + (m.audio?.seconds || 0), 0) / 60);

  return (
    <div className="sk-vm" aria-label="Voice memos">
      <ListHead
        title={
          <>
            <Icon name="mic" size={14} />
            Voice memos
          </>
        }
        meta={live.length ? `${live.length}${minutes ? ` · ${minutes} min` : ''}` : 0}
        shut={shut}
        onToggle={toggle}
      >
        <a className="sk-link sk-vm-rec" href={MEMO_SITE} target="_blank" rel="noopener noreferrer">
          + Record
        </a>
      </ListHead>
      {shut ? null : (
        <div className="sk-vm-body">
          {days.length === 0 ? <p className="sk-empty">No voice memos yet. Record one on the memo site.</p> : null}
          {days.map(([k, list]) => (
            <div key={k} className="sk-vm-day">
              <div className="sk-vm-dayh">
                <span>{dayLabel(k)}</span>
                <span className="sk-vm-dayn">{list.length}</span>
              </div>
              {list.map(m => (
                <Row
                  key={m.id}
                  className={`sk-vm-row is-${m.status}`}
                  title={m.title}
                  sub={
                    <>
                      <span className="sk-facts">
                        <span>{timeOf(loggedOf(m))}</span>
                        {m.loggedAt && dayKey(m.loggedAt) !== dayKey(m.createdAt) ? <span>recorded {dayLabel(dayKey(m.createdAt))}</span> : null}
                        {m.status === 'promoted' ? <span>Now a Self task</span> : null}
                        {m.status === 'parked' ? <span>Archived</span> : null}
                      </span>
                      {m.audio ? <VoicePlayer audio={m.audio} /> : null}
                      {m.notes ? <span className="sk-capnote sk-vm-note">{m.notes}</span> : null}
                    </>
                  }
                  value={m.memoType ? <Tag>{m.memoType}</Tag> : undefined}
                >
                  <div className="sk-ract">
                    {m.status === 'inbox' ? (
                      <button type="button" className="sk-link" onClick={() => onPromote(m)}>
                        Make a task
                      </button>
                    ) : null}
                    {m.status === 'parked' ? (
                      <button type="button" className="sk-link" onClick={() => onStatus(m.id, 'inbox')}>
                        Restore
                      </button>
                    ) : (
                      <button type="button" className="sk-link" onClick={() => onStatus(m.id, 'parked')}>
                        Archive
                      </button>
                    )}
                  </div>
                </Row>
              ))}
            </div>
          ))}
          {archived.length ? (
            <button type="button" className="sk-link sk-vm-more" onClick={() => setShowArchived(v => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
