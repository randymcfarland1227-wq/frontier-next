"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  FocusItem,
  SourceId,
  SourceSnapshot,
  SpaceId,
} from "../../lib/types";
import { sourceById } from "../../lib/sources";
import { readSaved, writeSaved } from "../../lib/storage";
import { useDayKey } from "../../lib/dayKey";
import { SearchPick } from "../sticker/SearchPick";
import { onDay, type BillDue, type ScheduleSnapshot } from "../../lib/schedule";
import { PLAN, loadLanes, updatePinDetails, usePriorityPins } from "../../lib/priorityPins";
import { Row } from "../sticker/kit";
import { Icon } from "../sticker/Icon";
import { SITE_GROUPS } from "../sticker/StickerShell";
import { buildCatalog } from "./PriorityBoard";
import type { PriorityItem } from "./PriorityPanel";
import { useBrief } from "./DailyBrief";

const toneOf = (id: SourceId) =>
  SITE_GROUPS.find((g) => g.ids.includes(id))?.tone || "ops";
/** A fresh id for an added item (called from a click, never during render). */
const newId = () => Date.now();
type Scope = "all" | "today" | "focus" | "site";
type Pick = {
  ref: string;
  text: string;
  space: SourceId;
  from: "site" | "focus" | "today";
  sub: string;
};

const PARKING_KEY = "lifehub-parking-lot";

/** Today's Parking Lot: one scratch note for the day's work, plus a way to pin a note onto an existing task. */
function ParkingLot({ catalog }: { catalog: Map<string, PriorityItem> }) {
  const day = useDayKey();
  const [text, setText] = useState(() => readSaved<Record<string, string>>(PARKING_KEY, {})[day] || "");
  const [target, setTarget] = useState<{ key: string; label: string } | null>(null);
  const [attach, setAttach] = useState("");
  const [done, setDone] = useState("");
  const save = (v: string) => {
    setText(v);
    const all = readSaved<Record<string, string>>(PARKING_KEY, {});
    // Keep a week of days; older ones fall away.
    const next = { ...all, [day]: v };
    const keep = Object.keys(next).sort().slice(-7);
    writeSaved(PARKING_KEY, Object.fromEntries(keep.map((d) => [d, next[d]])));
  };
  const options = [...catalog.entries()].map(([key, item]) => ({
    key,
    label: item.title,
    sub: sourceById[item.source]?.name || item.source,
  }));
  const attachNow = () => {
    if (!target || !attach.trim()) return;
    const prev = loadLanes()[target.key]?.note?.trim();
    updatePinDetails(target.key, { note: `${prev ? `${prev}\n\n` : ""}${attach.trim()}` });
    setDone(`Added to “${target.label}” — it shows in that task's details.`);
    setAttach("");
    setTarget(null);
  };
  return (
    <div className="sk-parking">
      <p className="sk-sec">A scratch page for today’s work. Stays with the day; a new day starts clean.</p>
      <textarea
        className="sk-parking-text"
        value={text}
        onChange={(e) => save(e.target.value)}
        placeholder="Park thoughts, links, ideas and loose ends here…"
        aria-label="Today's Parking Lot"
        rows={9}
      />
      <h3 className="sk-cap sk-todayh">Attach a note to a task</h3>
      <SearchPick
        options={options}
        label="Search tasks to attach a note to"
        placeholder={target ? `Task: ${target.label}` : "Search for the task…"}
        onPick={(o) => {
          setTarget({ key: o.key, label: o.label });
          setDone("");
        }}
      />
      {target ? (
        <div className="sk-parking-attach">
          <textarea
            value={attach}
            onChange={(e) => setAttach(e.target.value)}
            placeholder={`Note for “${target.label}”…`}
            aria-label="Note to attach"
            rows={3}
          />
          <button type="button" className="sk-btn is-small" disabled={!attach.trim()} onClick={attachNow}>
            Attach to task
          </button>
        </div>
      ) : null}
      {done ? <p className="sk-cap" role="status">{done}</p> : null}
    </div>
  );
}

/** The Doing Now action list, in your order — live, so what's finished elsewhere drops out. */
export function usePlan(
  snapshots: Record<SourceId, SourceSnapshot>,
  bills: BillDue[],
) {
  const { pins, lanes } = usePriorityPins();
  const catalog = useMemo(
    () => buildCatalog(snapshots, bills),
    [snapshots, bills],
  );
  const plan = useMemo(
    () =>
      pins
        .filter((k) => lanes[k]?.lane === PLAN)
        .map((k) => catalog.get(k))
        .filter((i): i is PriorityItem => Boolean(i)),
    [pins, lanes, catalog],
  );
  return { plan, catalog, lanes };
}

