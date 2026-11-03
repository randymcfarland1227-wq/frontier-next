"use client";

/**
 * Finance pop-outs that open right where you are (a goal, a list, a focus card) instead of routing to Money:
 * a source group ("Baltimore City") with its tickets, and from there a ticket's full story (payment plan,
 * where it sits in the registration, the ticket, the letters). Same pop-out Finance itself uses.
 */

import { useEffect, useState } from "react";
import { LetterStory, Story, TicketRow } from "./DebtFile";
import { mdSources, oosSources } from "./OutstandingView";
import { debtItems } from "./FocusCards";
import { isSettled, useDebtFile } from "../../lib/debtFile";

export const OPEN_DEBT_POP_EVENT = "lifehub:open-debt-pop";
/** Open a Finance link (`src:city`, `tix:md`, `item:<id>`) as a pop-out, in place. */
export const openDebtPop = (key: string, label?: string) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_DEBT_POP_EVENT, { detail: { key, label } }));
};

const usd = (n: number | null | undefined) =>
  n == null ? "?" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function DebtPopHost() {
  const [req, setReq] = useState<{ key: string; label?: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setReq((e as CustomEvent).detail);
    window.addEventListener(OPEN_DEBT_POP_EVENT, open);
    return () => window.removeEventListener(OPEN_DEBT_POP_EVENT, open);
  }, []);
  return req ? <DebtPop req={req} close={() => setReq(null)} /> : null;
}

function DebtPop({ req, close }: { req: { key: string; label?: string }; close: () => void }) {
  const { file, marks, setMark } = useDebtFile();
  const [dlg, setDlg] = useState<{ kind: "item" | "letter"; id: string } | null>(null);
  const items = debtItems(file, req.key);
  const group = !req.key.startsWith("item:");
  const src = req.key.startsWith("src:") && file ? [...mdSources(file), ...oosSources(file)].find((s) => s.id === req.key.slice(4)) : undefined;
  // A single ticket opens straight to its story.
  const single = !group ? items[0] : undefined;
  const open = dlg?.kind === "item" ? file?.items.find((i) => i.id === dlg.id) : single && !dlg ? single : undefined;
  const openLetter = dlg?.kind === "letter" ? file?.letters.find((l) => l.id === dlg.id) : undefined;
  useEffect(() => {
    if (!group || dlg) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, dlg, close]);
  if (!file) return null;
  const live = items.filter((i) => !i.unverified && !isSettled(marks[i.id]));
  const sum = live.reduce((s, i) => s + (i.amount || 0), 0);
  return (
    <div className="dbt">
      {group ? (
        <div className="bal-dlg-backdrop" onClick={close}>
          <div className="bal-dlg dbt-story" role="dialog" aria-modal="true" aria-label={req.label || src?.label || "Finance"} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="bal-dlg-x" onClick={close} aria-label="Close">
              ✕
            </button>
            <header className="dbt-story-head sk-group tone-owed">
              <div>
                <h3>{src?.label || req.label || "Tickets"}</h3>
                <p>
                  {items.length} {items.length === 1 ? "ticket" : "tickets"} · {live.length} still owed
                </p>
              </div>
              <div className="dbt-story-amt">
                <b>{usd(sum)}</b>
              </div>
            </header>
            {src?.how ? <p className="dbt-muted">{src.how}</p> : null}
            <div className="dbt-tk-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
              {items.map((i) => (
                <TicketRow key={i.id} item={i} marks={marks} onOpen={(id) => setDlg({ kind: "item", id })} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {open ? (
        <Story
          item={open}
          file={file}
          mark={marks[open.id]}
          onMark={(m) => void setMark(open.id, m)}
          onClose={() => (group ? setDlg(null) : close())}
          onLetter={(id) => setDlg({ kind: "letter", id })}
        />
      ) : null}
      {openLetter ? (
        <LetterStory letter={openLetter} file={file} marks={marks} onOpen={(id) => setDlg({ kind: "item", id })} onClose={() => (group ? setDlg(null) : close())} />
      ) : null}
    </div>
  );
}
