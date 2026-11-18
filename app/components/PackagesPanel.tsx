"use client";

import { useEffect, useState } from "react";
import { useRowMenu } from "./RowMenu";
import {
  STATUS_LABEL,
  newPackageId,
  refreshPackagesAll,
  removePackage,
  savePackage,
  seedPackages,
  trackUrl,
  usePackages,
  type Pkg,
  type PkgStatus,
} from "../../lib/packages";

const ORDER: Record<PkgStatus, number> = { out: 0, pickup: 1, problem: 2, transit: 3, shipped: 4, ordered: 5, tosend: 6, delivered: 7 };
const day = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "");

function Row({ p }: { p: Pkg }) {
  const set = (patch: Partial<Pkg>) => savePackage({ ...p, ...patch });
  const { bind, menu } = useRowMenu(
    () => [
      ...(["ordered", "tosend", "shipped", "transit", "out", "delivered"] as PkgStatus[])
        .filter((s) => s !== p.status && (p.dir === "out" || s !== "tosend"))
        .map((s) => ({ label: `Mark ${STATUS_LABEL[s].toLowerCase()}`, onSelect: () => set({ status: s, ...(s === "delivered" ? { eta: new Date().toLocaleDateString("en-CA") } : {}) }) })),
      { label: p.tracking ? "Change tracking number…" : "Add tracking number…", onSelect: () => { const t = window.prompt(`Tracking number for ${p.name}`, p.tracking || ""); if (t !== null) set({ tracking: t.trim() || undefined, ...(t.trim() && (p.status === "ordered" || p.status === "tosend") ? { status: "shipped" } : {}) }); } },
      { label: "Set arrival date…", onSelect: () => { const t = window.prompt("Estimated arrival (YYYY-MM-DD)", p.eta || ""); if (t !== null) set({ eta: /^\d{4}-\d{2}-\d{2}$/.test(t.trim()) ? t.trim() : undefined }); } },
      { label: "Rename…", onSelect: () => { const t = window.prompt("Name", p.name); if (t?.trim()) set({ name: t.trim() }); } },
      { label: "Remove", danger: true, onSelect: () => removePackage(p.id) },
    ],
    p.name,
  );
  const late = p.eta && p.status !== "delivered" && p.eta < new Date().toLocaleDateString("en-CA");
  return (
    <li className={`pk-row is-${p.status}`} {...bind} title="Right-click for status, tracking number, arrival date">
      <span className={`pk-dir is-${p.dir}`} aria-label={p.dir === "in" ? "Coming to you" : "Going out"}>{p.dir === "in" ? "↓" : "↑"}</span>
      <span className="pk-main">
        <b>{p.name}</b>
        <small>
          {p.from ? `${p.from}` : ""}
          {p.carrier ? ` · ${p.carrier}` : ""}
          {p.last ? ` · ${p.last}` : ""}
        </small>
      </span>
      <span className="pk-right">
        <span className={`pk-status is-${p.status}`}>{STATUS_LABEL[p.status].replace(" · not shipped", "")}</span>
        <small className={late ? "is-late" : ""}>
          {p.status === "delivered" ? (p.eta ? `on ${day(p.eta)}` : "") : p.eta ? `${late ? "was due" : "arrives"} ${day(p.eta)}` : p.tracking ? "no ETA yet" : p.status === "ordered" ? "not shipped yet" : ""}
        </small>
      </span>
      {p.tracking ? (
        <a className="pk-link" href={trackUrl(p.tracking)} target="_blank" rel="noopener noreferrer" title={`Track ${p.tracking}`} onClick={(e) => e.stopPropagation()}>
          ↗
        </a>
      ) : (
        <span className="pk-link is-none" aria-hidden="true" />
      )}
      {menu}
    </li>
  );
}

/** Dashboard › Packages: coming in and going out, status from shipping email (Mail Sync) plus Track123 on Refresh. */
export function PackagesPanel({ Panel }: { Panel: (p: { title: string; icon: string; accent: string; meta?: React.ReactNode; className?: string; children: React.ReactNode; onOpen?: () => void }) => React.ReactElement }) {
  useEffect(() => seedPackages(), []);
  const all = usePackages();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", from: "", tracking: "", dir: "in" as Pkg["dir"] });
  const [weekAgo] = useState(() => new Date(Date.now() - 4 * 864e5).toLocaleDateString("en-CA"));
  const shown = all
    .filter((p) => p.status !== "delivered" || (p.eta || p.at.slice(0, 10)) >= weekAgo)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.eta || "9").localeCompare(b.eta || "9"));
  const open = all.filter((p) => p.status !== "delivered").length;
  const refresh = async () => {
    setBusy(true);
    const r = await refreshPackagesAll();
    setBusy(false);
    const mail = r.mail ? "Email checked" : "Email check failed";
    setMsg(r.ok ? `${mail} · ${r.updated ? `tracker updated ${r.updated}` : "tracker: nothing new"}` : `${mail} · tracker: ${r.error === "no_tracking_key" ? "not set up" : r.error}`);
    window.setTimeout(() => setMsg(""), 6000);
  };
  const add = () => {
    if (!form.name.trim()) return;
    savePackage({ id: newPackageId(), name: form.name.trim(), from: form.from.trim() || undefined, tracking: form.tracking.trim() || undefined, dir: form.dir, status: form.tracking.trim() ? "shipped" : form.dir === "out" ? "tosend" : "ordered" });
    setForm({ name: "", from: "", tracking: "", dir: form.dir });
    setAdding(false);
  };
  return (
    <Panel title="Packages" icon="📦" accent="#7aa7ff" meta={`${open} on the way`} className="hb-pkgs">
      <div className="pk-tools">
        <button type="button" className="pk-btn" onClick={refresh} disabled={busy} title="Read shipping email now, then ask the tracker about every package not yet delivered">
          {busy ? "Checking…" : "↻ Refresh"}
        </button>
        <button type="button" className="pk-btn" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add"}</button>
        {msg ? <span className="pk-msg">{msg}</span> : null}
      </div>
      {adding ? (
        <form className="pk-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="What it is" aria-label="Package name" autoFocus />
          <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="From / to (store)" aria-label="From" />
          <input value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} placeholder="Tracking # (optional)" aria-label="Tracking number" />
          <select value={form.dir} onChange={(e) => setForm({ ...form, dir: e.target.value as Pkg["dir"] })} aria-label="Direction">
            <option value="in">Coming in</option>
            <option value="out">Sending out</option>
          </select>
          <button type="submit" className="pk-btn" disabled={!form.name.trim()}>Add</button>
        </form>
      ) : null}
      <ul className="pk-list">
        {shown.map((p) => <Row key={p.id} p={p} />)}
        {!shown.length ? <li className="hb-allclear">Nothing on the way.</li> : null}
      </ul>
    </Panel>
  );
}
