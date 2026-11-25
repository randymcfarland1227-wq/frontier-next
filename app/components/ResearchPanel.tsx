"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../sticker/Dialog";
import { Icon } from "../sticker/Icon";
import {
  OPEN_RESEARCH_EVENT,
  hasResearch,
  newOptionId,
  openResearch,
  researchOf,
  researchTotal,
  setResearch,
  useResearch,
  type ResearchOption,
} from "../../lib/research";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0 });

/** The small 🔎 button on a purchase or to-do row. Lit when the record has something in it. */
export function ResearchButton({ rkey, title, sub, className = "", label }: { rkey: string; title: string; sub?: string; className?: string; label?: string }) {
  const store = useResearch();
  const rec = researchOf(store, rkey);
  const lit = hasResearch(rec);
  const n = rec?.options?.length || 0;
  return (
    <button
      type="button"
      className={`sk-rs-btn${lit ? " is-lit" : ""} ${className}`}
      title={lit ? `Research: ${n ? `${n} option${n === 1 ? "" : "s"}` : "notes"} — open` : "Research notes, links and prices"}
      aria-label={`Research for ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        openResearch(rkey, title, sub);
      }}
    >
      <Icon name="search" size={12} />
      {label ? <span className="sk-rs-label">{label}</span> : null}
      {n ? <small>{n}</small> : null}
    </button>
  );
}

/** Mounted once: opens the research pop-out for whichever item asked (openResearch). */
export function ResearchHost() {
  const [open, setOpen] = useState<{ key: string; title: string; sub?: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent).detail);
    window.addEventListener(OPEN_RESEARCH_EVENT, on);
    return () => window.removeEventListener(OPEN_RESEARCH_EVENT, on);
  }, []);
  if (!open) return null;
  return <ResearchDialog key={open.key} rkey={open.key} title={open.title} sub={open.sub} close={() => setOpen(null)} />;
}

function ResearchDialog({ rkey, title, sub, close }: { rkey: string; title: string; sub?: string; close: () => void }) {
  const store = useResearch();
  const rec = researchOf(store, rkey);
  const [notes, setNotes] = useState(rec?.notes || "");
  const options = rec?.options || [];
  const save = (patch: { notes?: string; options?: ResearchOption[] }) => setResearch(rkey, { title, ...patch });
  const setOpt = (id: string, patch: Partial<ResearchOption>) => save({ options: options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const total = researchTotal(rec);
  const picked = options.some((o) => o.pick && !o.got);
  return (
    <Dialog label={`Research: ${title}`} onClose={close} className="sk-rs" backClassName="sk-rs-back">
      <header className="sk-dialog-head">
        <Icon name="search" size={18} />
        <div className="sk-rs-title">
          <b>{title}</b>
          <small>{sub || "Research"} · same notes everywhere this item shows</small>
        </div>
        <button type="button" className="sk-btn is-small is-icon" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <label className="sk-field">
        <span>Notes</span>
        <textarea
          className="sk-rs-notes"
          rows={4}
          value={notes}
          placeholder="What you found, what to ask, what to compare…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (rec?.notes || "") && save({ notes })}
          data-autofocus
        />
      </label>
      <div className="sk-rs-optshead">
        <b>Options</b>
        <small>
          {options.length ? `${options.length} · ${picked ? "picked" : "all"} ${usd(total)}` : "Each thing to get or compare: what it does, price, link"}
        </small>
      </div>
      {options.length ? (
        <ul className="sk-rs-opts">
          {options.map((o) => (
            <li key={o.id} className={`${o.pick ? "is-pick" : ""}${o.got ? " is-got" : ""}`}>
              <OptionRow o={o} onChange={(p) => setOpt(o.id, p)} onRemove={() => save({ options: options.filter((x) => x.id !== o.id) })} />
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="sk-btn is-small"
        onClick={() => save({ options: [...options, { id: newOptionId(), name: "" }] })}
      >
        <Icon name="plus" size={12} /> Add option
      </button>
    </Dialog>
  );
}

/** One option: name · what it does · price · link, typed in place (saved when a field loses focus). */
function OptionRow({ o, onChange, onRemove }: { o: ResearchOption; onChange: (p: Partial<ResearchOption>) => void; onRemove: () => void }) {
  const [d, setD] = useState({ name: o.name, does: o.does || "", price: o.price != null ? String(o.price) : "", url: o.url || "" });
  const commit = () => {
    const price = d.price.trim() ? Number(d.price.replace(/[$,\s]/g, "")) : undefined;
    let url = d.url.trim() || undefined;
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = { name: d.name.trim(), does: d.does.trim() || undefined, price: price != null && Number.isFinite(price) ? price : undefined, url };
    if (next.name !== o.name || next.does !== o.does || next.price !== o.price || next.url !== o.url) onChange(next);
  };
  return (
    <div className="sk-rs-opt" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && commit()}>
      <input className="sk-rs-name" value={d.name} placeholder="Name (e.g. the cord or model)" onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Option name" autoFocus={!o.name} />
      <input className="sk-rs-price" value={d.price} placeholder="$" inputMode="decimal" onChange={(e) => setD({ ...d, price: e.target.value })} aria-label="Price" />
      <input className="sk-rs-does" value={d.does} placeholder="What it does / why" onChange={(e) => setD({ ...d, does: e.target.value })} aria-label="What it does" />
      <input className="sk-rs-url" value={d.url} placeholder="Link" inputMode="url" onChange={(e) => setD({ ...d, url: e.target.value })} aria-label="Link" />
      <div className="sk-rs-acts">
        {o.url ? (
          <a className="sk-btn is-small is-icon is-quiet" href={o.url} target="_blank" rel="noreferrer" aria-label={`Open link for ${o.name || "option"}`}>
            <Icon name="external" size={12} />
          </a>
        ) : null}
        <button type="button" className={`sk-rs-tog${o.pick ? " is-on" : ""}`} onClick={() => onChange({ pick: !o.pick })} title="The one to get">
          {o.pick ? "★ Get" : "☆ Get"}
        </button>
        <button type="button" className={`sk-rs-tog${o.got ? " is-on" : ""}`} onClick={() => onChange({ got: !o.got })} title="Already have / bought it">
          {o.got ? "✓ Have" : "Have"}
        </button>
        <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={onRemove} aria-label={`Remove ${o.name || "option"}`}>
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
