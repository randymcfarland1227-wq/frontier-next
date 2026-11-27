'use client';

import { useState } from 'react';
import { newWorksheet, openWorksheet, saveWorksheet, useWorksheets } from '../../lib/worksheets';
import { sheetOf } from '../../lib/sheetFormula';
import { SearchPick } from '../sticker/SearchPick';
import { SheetGrid } from './WorksheetSheet';

/**
 * A worksheet kept inside a task or project: pick one (or start a new one) and work its sheet right here.
 * The worksheet itself still lives in Home › Worksheet; this only stores its id on the task / project.
 */
export function LinkedWorksheet({ id, onLink, title }: { id?: string; onLink: (id: string | undefined) => void; title: string }) {
  const store = useWorksheets();
  const ws = id ? store[id] : undefined;
  const [view, setView] = useState<'sheet' | 'notes' | null>(null);
  if (!ws || ws.gone) {
    const opts = Object.values(store)
      .filter((s) => !s.gone)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((s) => ({ key: s.id, label: s.title || 'Untitled worksheet', sub: new Date(s.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) }));
    return (
      <div className="lw-pick">
        <SearchPick options={opts} label="Link a worksheet" placeholder="+ Link a worksheet (math, notes)" disabled={!opts.length} onPick={(o) => onLink(o.key)} />
        <button type="button" className="lw-new" onClick={() => onLink(newWorksheet(title))}>＋ New worksheet</button>
      </div>
    );
  }
  const shown = view || (ws.view === 'notes' && ws.html ? 'notes' : 'sheet');
  return (
    <div className="lw-box">
      <div className="lw-head">
        <b title={ws.title}>{ws.title || 'Untitled worksheet'}</b>
        <span className="lw-seg" role="radiogroup" aria-label="Worksheet view">
          {(['sheet', 'notes'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={shown === v} className={shown === v ? 'is-on' : ''} onClick={() => setView(v)}>
              {v === 'sheet' ? 'Sheet' : 'Notes'}
            </button>
          ))}
        </span>
        <button type="button" className="lw-link" onClick={() => openWorksheet(ws.id)}>Open ↗</button>
        <button type="button" className="lw-link" onClick={() => onLink(undefined)} title="Take it off this task (the worksheet stays in Home › Worksheet)">Unlink</button>
      </div>
      {shown === 'sheet' ? (
        <div className="lw-sheet">
          <SheetGrid key={ws.id} data={sheetOf(ws.sheet)} onChange={(d) => saveWorksheet(ws.id, { sheet: d })} />
        </div>
      ) : ws.html ? (
        // Already cleaned by the worksheet editor (lib/worksheets.ts cleanHtml) before it was saved.
        <div className="lw-notes" dangerouslySetInnerHTML={{ __html: ws.html }} />
      ) : (
        <p className="lw-empty">No notes yet. Open it to write some.</p>
      )}
    </div>
  );
}
