"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Any pane that can run long (a Today tab, a split pane): a capped height with its own scroll, so one
 * tall tab never stretches the page past its neighbour, plus a soft "more below" fade. Keyboard
 * users can focus it to scroll. `cap="page"` is the roomier cap for a full-width pane.
 */
export function CapPane({
  label,
  cap = "page",
  children,
}: {
  label: string;
  cap?: "page" | "split";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    const ro = new ResizeObserver(measure); // reports once on observe, then on every size change
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <div className={`sk-splitwrap${more ? " has-more" : ""}`} data-cap={cap}>
      <div className="sk-pane sk-splitpane" ref={ref} tabIndex={0} role="region" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
