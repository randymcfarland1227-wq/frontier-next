'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Never shrink a pane below this when fitting it. */
const FIT_MIN = 50;

/**
 * A Today pane at the size you picked — unless its content is wider than the pane at that size
 * (a smaller window, the other monitor), then it shrinks just enough to fit, in 5% steps.
 * It grows back to your size when there's room again. `onFit` reports the size actually shown.
 */
export function FitZoom({ zoom, off = false, watch, onFit, children }: { zoom: number; off?: boolean; watch?: unknown; onFit?: (shown: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onFit);
  report.current = onFit;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (z: number) => el.style.setProperty("zoom", off || z === 100 ? "" : String(z / 100));
    if (off) {
      set(100);
      report.current?.(zoom);
      return;
    }
    let lastW = -1;
    let lastSw = -1;
    let shown = zoom;
    const measure = (force = false) => {
      const box = el.parentElement || el;
      const pane = (el.querySelector(".sk-pane") as HTMLElement | null) || el;
      if (!force && box.clientWidth === lastW && pane.scrollWidth === lastSw) return;
      set(zoom);
      const cw = pane.clientWidth;
      const sw = pane.scrollWidth;
      let z = zoom;
      if (cw > 0 && sw > cw + 2) z = Math.max(FIT_MIN, Math.min(zoom, Math.floor((zoom * cw) / sw / 5) * 5));
      set(z);
      lastW = box.clientWidth;
      lastSw = pane.scrollWidth;
      if (z !== shown || force) {
        shown = z;
        report.current?.(z);
      }
    };
    measure(true);
    // Width changes (window, sidebar, the other pane) and content that loads in late.
    const ro = new ResizeObserver(() => measure());
    ro.observe(el.parentElement || el);
    const timers = [600, 2000, 5000].map((ms) => window.setTimeout(() => measure(true), ms));
    return () => {
      ro.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [zoom, off, watch]);
  return (
    <div ref={ref} className="sk-splitzoom">
      {children}
    </div>
  );
}
