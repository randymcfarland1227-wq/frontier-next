'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FocusItem, SourceId, SpaceId } from '../../lib/types';
import { sources, sourceById } from '../../lib/sources';
import { Row } from '../sticker/kit';
import { Icon } from '../sticker/Icon';
import { SITE_GROUPS } from '../sticker/StickerShell';

const toneOf = (id: SourceId) => SITE_GROUPS.find(g => g.ids.includes(id))?.tone || 'ops';

/**
 * Today's List: a sheet from the right, inside the sticker theme. Each item names its site,
 * opens that site's Life Hub page, and links out (↗) to the site itself.
 */
export function FocusDrawer({
  open,
  close,
  focus,
  setFocus,
  enter,
}: {
  open: boolean;
  close: () => void;
  focus: FocusItem[];
  setFocus: (items: FocusItem[]) => void;
  enter: (id: SpaceId) => void;
}) {
  const [newText, setNewText] = useState('');
  const [space, setSpace] = useState<SourceId>('self');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Behave like a dialog: focus moves in when it opens, Escape closes it.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  function addFocus(event: FormEvent) {
    event.preventDefault();
    if (!newText.trim()) return;
    setFocus([...focus, { id: Date.now(), text: newText.trim(), space, done: false }]);
    setNewText('');
  }

  const toggle = (id: number) => setFocus(focus.map(current => (current.id === id ? { ...current, done: !current.done } : current)));
  const left = focus.filter(f => !f.done).length;

  if (!open || typeof document === 'undefined') return null;
  const host = document.querySelector('.sk-app') || document.querySelector('.frontier-shell') || document.body;
  return createPortal(
    <div className="sk-dialog-back sk-sheetside-back" role="presentation" onClick={close}>
      <aside className="sk-sheetside tone-needs" role="dialog" aria-modal="true" aria-label="Today's List" onClick={e => e.stopPropagation()}>
        <header className="sk-dialog-head">
          <Icon name="checks" size={20} />
          <h2 className="sk-title">Today&apos;s List</h2>
          <button ref={closeRef} type="button" className="sk-btn is-icon is-small" onClick={close} aria-label="Close Today's List">
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="sk-sec">
          {focus.length ? `${left} of ${focus.length} left · ` : ''}What you said you&apos;d do today, from any site. Kept in this browser.
        </p>
        <div className="sk-list sk-todaylist">
          {focus.map(item => {
            const src = sourceById[item.space];
            return (
              <Row
                key={item.id}
                className={item.done ? 'is-done' : undefined}
                lead={
                  <button
                    type="button"
                    className={`sk-circle${item.done ? ' is-on' : ''}`}
                    onClick={() => toggle(item.id)}
                    aria-pressed={item.done}
                    aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
                  >
                    <Icon name="check" size={12} />
                  </button>
                }
                title={item.text}
                sub={
                  <button
                    type="button"
                    className="sk-link sk-origin"
                    onClick={() => {
                      enter(item.space);
                      close();
                    }}
                    title={`Open ${src?.name || item.space} in the Life Hub`}
                  >
                    <span className={`sk-sw tone-${toneOf(item.space)}`} aria-hidden="true" />
                    {src?.name || item.space}
                  </button>
                }
                value={
                  src?.url ? (
                    <a className="sk-link" href={src.url} target="_blank" rel="noreferrer" title={`Open ${src.label || src.name}`} aria-label={`Open ${src.name} site`}>
                      <Icon name="external" size={14} />
                    </a>
                  ) : null
                }
              />
            );
          })}
          {!focus.length ? <p className="sk-empty">Nothing on today&apos;s list yet. Add the first thing below.</p> : null}
        </div>
        <form className="sk-form sk-todayadd" onSubmit={addFocus}>
          <select value={space} onChange={e => setSpace(e.target.value as SourceId)} aria-label="Which site it belongs to">
            {sources.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input value={newText} onChange={event => setNewText(event.target.value)} placeholder="Add something for today…" aria-label="New item for today" />
          <button type="submit" className="sk-btn">
            <Icon name="plus" size={14} />
            Add
          </button>
        </form>
      </aside>
    </div>,
    host,
  );
}
