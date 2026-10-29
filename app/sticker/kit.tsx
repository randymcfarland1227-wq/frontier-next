'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useFold } from '../components/Collapsible';
import { Icon, type IconName } from './Icon';

/** Readouts and links fire this to open a Home section (if folded) and scroll to it. */
export const REVEAL_EVENT = 'sk:reveal';
export const reveal = (id: string) => {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
  requestAnimationFrame(() => document.getElementById(`sk-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};

/** Fixed meaning colours. One colour = one meaning, everywhere. */
export type Tone = 'needs' | 'done' | 'open' | 'habit' | 'sched' | 'ground' | 'marvel' | 'alert' | 'ops' | 'role' | 'vent' | 'paper';

/**
 * A Home section: a Title-sized disclosure head with a one-line summary of what's inside, then its
 * groups. Fold state is the same saved `section:<id>` the classic sections used.
 */
export function Section({ id, title, summary, children }: { id: string; title: string; summary?: ReactNode; children: ReactNode }) {
  const [collapsed, toggle] = useFold(id);
  const toggleRef = useRef(toggle);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    toggleRef.current = toggle;
    collapsedRef.current = collapsed;
  });
  useEffect(() => {
    const onReveal = (e: Event) => {
      if ((e as CustomEvent).detail !== id) return;
      if (collapsedRef.current) toggleRef.current();
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [id]);
  return (
    <section id={`sk-${id}`} className={`sk-section${collapsed ? '' : ' is-open'}`} aria-label={title}>
      <button type="button" className="sk-shead" aria-expanded={!collapsed} onClick={toggle}>
        <Icon name="chevron" className="sk-chev" />
        <h2 className="sk-title">{title}</h2>
        {summary ? <span className="sk-sec">{summary}</span> : null}
      </button>
      {collapsed ? null : <div className="sk-sbody">{children}</div>}
    </section>
  );
}

/** A content box: flat, outlined, tinted by meaning. No shadow — it isn't pressable. */
export function Group({
  tone,
  icon,
  title,
  meta,
  actions,
  className,
  children,
}: {
  tone: Tone;
  icon?: IconName;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`sk-group tone-${tone}${className ? ` ${className}` : ''}`}>
      {title ? (
        <div className="sk-ghead">
          {icon ? <Icon name={icon} /> : null}
          <h3 className="sk-hl">{title}</h3>
          {meta ? <span className="sk-sec sk-ghead-meta">{meta}</span> : null}
          {actions ? <span className="sk-ghead-actions">{actions}</span> : null}
        </div>
      ) : null}
      <div className="sk-gbody">{children}</div>
    </div>
  );
}

/** Headline + secondary count above a list. */
export function ListHead({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sk-listh">
      <span className="sk-hl">{title}</span>
      {meta !== undefined ? <span className="sk-sec">{meta}</span> : null}
      {children}
    </div>
  );
}

/**
 * The one row anatomy: [lead check/dot] [title / subtitle] [trailing value] [chevron if it opens].
 * With `onOpen` the whole row is one button. `children` (actions, a form) span a full-width line
 * under it; with both, only the title opens. `bind` spreads gesture handlers (right-click menus).
 */
export function Row({
  lead,
  title,
  sub,
  value,
  valueTone,
  onOpen,
  hint,
  highlight,
  className,
  bind,
  children,
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueTone?: 'amt' | 'late';
  onOpen?: () => void;
  hint?: string;
  highlight?: boolean;
  className?: string;
  bind?: HTMLAttributes<HTMLElement>;
  children?: ReactNode;
}) {
  const split = Boolean(onOpen && children);
  const main = (
    <>
      <span className="sk-rt">{title}</span>
      {sub ? <span className="sk-rs">{sub}</span> : null}
    </>
  );
  const body = (
    <>
      <span className="sk-rlead">{lead}</span>
      {split ? (
        <button type="button" className="sk-rmain" onClick={onOpen} title={hint}>
          {main}
        </button>
      ) : (
        <span className="sk-rmain">{main}</span>
      )}
      <span className={`sk-rv${valueTone ? ` is-${valueTone}` : ''}`}>{value}</span>
      {onOpen ? <Icon name="chevron" className="sk-rchev" size={14} /> : <span />}
      {children}
    </>
  );
  const cls = `sk-row${highlight ? ' is-needs' : ''}${className ? ` ${className}` : ''}`;
  return onOpen && !split ? (
    <button type="button" className={cls} onClick={onOpen} title={hint} {...bind}>
      {body}
    </button>
  ) : (
    <div className={cls} title={split ? undefined : hint} {...bind}>
      {body}
    </div>
  );
}

export function Tag({ tone, children, hint }: { tone?: Tone; children: ReactNode; hint?: string }) {
  return (
    <span className={`sk-tag${tone ? ` tone-${tone}` : ''}`} title={hint}>
      {children}
    </span>
  );
}

export function Dot({ tone, hint }: { tone: Tone | 'red' | 'yellow' | 'green'; hint?: string }) {
  return <span className={`sk-dot tone-${tone}`} title={hint} aria-label={hint} role={hint ? 'img' : undefined} />;
}

/** Reminders-style circle check. */
export function Circle({ onDone, label }: { onDone: () => void; label: string }) {
  return (
    <button type="button" className="sk-circle" onClick={onDone} aria-label={label} title="Mark done">
      <Icon name="check" size={12} />
    </button>
  );
}
