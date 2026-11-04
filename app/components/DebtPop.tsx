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
import { addGroupLog, entriesFor, GROUP_LOG_KINDS, kindLabel, removeGroupLog, useGroupLog, type GroupLogKind } from "../../lib/groupLog";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Group-level log: what you did about the whole group (asked about a plan, terms, who/when, a note). */
export function GroupLog({ group }: { group: string }) {
  const store = useGroupLog();
  const rows = entriesFor(store, group);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<GroupLogKind>("asked");
  const [date, setDate] = useState(todayStr);
  const [who, setWho] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const save = () => {
    addGroupLog(group, { kind, date, who, terms, note });
    setWho("");
    setTerms("");
    setNote("");
    setDate(todayStr());
    setAdding(false);
  };
  return (
    <section className="gl" aria-label="Group log">
      <div className="gl-head">
        <h4>Group log</h4>
        {adding ? null : (
          <button type="button" className="sk-btn is-small" onClick={() => setAdding(true)}>
            + Log
          </button>
        )}
      </div>
      {adding ? (
        <div className="gl-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as GroupLogKind)} aria-label="What happened">
            {GROUP_LOG_KINDS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who (MVA, city office, name…)" aria-label="Who" />
          <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Plan terms (e.g. $50/mo × 12)" aria-label="Plan terms" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" rows={2} aria-label="Note" />
          <div className="gl-actions">
            <button type="button" className="sk-btn is-small" onClick={save}>
              Save
            </button>
            <button type="button" className="sk-btn is-small ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="gl-list">
          {rows.map((e) => (
            <li key={e.id}>
              <b>{kindLabel(e.kind)}</b>
              <span className="gl-meta">
                {e.date}
                {e.who ? ` · ${e.who}` : ""}
              </span>
              {e.terms ? <span className="gl-terms">Terms: {e.terms}</span> : null}
              {e.note ? <span className="gl-note">{e.note}</span> : null}
              <button type="button" className="gl-del" onClick={() => removeGroupLog(e.id)} aria-label={`Delete log entry ${kindLabel(e.kind)} ${e.date}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : adding ? null : (
        <p className="dbt-muted">Nothing logged for the group yet — e.g. asked about a payment plan.</p>
      )}
    </section>
  );
}

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
            <GroupLog group={req.key} />
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
