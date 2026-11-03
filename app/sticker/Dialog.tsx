"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The one pop-out. Portalled into the themed `.sk-app` (so blurred ancestors can't trap it),
 * closes on Escape or a click on the backdrop, and moves focus in exactly once when it opens —
 * never again while you type (re-focusing on every render is how a pop-out steals the cursor).
 * Mark the element that should take the first focus with `data-autofocus`; otherwise the first button does.
 */
export function Dialog({
  label,
  onClose,
  className = "",
  backClassName = "",
  dataSite,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  backClassName?: string;
  dataSite?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });
  useEffect(() => {
    const el = box.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") || el?.querySelector<HTMLElement>("button"))?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeNow.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const host =
    document.querySelector(".sk-app") || document.querySelector(".frontier-shell") || document.body;
  return createPortal(
    <div className={`sk-dialog-back ${backClassName}`.trim()} role="presentation" onClick={onClose}>
      <div
        ref={box}
        className={`sk-dialog ${className}`.trim()}
        data-site={dataSite}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    host,
  );
}
