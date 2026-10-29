'use client';

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

const MIN = 60;
const MAX = 160;
const STEP = 10;

/**
 * Default size is 100%: the browser's own zoom (Cmd − / Cmd +) decides. Scaling up by window width
 * fought it — zooming out widens the CSS viewport, which bumped the auto size straight back up.
 */
function autoZoom() {
  return 100;
}

/**
 * Page zoom for this device (the layout re-flows at each size, it doesn't just magnify).
 * Until you pick a size it follows the screen width ("Auto"); tapping the % goes back to Auto.
 */
export function ZoomControl() {
  // The first version saved 100 on every load, so a stored 100 means "never picked" → Auto.
  const [saved, setSaved] = useState<number | null>(() => {
    const v = readSaved<number | null>(STORAGE_KEYS.zoom, null);
    return typeof v === 'number' && v !== 100 ? v : null;
  });
  const [auto] = useState(autoZoom);
  const zoom = saved ?? auto;


  useEffect(() => {
    document.documentElement.style.setProperty('zoom', zoom === 100 ? '' : String(zoom / 100));
    // Full-height pieces (the sticker sidebar) divide by this so they still fit the window.
    document.documentElement.style.setProperty('--page-zoom', String(zoom / 100));
  }, [zoom]);

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
        onClick={() => pick(null)}
        title={saved === null ? 'Browser zoom decides (Cmd − / Cmd +)' : 'Back to browser zoom'}
      >
        {saved === null ? 'Auto' : `${zoom}%`}
      </button>
      <button type="button" onClick={() => step(STEP)} disabled={zoom >= MAX} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  );
}
