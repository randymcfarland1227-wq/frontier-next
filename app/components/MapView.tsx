"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { CLUSTERS, FLOWS, SHELF, SITES, setSiteMap, useSiteMap, type MapCluster, type MapSite } from "../../lib/siteMap";
import type { SourceId, SourceSnapshot, SpaceId } from "../../lib/types";

/**
 * Map: every site Randy has built on one board, in islands around Life Hub. Islands drag by their
 * header (spot saved + cloud-synced), each island keeps a note, lines show data that really moves
 * between sites. Sites Life Hub reads show how fresh their data is and how much is open.
 * Phones get the islands stacked, no dragging.
 */

type Snapshots = Partial<Record<SourceId, SourceSnapshot>>;
type Pos = { x: number; y: number };
type Line = { x1: number; y1: number; x2: number; y2: number; hub: boolean };

const HUB_R = 75;

function ago(iso?: string): { text: string; tone: "fresh" | "quiet" | "stale" } | null {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  const h = (Date.now() - t) / 3600000;
  const text = h < 1 ? "synced just now" : h < 24 ? `synced ${Math.round(h)}h ago` : `synced ${Math.round(h / 24)}d ago`;
  return { text, tone: h < 24 ? "fresh" : h < 72 ? "quiet" : "stale" };
}

