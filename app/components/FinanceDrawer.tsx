'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setMeta, useMoneyMeta } from '../../lib/moneyMeta';
import { Icon } from '../sticker/Icon';
import './finance-drawer.css';

export function FinanceDrawer({ label, onClose, onBack, wide, children }: {
  label: string;
  onClose: () => void;
  onBack?: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const trigger = document.activeElement;
    panel.showModal();
    return () => {
      panel.close();
      // React may detach the drawer before the browser can restore the trigger.
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`bal-dlg skm-dlg finance-drawer${wide ? ' finance-drawer-wide' : ''}`}
      aria-label={label}
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
      }}
    >
      <header className="finance-drawer-tools">
        {onBack && (
          <button type="button" className="finance-drawer-icon" onClick={onBack}>
            <Icon name="chevron" className="skm-back" /> Back
          </button>
        )}
        <button type="button" className="finance-drawer-icon" onClick={onClose} aria-label="Close details">✕</button>
      </header>
      <div className="finance-drawer-content">{children}</div>
    </dialog>
  );
}

export function FinanceName({ name, onRename, suffix }: {
  name: string;
  onRename?: (name: string) => void;
  suffix?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const stop = () => {
    setDraft(null);
    requestAnimationFrame(() => pencil.current?.focus());
  };
  return (
    <div className="finance-name">
      <div className="finance-name-title">
        <h3>{name}{suffix}</h3>
        {onRename && draft === null && (
          <button ref={pencil} type="button" className="finance-drawer-icon" aria-label="Edit name" title="Edit name"
            onClick={() => { setNotice(''); setDraft(name); }}>
            <Icon name="pencil" size={15} />
          </button>
        )}
      </div>
      {draft !== null && onRename && (
        <form
          className="finance-name-editor"
          onSubmit={e => {
            e.preventDefault();
            const nameToSave = draft.trim();
            if (!nameToSave || nameToSave === name) return;
            onRename(nameToSave);
            setNotice('Name saved');
            stop();
          }}
          onKeyDown={e => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            stop();
          }}
        >
          <input ref={input} aria-label="Name on Life Hub" value={draft} onChange={e => setDraft(e.target.value)} required />
          <button type="submit" className="sk-btn is-small is-prominent" disabled={!draft.trim() || draft.trim() === name}>Save name</button>
          <button type="button" className="sk-btn is-small" onClick={stop}>Cancel</button>
        </form>
      )}
      <span className="finance-name-status" role="status">{notice}</span>
    </div>
  );
}

/** These names are presentation only. Keep source names in payment and balance references. */
export function useFinanceLabel(key: string, original: string) {
  const { get } = useMoneyMeta();
  const metaKey = `label:${key}`;
  return {
    name: get(metaKey)?.name || original,
    onRename: (name: string) => { setMeta(metaKey, { name: name === original ? undefined : name }); },
  };
}

export function FinanceLabel({ id, name }: { id: string; name: string }) {
  return useFinanceLabel(id, name).name;
}
