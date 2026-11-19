'use client';

import { CATCH_LISTS, catchListOf, type Capture, type CaptureStatus, type CatchList } from '../../lib/captures';
import { useState } from 'react';
import { Row } from '../sticker/kit';
import { VoicePlayer } from './VoicePlayer';

const whenOf = (c: Capture) => {
  const d = new Date(c.loggedAt || c.createdAt);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** Move a capture into another catch list: voice memos change their sort, typed ones their kind. */
export function catchPatch(c: Capture, to: CatchList): Partial<Capture> {
  return c.kind === 'voice' ? { memoType: CATCH_LISTS.find(l => l.id === to)!.memo } : { kind: to };
}

function OneList({ id, label, items, onStatus, onPatch }: {
  id: CatchList; label: string; items: Capture[];
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPatch: (id: string, patch: Partial<Capture>) => void;
}) {
  return (
    <div className="sk-catch" aria-label={label}>
      {items.length === 0 ? (
        <p className="sk-empty">Nothing here yet.</p>
      ) : (
        <div className="sk-list">
          {items.map(c => (
            <Row
              key={c.id}
              className="sk-catch-row"
              title={c.title}
              sub={
                <>
                  <span className="sk-facts">
                    <span>{whenOf(c)}</span>
                    {c.kind === 'voice' ? <span>Voice memo</span> : null}
                  </span>
                  {c.audio ? <VoicePlayer audio={c.audio} /> : null}
                  {c.notes ? <span className="sk-capnote">{c.notes}</span> : null}
                  {c.url ? <a className="sk-link" href={c.url} target="_blank" rel="noopener noreferrer">{c.url}</a> : null}
                </>
              }
            >
              <div className="sk-ract">
                <select className="sk-catch-move" value={id} aria-label={`Move “${c.title}” to another list`}
                  onChange={e => onPatch(c.id, catchPatch(c, e.target.value as CatchList))}>
                  {CATCH_LISTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <button type="button" className="sk-link" onClick={() => onStatus(c.id, 'parked')}>Archive</button>
              </div>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}

/** Self's catch lists: Inspiration catch, Thoughts, Ideas, Reminders — typed or from voice memos. */
export function CatchLists({ captures, onStatus, onPatch }: {
  captures: Capture[];
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPatch: (id: string, patch: Partial<Capture>) => void;
}) {
  const [selected, setSelected] = useState<CatchList>(CATCH_LISTS[0].id);
  const live = captures.filter(c => c.status === 'inbox' || c.status === 'promoted');
  return (
    <div className="sk-catches">
      <div className="sk-chips sk-captabs" role="tablist" aria-label="Memo and capture categories">
        {CATCH_LISTS.map(list => <button type="button" role="tab" key={list.id} aria-selected={selected === list.id} onClick={() => setSelected(list.id)}>{list.label} <span className="sk-chipcount">{live.filter(c => catchListOf(c) === list.id).length}</span></button>)}
      </div>
      {CATCH_LISTS.filter(l => l.id === selected).map(l => (
        <OneList key={l.id} id={l.id} label={l.label} onStatus={onStatus} onPatch={onPatch}
          items={live.filter(c => catchListOf(c) === l.id).sort((a, b) => (b.loggedAt || b.createdAt).localeCompare(a.loggedAt || a.createdAt))} />
      ))}
    </div>
  );
}