function SiteCard({ site, snap, enter, cardRef }: { site: MapSite; snap?: SourceSnapshot; enter: (id: SpaceId) => void; cardRef: (el: HTMLElement | null) => void }) {
  const live = site.source ? ago(snap?.refreshedAt) : null;
  const open = snap ? (snap.tasks || []).filter((t) => (t.status || "open") !== "done").length : 0;
  return (
    <article className="map-card" ref={cardRef} title={site.what}>
      <div className="map-card-top">
        <a className="map-card-name" href={site.url} target="_blank" rel="noreferrer">
          {site.name} <span aria-hidden="true">↗</span>
        </a>
        {live ? <span className={`map-dot is-${live.tone}`} title={live.text} /> : null}
      </div>
      <span className="map-card-what">{site.what}</span>
      {site.source || site.inside ? (
        <div className="map-card-tags">
          {site.source ? (
            <button type="button" className="map-tag is-feeds" onClick={() => enter(site.source!)} title={`Open ${site.name} inside Life Hub${live ? ` · ${live.text}` : ""}`}>
              In Life Hub{snap ? ` · ${open} open` : ""}
            </button>
          ) : null}
          {site.inside ? <span className="map-tag">Inside {site.inside}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

function Island({ cluster, pos, stacked, snapshots, enter, note, cardRef, onDragStart, islandRef }: {
  cluster: MapCluster;
  pos: Pos;
  stacked: boolean;
  snapshots: Snapshots;
  enter: (id: SpaceId) => void;
  note: string;
  cardRef: (id: string) => (el: HTMLElement | null) => void;
  onDragStart: (e: ReactPointerEvent, id: string) => void;
  islandRef: (el: HTMLElement | null) => void;
}) {
  const sites = SITES.filter((s) => s.cluster === cluster.id);
  const [draft, setDraft] = useState(note);
  const [editing, setEditing] = useState(false);
  const style = { "--map-c": cluster.color, ...(stacked ? {} : { left: `${pos.x}%`, top: pos.y }) } as CSSProperties;
  return (
    <section className="map-island" style={style} aria-label={cluster.name} ref={islandRef}>
      <header className="map-island-head" onPointerDown={stacked ? undefined : (e) => onDragStart(e, cluster.id)} title={stacked ? undefined : "Drag to move this island"}>
        <span className="map-island-dot" aria-hidden="true" />
        <div>
          <h3 className="map-island-name">{cluster.name}</h3>
          <span className="map-island-blurb">{cluster.blurb}</span>
        </div>
        <span className="map-island-count">{sites.length}</span>
      </header>
      <div className="map-cards">
        {sites.map((s) => (
          <SiteCard key={s.id} site={s} snap={s.source ? snapshots[s.source] : undefined} enter={enter} cardRef={cardRef(s.id)} />
        ))}
      </div>
      {editing ? (
        <textarea
          className="map-note-edit"
          autoFocus
          value={draft}
          placeholder="Ideas, next steps, links…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() !== note.trim()) setSiteMap(`note:${cluster.id}`, { text: draft.trim() });
          }}
        />
      ) : (
        <button type="button" className={`map-note${note ? " has-text" : ""}`} onClick={() => { setDraft(note); setEditing(true); }}>
          {note || "+ Note"}
        </button>
      )}
    </section>
  );
}

export function MapView({ snapshots, enter }: { snapshots: Snapshots; enter: (id: SpaceId) => void }) {
  const store = useSiteMap();
  const boardRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const islands = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<Record<string, number>>({});
  const islandRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) islands.current.set(id, el);
    else islands.current.delete(id);
  }, []);
  // Default spots follow the islands' real heights: top row, then Life Hub, then the bottom row.
  const top = CLUSTERS.filter((c) => c.y === 0 || c.y < 100);
  const topH = Math.max(200, ...top.map((c) => (heights[c.id] || 0) + c.y));
  const hubY = topH + HUB_R + 24;
  const bottomY = hubY + HUB_R + 24;
  const [drag, setDrag] = useState<{ id: string; pos: Pos } | null>(null);
  const [stacked, setStacked] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setStacked(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const posOf = (c: MapCluster): Pos => {
    if (drag?.id === c.id) return drag.pos;
    const saved = store[`pos:${c.id}`] as { x?: number; y?: number } | undefined;
    if (typeof saved?.x === "number" && typeof saved?.y === "number") return { x: saved.x, y: saved.y };
    return { x: c.x, y: c.y < 100 ? c.y : bottomY };
  };

  const cardRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  }, []);

  const measure = useCallback(() => {
    const board = boardRef.current;
    const hub = hubRef.current;
    if (!board || !hub || stacked) return setLines((prev) => (prev.length ? [] : prev));
    const b = board.getBoundingClientRect();
    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
    };
    const h = center(hub);
    const out: Line[] = [];
    for (const f of FLOWS) {
      const a = cards.current.get(f.from);
      const z = f.to === "hub" ? hub : cards.current.get(f.to);
      if (!a || !z) continue;
      const p = center(a);
      const q = f.to === "hub" ? h : center(z);
      out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, hub: f.to === "hub" });
    }
    const round = (l: Line) => [l.x1, l.y1, l.x2, l.y2].map(Math.round).join(",");
    setLines((prev) => (prev.length === out.length && prev.every((l, i) => round(l) === round(out[i])) ? prev : out));
  }, [stacked]);

  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    const read = () => {
      const next: Record<string, number> = {};
      islands.current.forEach((el, id) => (next[id] = Math.round(el.offsetHeight)));
      setHeights((prev) => (Object.keys(next).some((k) => next[k] !== prev[k]) ? next : prev));
    };
    const ro = new ResizeObserver(read);
    islands.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [stacked]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const onDragStart = (e: ReactPointerEvent, id: string) => {
    const board = boardRef.current;
    const c = CLUSTERS.find((k) => k.id === id);
    if (!board || !c || (e.target as HTMLElement).closest("button, a, textarea")) return;
    e.preventDefault();
    const b = board.getBoundingClientRect();
    const start = posOf(c);
    const sx = e.clientX;
    const sy = e.clientY;
    let last = start;
    const move = (ev: PointerEvent) => {
      last = {
        x: Math.min(78, Math.max(0, start.x + ((ev.clientX - sx) / b.width) * 100)),
        y: Math.max(0, start.y + ev.clientY - sy),
      };
      setDrag({ id, pos: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (last !== start) setSiteMap(`pos:${id}`, { x: Math.round(last.x * 10) / 10, y: Math.round(last.y) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const boardH = Math.max(bottomY + 260, ...CLUSTERS.map((c) => posOf(c).y + (heights[c.id] || 0) + 24));
  const moved = CLUSTERS.some((c) => typeof (store[`pos:${c.id}`] as { x?: number } | undefined)?.x === "number");
  const feeding = SITES.filter((s) => s.source).length;

  return (
    <div className="map-view">
      <header className="map-head">
        <div>
          <h2 className="sk-hl">Map</h2>
          <p className="map-sub">
            {SITES.length} sites · {CLUSTERS.length} islands · {feeding} feed Life Hub
          </p>
        </div>
        {moved && !stacked ? (
          <button
            type="button"
            className="sk-btn is-small"
            onClick={() => CLUSTERS.forEach((c) => setSiteMap(`pos:${c.id}`, {}))}
            title="Put every island back where it started"
          >
            Reset layout
          </button>
        ) : null}
      </header>

      <div className={`map-board${stacked ? " is-stacked" : ""}`} ref={boardRef} style={stacked ? undefined : { height: boardH }}>
        {!stacked ? (
          <svg className="map-lines" aria-hidden="true">
            {lines.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.hub ? "is-hub" : "is-site"} />
            ))}
          </svg>
        ) : null}
        <div className="map-hub" ref={hubRef} style={stacked ? undefined : { top: hubY }}>
          <b>Life Hub</b>
          <span>the center point</span>
        </div>
        {CLUSTERS.map((c) => (
          <Island
            key={c.id}
            cluster={c}
            pos={posOf(c)}
            stacked={stacked}
            snapshots={snapshots}
            enter={enter}
            note={String((store[`note:${c.id}`] as { text?: string } | undefined)?.text || "")}
            cardRef={cardRef}
            onDragStart={onDragStart}
            islandRef={islandRef(c.id)}
          />
        ))}
      </div>

      <section className="map-shelf" aria-label="Shelf">
        <h3 className="map-shelf-title">Shelf · retired or folded in</h3>
        <ul>
          {SHELF.map((s) => (
            <li key={s.name} title={s.why}>
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : <span>{s.name}</span>}
              <small>{s.why}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
