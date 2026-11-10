'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ZoomControl } from '../components/ZoomControl';
import { DEFAULT_DISPLAY, type DisplaySettings, type DisplaySize } from '../../lib/displaySettings';
import './display-controls.css';

export function DisplayControls({ settings, onChange }: { settings: DisplaySettings; onChange: (next: DisplaySettings) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('.sk-display-toggle')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="sk-display" ref={root}>
      <div className="sk-display-bar">
        <span className="sk-display-label">Site size</span>
        <ZoomControl />
        <button type="button" className="sk-display-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Display <span aria-hidden="true">{open ? '−' : '+'}</span></button>
      </div>
      {open && <div id={id} className="sk-display-options" aria-label="Display settings">
        <p>Heading and tab sizes leave task text unchanged.</p>
        {(['headers', 'tabs'] as const).map(key => <fieldset key={key}>
          <legend>{key === 'headers' ? 'Headings' : 'Tabs'}</legend>
          <div className="sk-display-choices">{(['compact', 'standard', 'large'] as DisplaySize[]).map(value => <button type="button" key={value} aria-pressed={settings[key] === value} onClick={() => onChange({ ...settings, [key]: value })}>{value === 'compact' ? 'Small' : value === 'standard' ? 'Standard' : 'Large'}</button>)}</div>
        </fieldset>)}
        <fieldset><legend>Spacing</legend><div className="sk-display-choices">{(['compact', 'standard'] as const).map(value => <button type="button" key={value} aria-pressed={settings.spacing === value} onClick={() => onChange({ ...settings, spacing: value })}>{value === 'compact' ? 'Compact' : 'Standard'}</button>)}</div></fieldset>
        <button type="button" className="sk-display-reset" onClick={() => onChange({ ...DEFAULT_DISPLAY })}>Reset layout</button>
      </div>}
    </div>
  );
}
