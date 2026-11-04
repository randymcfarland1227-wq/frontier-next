'use client';

import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from '../../lib/storage';

export const MONEY_ZOOM_KEY = 'lifehub-money-split-zoom';
const MIN = 40;
const MAX = 120;
const STEP = 10;
const DEFAULT = 60;

/** − / + for Money's size in split view only (each device keeps its own; a laptop and a big monitor differ). */
export function MoneyZoom() {
  const [zoom, setZoom] = useState(() => {
    const v = readSaved<number>(MONEY_ZOOM_KEY, DEFAULT);
    return typeof v === 'number' ? Math.min(MAX, Math.max(MIN, v)) : DEFAULT;
  });
  useEffect(() => {
    document.documentElement.style.setProperty('--money-zoom', String(zoom / 100));
  }, [zoom]);
  const pick = (next: number) => {
    const v = Math.min(MAX, Math.max(MIN, next));
    setZoom(v);
    writeSaved(MONEY_ZOOM_KEY, v);
  };
  return (
    <span className="skm-zoom" role="group" aria-label="Money size in split view">
      <button type="button" onClick={() => pick(zoom - STEP)} disabled={zoom <= MIN} aria-label="Smaller" title="Smaller">−</button>
      <button type="button" className="skm-zoom-val" onClick={() => pick(DEFAULT)} title="Back to the default size">{zoom}%</button>
      <button type="button" onClick={() => pick(zoom + STEP)} disabled={zoom >= MAX} aria-label="Bigger" title="Bigger">+</button>
    </span>
  );
}