/** Is an added item finished? Site items count as done once the site no longer lists them. */
const isDone = (f: FocusItem, catalog: Map<string, PriorityItem>) =>
  f.done || (f.from === "site" && f.ref ? !catalog.has(f.ref) : false);
const listed = (focus: FocusItem[]) => focus.filter((f) => f.from && f.ref);

/** How many things are left on Today's List (action list + what you've added) — the badge. */
export function useTodayListCount(
  focus: FocusItem[],
  snapshots: Record<SourceId, SourceSnapshot>,
  bills: BillDue[],
) {
  const { plan, catalog } = usePlan(snapshots, bills);
  const inPlan = new Set(plan.map((i) => i.key));
  const added = listed(focus).filter(
    (f) => !isDone(f, catalog) && !(f.ref && inPlan.has(f.ref)),
  );
  return plan.length + added.length;
}

/**
 * Today's List: a sheet from the right. It holds only two things — the action list from Doing Now,
 * and whatever you search for and add here (from Today, Focus or any site).
 */
export function FocusDrawer({
  open,
  close,
  focus,
  setFocus,
  enter,
  snapshots,
  bills,
  schedule,
  onCompleteItem,
}: {
  open: boolean;
  close: () => void;
  focus: FocusItem[];
  setFocus: (items: FocusItem[]) => void;
  enter: (id: SpaceId) => void;
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  schedule: ScheduleSnapshot | null;
  onCompleteItem: (source: SourceId, item: PriorityItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [tab, setTab] = useState<"list" | "parking">("list");
  const closeRef = useRef<HTMLButtonElement>(null);
  const { plan, catalog } = usePlan(snapshots, bills);
  const brief = useBrief(snapshots, bills);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Everything you can pick from, by where it lives.
  const pool = useMemo<Pick[]>(() => {
    if (!open) return [];
    const out: Pick[] = [];
    const now = new Date();
    for (const e of schedule?.events || []) {
      if ((e.myStatus === "owner" || e.myStatus === "yes") && onDay(e, now))
        out.push({
          ref: `event:${e.id}`,
          text: e.title,
          space: "self",
          from: "today",
          sub: "Calendar · today",
        });
    }
    for (const s of brief)
      for (const r of s.rows.filter((r) => !r.id.startsWith("bill:")))
        out.push({
          ref: `brief:${r.id}`,
          text: r.title,
          space: r.go === "money" ? "radall" : r.go,
          from: "today",
          sub: `${s.label}${r.note ? ` · ${r.note}` : ""}`,
        });
    for (const key of ["lifehub-focus-now2", "lifehub-focus-weeks2"]) {
      const saved = readSaved<{
        items?: { id: string; title: string; done?: boolean }[];
      }>(key, {});
      for (const i of saved.items || [])
        if (!i.done)
          out.push({
            ref: `focus:${key}:${i.id}`,
            text: i.title,
            space: "self",
            from: "focus",
            sub: key.endsWith("now2")
              ? "Short-term focus · right now"
              : "Short-term focus · next few weeks",
          });
    }
    for (const [key, item] of catalog)
      out.push({
        ref: key,
        text: item.title,
        space: item.source,
        from: "site",
        sub: `${sourceById[item.source]?.name || item.source}${item.tag ? ` · ${item.tag}` : ""}`,
      });
    return out;
  }, [open, schedule, brief, catalog]);

  const have = new Set([
    ...listed(focus).map((f) => f.ref),
    ...plan.map((i) => i.key),
  ]);
  const q = query.trim().toLowerCase();
  const results = q
    ? pool
        .filter(
          (p) =>
            (scope === "all" || p.from === scope) &&
            !have.has(p.ref) &&
            `${p.text} ${p.sub}`.toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  function add(p: Pick) {
    setFocus([
      ...focus,
      {
        id: newId(),
        text: p.text,
        space: p.space,
        done: false,
        from: p.from,
        ref: p.ref,
      },
    ]);
    setQuery("");
  }
  const remove = (id: number) => setFocus(focus.filter((f) => f.id !== id));
  const toggle = (f: FocusItem) => {
    const item = f.from === "site" && f.ref ? catalog.get(f.ref) : undefined;
    if (item && !f.done) onCompleteItem(item.source, item);
    setFocus(focus.map((c) => (c.id === f.id ? { ...c, done: !c.done } : c)));
  };

  const added = listed(focus).filter(
    (f) => !(f.ref && plan.some((i) => i.key === f.ref)),
  );
  const left = plan.length + added.filter((f) => !isDone(f, catalog)).length;
  const total = plan.length + added.length;

  if (!open || typeof document === "undefined") return null;
  const host =
    document.querySelector(".sk-app") ||
    document.querySelector(".frontier-shell") ||
    document.body;
  const siteRow = (id: SourceId, onOpenSite: () => void) => {
    const src = sourceById[id];
    return (
      <button
        type="button"
        className="sk-link sk-origin"
        onClick={onOpenSite}
        title={`Open ${src?.name || id} in the Life Hub`}
      >
        <span className={`sk-sw tone-${toneOf(id)}`} aria-hidden="true" />
        {src?.name || id}
      </button>
    );
  };
  return createPortal(
    <div
      className="sk-dialog-back sk-sheetside-back"
      role="presentation"
      onClick={close}
    >
      <aside
        className="sk-sheetside tone-needs"
        role="dialog"
        aria-modal="true"
        aria-label="Today's List"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sk-dialog-head">
          <Icon name="checks" size={20} />
          <h2 className="sk-title">Today</h2>
        <div className="sk-seg sk-today-sheettabs" role="group" aria-label="Today">
          <button type="button" aria-pressed={tab === "list"} onClick={() => setTab("list")}>
            Today&apos;s list
          </button>
          <button type="button" aria-pressed={tab === "parking"} onClick={() => setTab("parking")}>
            Today&apos;s Parking Lot
          </button>
        </div>
          <button
            ref={closeRef}
            type="button"
            className="sk-btn is-icon is-small"
            onClick={close}
            aria-label="Close Today's List"
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        {tab === "parking" ? <ParkingLot catalog={catalog} /> : (<>
        <p className="sk-sec">
          {total ? `${left} of ${total} left · ` : ""}Your Doing Now action
          list, plus anything you search for and add below.
        </p>

        <div className="sk-todaysearch">
          <div className="sk-seg" role="group" aria-label="Where to search">
            {(
              [
                ["all", "All"],
                ["today", "Today"],
                ["focus", "Focus"],
                ["site", "Sites"],
              ] as [Scope, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={scope === id}
                onClick={() => setScope(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="sk-search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Today, Focus and sites to add…"
              aria-label="Search to add to today's list"
            />
          </label>
          {q ? (
            <div className="sk-list sk-todayresults">
              {results.length ? (
                results.map((p) => (
                  <Row
                    key={p.ref}
                    title={p.text}
                    sub={p.sub}
                    value={<span className="sk-link">+ Add</span>}
                    onOpen={() => add(p)}
                  />
                ))
              ) : (
                <p className="sk-empty">
                  Nothing matches “{query.trim()}”
                  {scope === "all" ? "" : " in that part"}.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <h3 className="sk-cap sk-todayh">Action list · from Doing Now</h3>
        <div className="sk-list sk-todaylist">
          {plan.map((item) => (
            <Row
              key={item.key}
              lead={
                <button
                  type="button"
                  className="sk-circle"
                  onClick={() => onCompleteItem(item.source, item)}
                  aria-label={`Mark "${item.title}" done`}
                >
                  <Icon name="check" size={12} />
                </button>
              }
              title={item.title}
              sub={siteRow(item.source, () => {
                enter(item.source);
                close();
              })}
            />
          ))}
          {!plan.length ? (
            <p className="sk-empty">
              Nothing in the Doing Now action list. Add things there and they
              show up here.
            </p>
          ) : null}
        </div>

        <h3 className="sk-cap sk-todayh">Added for today</h3>
        <div className="sk-list sk-todaylist">
          {added.map((f) => {
            const done = isDone(f, catalog);
            return (
              <Row
                key={f.id}
                className={done ? "is-done" : undefined}
                lead={
                  <button
                    type="button"
                    className={`sk-circle${done ? " is-on" : ""}`}
                    onClick={() => toggle(f)}
                    aria-pressed={done}
                    aria-label={
                      done
                        ? `Mark "${f.text}" not done`
                        : `Mark "${f.text}" done`
                    }
                  >
                    <Icon name="check" size={12} />
                  </button>
                }
                title={f.text}
                sub={siteRow(f.space, () => {
                  enter(f.space);
                  close();
                })}
                value={
                  <button
                    type="button"
                    className="sk-btn is-small is-icon is-quiet"
                    aria-label={`Remove ${f.text}`}
                    title="Remove"
                    onClick={() => remove(f.id)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                }
              />
            );
          })}
          {!added.length ? (
            <p className="sk-empty">
              Nothing added yet. Search above to pull something in.
            </p>
          ) : null}
        </div>
        </>)}
      </aside>
    </div>,
    host,
  );
}
