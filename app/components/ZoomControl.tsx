'use client';

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';
import { pageZoom } from '../../lib/displaySettings';

const MIN = 60;
const MAX = 160;
const STEP = 10;

/** One page-wide control; a saved size overrides the legacy phone default. */
export function ZoomControl() {
  const [saved, setSaved] = useState<number | null>(() => pageZoom(readSaved(STORAGE_KEYS.zoom, null)));
  const [auto, setAuto] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches ? 60 : 100);
  const zoom = saved ?? auto;

  useEffect(() => {
    const screen = window.matchMedia('(max-width: 520px)');
    const update = () => setAuto(screen.matches ? 60 : 100);
    screen.addEventListener('change', update);
    return () => screen.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('zoom', saved === null ? '' : String(zoom / 100));
    document.documentElement.style.setProperty('--page-zoom', String(zoom / 100));
    return () => {
      document.documentElement.style.removeProperty('zoom');
      document.documentElement.style.removeProperty('--page-zoom');
    };
  }, [zoom, saved]);

  const pick = (next: number | null) => {
    writeSaved(STORAGE_KEYS.zoom, next);
    setSaved(next);
  };
  const step = (d: number) => pick(Math.min(MAX, Math.max(MIN, zoom + d)));

  return (
    <div className="zoom-control" role="group" aria-label="Page zoom">
      <button type="button" onClick={() => step(-STEP)} disabled={zoom <= MIN} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button
        type="button"
        className="zoom-value"
        onClick={() => pick(100)}
        title="Reset site size to 100%"
        aria-label={`Site size ${zoom}%. Reset to 100%`}
      >
        {zoom}%
      </button>
      <button type="button" onClick={() => step(STEP)} disabled={zoom >= MAX} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  );
}
