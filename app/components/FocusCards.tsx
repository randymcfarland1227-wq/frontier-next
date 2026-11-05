"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "../sticker/Icon";
import { deleteRemote, docTag, downloadRef, fetchRefBlob, formatSize, linkLabel, normalizeUrl, openRef, sortRefs, uploadRef, type FocusRef } from "../../lib/focusRefs";
import { openTaskPanel, pinKey } from "../../lib/priorityPins";
import { openDebtPop } from "./DebtPop";
import { FindingPop, type FindingTarget } from "./FindingPop";
import { addOwnItem, findingOf, ownItems, planLine, planShort, useFindings, type FindingStore, type PlanState } from "../../lib/finFindings";
import { latestLine, useGroupLog } from "../../lib/groupLog";
import { openSiteList, renameSiteList, useSiteLists, viewOfList, type SiteListsContextValue } from "../../lib/siteLists";
import { Dialog } from "../sticker/Dialog";
import { SearchPick, type Opt } from "../sticker/SearchPick";
import { sourceById } from "../../lib/sources";
import type { SourceId } from "../../lib/types";
import {
  dayKey,
  eventStart,
  fromDayKey,
  type BillDue,
} from "../../lib/schedule";
import {
  isSettled,
  useDebtFile,
  type DebtFile,
  type DebtItem,
  type DebtMarks,
} from "../../lib/debtFile";
import { mdSources, oosSources } from "./OutstandingView";
import type { Entry, SubList, SubTask } from "./FocusSection";
import { habitOptions, todayIso, useHabitCounts } from "../../lib/locks";
import { linkOptions, linkStatus } from "../../lib/goalLinks";
import { loadLedger, type CompletionLedger } from "../../lib/completions";
import { readSaved, STORAGE_KEYS } from "../../lib/storage";
import type { SourceSnapshot } from "../../lib/types";
import { addSelfItem, SELF_ITEMS_EVENT } from "../../lib/adapters/self";
import { FOCUS_PRIORITY_LABEL, orderFocus, type FocusPriority } from "../../lib/focusPriority";
import { FOCUS_SECTION_LABELS, type FocusSectionId } from "../../lib/focusRouting";

/** Something on the calendar a focus can count down to: a Google event, a Life Hub plan, a bill, a task with a day. */
export type LinkItem = {
  id: string;
  title: string;
  start: string;
  allDay?: boolean;
  /** "Calendar", "Plan", "Bill"… shown next to its date in the search */
  kind?: string;
};

type CardList = readonly [Entry[], (next: Entry[]) => void];
/** What a finance link needs to be read live. */
type FinCtx = { file: DebtFile | null; marks: DebtMarks; bills: BillDue[]; sl?: SiteListsContextValue; habitCount?: (habitId: string, from: string) => number | undefined; findings?: FindingStore; ledger?: CompletionLedger; ticktick?: SourceSnapshot };
export type OpenFinance = (itemId?: string, tab?: "owed" | "flow") => void;

const DAY = 86400000;
const midnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysBetween = (a: Date, b: Date) =>
  Math.round((midnight(b) - midnight(a)) / DAY);
const shortDate = (d: Date) =>
  d.toLocaleDateString([], { month: "short", day: "numeric" });
const numDate = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "?"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: n % 1 ? 2 : 0,
      });
const uid = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/* ── Finance links: each resolves to rows, read live from Finance (never copied) ── */

type FinRow = {
  id: string;
  name: string;
  amount: number | null;
  status: string;
  settled: boolean;
  unverified?: boolean;
  kind: "debt" | "bill";
};

export function debtItems(file: DebtFile | null, key: string): DebtItem[] {
  if (!file) return [];
  if (key === "tix:md") return mdSources(file).flatMap((s) => s.items);
  if (key === "tix:oos") return oosSources(file).flatMap((s) => s.items);
  if (key.startsWith("src:"))
    return (
      [...mdSources(file), ...oosSources(file)].find(
        (s) => s.id === key.slice(4),
      )?.items || []
    );
  if (key.startsWith("item:")) {
    const it = file.items.find((x) => x.id === key.slice(5));
    return it ? [it] : [];
  }
  return [];
}

function finRows(
  link: { key: string; label: string },
  ctx: FinCtx,
): FinRow[] {
  if (link.key.startsWith("bill:")) {
    const b = ctx.bills.find((x) => x.key === link.key.slice(5));
    if (b)
      return [
        {
          id: link.key,
          kind: "bill",
          name: b.bill.name,
          amount: b.bill.amount ?? null,
          status:
            b.days < 0
              ? `${-b.days}d overdue`
              : `due ${shortDate(fromDayKey(b.due))}`,
          settled: false,
        },
      ];
    // No longer owed: it was paid (or skipped) on Life Hub.
    return [
      {
        id: link.key,
        kind: "bill",
        name: link.label,
        amount: null,
        status: "paid",
        settled: true,
      },
    ];
  }
  if (link.key.startsWith("own:")) {
    const f = ctx.findings ? findingOf(ctx.findings, link.key) : undefined;
    if (!f) return [];
    return [{ id: link.key, kind: "debt" as const, name: f.name || link.label, amount: f.amount ?? null, status: f.paid ? "paid" : "open", settled: Boolean(f.paid) }];
  }
  return debtItems(ctx.file, link.key).map((i) => ({
    id: i.id,
    kind: "debt" as const,
    name: i.name,
    amount: foundAmount(ctx, i),
    status: i.unverified ? "unverified" : ctx.marks[i.id]?.status || "open",
    settled: isSettled(ctx.marks[i.id]),
    unverified: i.unverified,
  }));
}

/** The amount you found on Life Hub wins over the debt file's (which may be "?"). */
function foundAmount(ctx: FinCtx, i: DebtItem): number | null {
  const f = ctx.findings ? findingOf(ctx.findings, `item:${i.id}`) : undefined;
  return f && f.amount !== undefined ? f.amount : i.amount;
}

/** What the finding pop-out needs for a Finance link: where its amount saves, and what the letters say about a plan. */
function findingTarget(link: { key: string; label: string }, ctx: FinCtx): FindingTarget {
  const own = link.key.startsWith("own:");
  if (own) {
    const f = ctx.findings ? findingOf(ctx.findings, link.key) : undefined;
    return { key: link.key, label: f?.name || link.label, amountKey: link.key, amount: f?.amount ?? null };
  }
  const items = debtItems(ctx.file, link.key);
  const one = items.length === 1 ? items[0] : undefined;
  const step = link.key.startsWith("src:") ? ctx.file?.registration?.steps.find((s) => s.id === link.key.slice(4)) : undefined;
  const plan = one?.plan || step?.plan;
  return {
    key: link.key,
    label: link.label,
    amountKey: one ? `item:${one.id}` : undefined,
    amount: one ? one.amount : undefined,
    onFile: plan ? { state: plan.state, terms: plan.terms, enroll: plan.enroll } : null,
  };
}

/** Plan state for a Finance link: what you logged, else what the letters say, else not checked yet. */
function planOf(link: { key: string }, ctx: FinCtx): { state: PlanState; line: string } {
  const f = ctx.findings ? findingOf(ctx.findings, link.key) : undefined;
  if (f?.plan) return { state: f.plan, line: planLine(f) };
  const items = debtItems(ctx.file, link.key);
  const step = link.key.startsWith("src:") ? ctx.file?.registration?.steps.find((s) => s.id === link.key.slice(4)) : undefined;
  const st = (items.length === 1 ? items[0].plan?.state : undefined) || step?.plan?.state;
  return { state: st === "yes" || st === "ask" || st === "none" ? st : "unknown", line: "" };
}

/** Open / cleared counts and what's still owed (unverified items stay out, like Finance's own totals). */
function finStats(rows: FinRow[]) {
  const live = rows.filter((r) => !r.unverified);
  const done = live.filter((r) => r.settled).length;
  const owed = live
    .filter((r) => !r.settled)
    .reduce((s, r) => s + (r.amount || 0), 0);
  return { total: live.length, done, open: live.length - done, owed };
}


/** Everything in Finance a focus can be linked to, across tabs: ticket lists, bills due, every logged debt/account. */
function financeOptions(ctx: FinCtx): Opt[] {
  const out: Opt[] = [];
  const { file } = ctx;
  if (file) {
    out.push({ key: "tix:md", label: "MD tickets", sub: "whole list", group: "Lists" });
    for (const s of mdSources(file))
      out.push({
        key: `src:${s.id}`,
        label: `MD tickets · ${s.label}`,
        sub: "list",
        group: "Lists",
      });
    out.push({
      key: "tix:oos",
      label: "Out-of-state tickets",
      sub: "whole list",
      group: "Lists",
    });
    for (const s of oosSources(file))
      out.push({
        key: `src:${s.id}`,
        label: `Out-of-state · ${s.label}`,
        sub: "list",
        group: "Lists",
      });
  }
  for (const b of ctx.bills.filter((x) => !x.skipped))
    out.push({
      key: `bill:${b.key}`,
      label: b.bill.name,
      sub: `${usd(b.bill.amount)} · due ${shortDate(fromDayKey(b.due))}`,
      group: "Bills & payments due",
    });
  for (const f of ctx.findings ? ownItems(ctx.findings) : [])
    out.push({ key: f.key, label: f.name || "Money item", sub: `yours · ${usd(f.amount)}`, group: "Your money items" });
  for (const i of file?.items || [])
    out.push({
      key: `item:${i.id}`,
      label: i.name,
      sub: `${i.group} · ${usd(i.amount)}`,
      group: "Debts, tickets & accounts",
    });
  return out;
}

function taskDone(task: SubTask, ctx: FinCtx) {
  if (!task.fin) return task.done;
  const rows = finRows(task.fin, ctx);
  return rows.length > 0 && rows.every((r) => r.settled && !r.unverified);
}

/** % done across the hand-made sub-tasks and every linked finance item. */
/** A single site task linked into a focus by its pin key (`source:id`). */
function linkedTask(key: string, ctx: FinCtx) {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const site = key.slice(0, at) as SourceId;
  const id = key.slice(at + 1);
  const task = ctx.sl?.snapshots[site]?.tasks.find((t) => t.id === id);
  if (task) return { site, task };
  // Finished tasks drop out of the site feed: keep them (done) from the completion log.
  const gone = ctx.sl?.doneOf?.(site, id);
  return gone ? { site, task: { id, title: gone.title, status: "done" as const } } : null;
}

function progressOf(i: Entry, ctx: FinCtx) {
  const all = (i.lists || []).flatMap((l) => l.tasks);
  let total = all.length;
  let done = all.filter((t) => taskDone(t, ctx)).length;
  for (const l of i.fin || []) {
    const s = finStats(finRows(l, ctx));
    total += s.total;
    done += s.done;
  }
  for (const id of i.siteLists || []) {
    const l = ctx.sl?.store[id];
    if (!l || l.gone) continue;
    const v = viewOfList(l, ctx.sl!.snapshots, ctx.sl!.doneOf);
    total += v.total;
    done += v.done;
  }
  for (const k of i.siteTasks || []) {
    const t = linkedTask(k, ctx);
    if (!t) continue;
    total += 1;
    if (t.task.status === "done") done += 1;
  }
  if (i.habitGoal) {
    const n = ctx.habitCount?.(i.habitGoal.habitId, i.habitGoal.from) ?? 0;
    total += i.habitGoal.count;
    done += Math.min(n, i.habitGoal.count);
  }
  if (!total) return { pct: i.done ? 100 : null, done: 0, total: 0 } as const;
  return { pct: Math.round((done / total) * 100), done, total };
}

/* ── Dates ── */

/** When it was added: the saved day, else the timestamp every id starts with. */
function addedOf(i: Entry): Date | null {
  if (i.added) return fromDayKey(i.added);
  const n = Number(i.id);
  if (n > 1e12) return new Date(n);
  return i.since ? fromDayKey(i.since) : null;
}

/** The date it's counting to: the linked calendar item (live, so it follows if it moves), else a typed date. */
function targetOf(i: Entry, events: LinkItem[]) {
  const ev = i.eventId ? events.find((e) => e.id === i.eventId) : undefined;
  if (ev) return { date: eventStart(ev), title: ev.title };
  if (i.date) return { date: fromDayKey(i.date), title: i.eventTitle };
  return null;
}

/** The count and the date chip: days until the linked date, or days since it was added. */
function whenOf(i: Entry, events: LinkItem[]) {
  const target = targetOf(i, events);
  if (target) {
    const n = daysBetween(new Date(), target.date);
    return {
      big: n === 0 ? "Today" : n === 1 ? "Tomorrow" : String(Math.abs(n)),
      cap: n > 1 ? "days till" : n < 0 ? (n === -1 ? "day ago" : "days ago") : "",
      date: shortDate(target.date),
      num: numDate(target.date),
      linked: true,
    };
  }
  const added = addedOf(i);
  if (added) {
    const n = daysBetween(added, new Date());
    return {
      big: n === 0 ? "Today" : String(n),
      cap: n === 0 ? "added" : n === 1 ? "day in focus" : "days in focus",
      date: `Added ${shortDate(added)}`,
      num: `Added ${numDate(added)}`,
      linked: false,
    };
  }
  return { big: "—", cap: "", date: "", num: "", linked: false };
}

function Ring({ pct }: { pct: number | null }) {
  return (
    <span
      className={`sk-ring${pct === null ? " is-empty" : ""}`}
      style={{ "--p": pct ?? 0 } as React.CSSProperties}
      role="img"
      aria-label={pct === null ? "No sub-tasks yet" : `${pct}% done`}
    >
      <b>{pct === null ? "–" : `${pct}%`}</b>
    </span>
  );
}

function Card({
  item,
  events,
  ctx,
  open,
}: {
  item: Entry;
  events: LinkItem[];
  ctx: FinCtx;
  open: () => void;
}) {
  const p = progressOf(item, ctx);
  const w = whenOf(item, events);
  const glog = useGroupLog();
  const lists = (item.lists || []).slice(0, 3);
  const fins = (item.fin || []).map((l) => ({
    ...l,
    ...finStats(finRows(l, ctx)),
  }));
  const linked = (item.siteLists || [])
    .map((id) => ctx.sl?.store[id])
    .filter((l): l is NonNullable<typeof l> => Boolean(l && !l.gone))
    .map((l) => ({ l, ...viewOfList(l, ctx.sl!.snapshots, ctx.sl!.doneOf) }));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  return (
    <div
      className={`sk-fcard${item.done ? " is-done" : ""}${item.site || item.section ? " has-site" : ""}`}
      data-site={item.section || item.site || undefined}
      data-focus-priority={item.priority}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      aria-label={`${item.title} — open details`}
    >
      {item.site || item.section || item.ongoing ? (
        <span className="sk-fcard-tags">
          {item.site || item.section ? (
            <span className="sk-fcard-site">{item.section ? FOCUS_SECTION_LABELS[item.section] : sourceById[item.site!]?.shortName}</span>
          ) : null}
          {item.ongoing ? <span className="sk-fcard-ongoing">Ongoing</span> : null}
        </span>
      ) : null}
      {item.ongoing || item.section ? null : (
        <span className={`sk-fcard-corner${(p.pct ?? 0) >= 100 ? " is-full" : ""}`} aria-label={`${p.pct ?? 0}% complete`} title={p.total ? `${p.done} of ${p.total} done` : "No sub-tasks yet"}>
          <Ring pct={p.pct ?? 0} />
        </span>
      )}
      <h4 className="sk-fcard-t">{item.title}</h4>
      {item.refs?.length ? <span className="sk-fcard-refs" title={`${item.refs.length} reference${item.refs.length === 1 ? "" : "s"}`}><Icon name="clip" size={12} />{item.refs.length}</span> : null}
      {item.priority ? <span className="sk-focus-rank">{FOCUS_PRIORITY_LABEL[item.priority]}</span> : null}
      {item.note ? <p className="sk-fcard-scope">{item.note}</p> : null}
      {item.habitGoal ? (() => {
        const n = ctx.habitCount?.(item.habitGoal.habitId, item.habitGoal.from);
        return (
          <div className="fc-habit" title="Counts TickTick check-ins">
            <span>
              <b>{item.habitGoal.title}</b> · {n ?? "?"} of {item.habitGoal.count} done{(n ?? 0) >= item.habitGoal.count ? " ✓" : ""}
            </span>
            <div className="fc-habit-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, ((n ?? 0) / item.habitGoal.count) * 100)}%` }} />
            </div>
          </div>
        );
      })() : null}
      {item.links?.length ? (
        <ul className="fc-links" aria-label="Linked TickTick actions">
          {item.links.map((l) => {
            const st = linkStatus(l, ctx.ledger);
            return (
              <li key={l.id} className={st.doneToday ? "is-done" : ""} title={`${l.kind === "habit" ? "Habit" : "Task"} · done ${st.last7} of the last 7 days`}>
                <span aria-hidden="true">{st.doneToday ? "✓" : "○"}</span> {l.title}
                <small>{st.doneToday ? "today" : `${st.last7}/7`}</small>
              </li>
            );
          })}
        </ul>
      ) : null}
      {item.why ? (
        <p className="sk-fcard-why">
          <b>Why</b> {item.why}
        </p>
      ) : null}
      {lists.length || fins.length || linked.length ? (
        <div
          className="sk-fcard-lists"
          style={
            { "--cols": Math.min(3, lists.length + fins.length + linked.length) } as React.CSSProperties
          }
        >
          {linked.slice(0, 3).map(({ l, open, total }) => (
            <div key={l.id} className="is-fin">
              <b>
                <Icon name="steps" size={9} />
                {l.name}
              </b>
              <ul>
                <li className={open.length ? "" : "is-all"}>
                  {open.length ? `${open.length} of ${total} left` : "All done"}
                </li>
              </ul>
            </div>
          ))}
          {fins.slice(0, 3).map((f) => (
            <div key={f.key} className="is-fin">
              <b>
                <Icon name="wallet" size={9} />
                {f.label}
              </b>
              <ul>
                <li className={f.open ? "" : "is-all"}>
                  {f.open ? `${f.open} open · ${usd(f.owed)}` : "All cleared"}
                </li>
                {latestLine(glog, f.key) ? <li className="sk-fin-log">{latestLine(glog, f.key)}</li> : null}
              </ul>
            </div>
          ))}
          {lists.slice(0, Math.max(0, 3 - Math.min(fins.length + linked.length, 3))).map((l) => (
            <div key={l.id}>
              <b>{l.name}</b>
              <ul>
                {l.tasks
                  .filter((t) => !taskDone(t, ctx))
                  .slice(0, 1)
                  .map((t) => (
                    <li key={t.id}>{t.text}</li>
                  ))}
                {l.tasks.every((t) => taskDone(t, ctx)) && l.tasks.length ? (
                  <li className="is-all">All done</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sk-fcard-foot">
        <span className="sk-fcard-when">
          <b>{w.big}</b>
          {w.cap ? <small>{w.cap}</small> : null}
        </span>
        <span className="sk-fcard-date">
          {w.linked ? <Icon name="calendar" size={12} /> : null}
          {w.date}
        </span>
      </div>
    </div>
  );
}

/**
 * The pop-out, laid out like the sketch: percent complete · title · days till + date across the top,
 * Scope and Why side by side, then the lists (hand-made or linked from Finance) in a row of boxes.
 */
function Detail({
  item,
  events,
  ctx,
  openFinance,
  update,
  remove,
  close,
}: {
  item: Entry;
  events: LinkItem[];
  ctx: FinCtx;
  openFinance?: OpenFinance;
  update: (patch: Partial<Entry>) => void;
  remove: () => void;
  close: () => void;
}) {
  const glog = useGroupLog();
  const [listName, setListName] = useState("");
  const [financeListId, setFinanceListId] = useState("");
  const [taskText, setTaskText] = useState<Record<string, string>>({});
  // Checklist task whose pop-out (notes + due day) is open
  const [subOpen, setSubOpen] = useState<{ list: string; task: string } | null>(null);
  // Finding pop-out: log an amount / payment plan; `task` = a research task that gets checked off on save
  const [findOpen, setFindOpen] = useState<{ link: { key: string; label: string }; task?: { list: string; task: string } } | null>(null);
  const [ownName, setOwnName] = useState<Record<string, string>>({});
  const lists = item.lists || [];
  const setLists = (next: SubList[]) => update({ lists: next });
  const patchList = (id: string, patch: Partial<SubList>) =>
    setLists(lists.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addList = (e: FormEvent) => {
    e.preventDefault();
    if (!listName.trim()) return;
    setLists([...lists, { id: uid(), name: listName.trim(), tasks: [] }]);
    setListName("");
  };
  const addTask = (e: FormEvent, l: SubList) => {
    e.preventDefault();
    const text = (taskText[l.id] || "").trim();
    if (!text) return;
    patchList(l.id, {
      tasks: [...l.tasks, { id: uid(), text, done: false }],
    });
    setTaskText({ ...taskText, [l.id]: "" });
  };

  const addFinance = (list: SubList, link: { key: string; label: string }) => {
    if (list.tasks.some((t) => t.fin?.key === link.key)) return;
    patchList(list.id, {
      tasks: [...list.tasks, { id: uid(), text: link.label, done: false, fin: link }],
    });
  };
  const financeList = lists.find((l) => l.id === financeListId) || lists[0];
  const target = targetOf(item, events);
  const w = whenOf(item, events);
  const p = progressOf(item, ctx);
  const added = addedOf(item);
  const finOpts = financeOptions(ctx);
  const dateOpts: Opt[] = events
    .filter((e) => daysBetween(new Date(), eventStart(e)) >= -30)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())
    .map((e) => ({
      key: e.id,
      label: e.title,
      sub: `${e.kind || "Calendar"} · ${shortDate(eventStart(e))}`,
      group: e.kind || "Calendar",
    }));

  return (
    <Dialog
      label={item.title}
      onClose={close}
      className="sk-fdetail"
      backClassName="sk-fdetail-back"
      dataSite={item.site || undefined}
    >
        <header className="sk-fd-top">
          <div className="sk-fd-pct">
            <b>{p.pct === null ? "–" : `${p.pct}%`}</b>
            <small>completed</small>
          </div>
          <input
            className="sk-fd-title"
            value={item.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={120}
            aria-label="Focus"
          />
          <div className="sk-fd-when">
            <div>
              <b>{w.big}</b>
              {w.cap ? <small>{w.cap}</small> : null}
            </div>
            <span className="sk-fcard-date">
              {w.linked ? <Icon name="calendar" size={12} /> : null}
              {w.num}
            </span>
          </div>
          <button
            data-autofocus
            type="button"
            className="sk-btn is-small is-icon"
            onClick={close}
            aria-label="Close"
            title="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="sk-fd-two">
          <label className="sk-fd-box">
            <span>Scope</span>
            <textarea
              value={item.note || ""}
              onChange={(e) => update({ note: e.target.value || undefined })}
              placeholder="What it is — e.g. people at our home for Savannah’s baby shower"
              maxLength={600}
            />
          </label>
          <label className="sk-fd-box">
            <span>Why</span>
            <textarea
              value={item.why || ""}
              onChange={(e) => update({ why: e.target.value || undefined })}
              placeholder="Why it matters — e.g. so we can do his dog DNA test"
              maxLength={600}
            />
          </label>
        </div>

        <div className="sk-fd-three">
          {lists.map((l) => (
            <section key={l.id} className="sk-fd-box sk-fd-list">
              <header>
                <input
                  value={l.name}
                  aria-label="List name"
                  onChange={(e) => patchList(l.id, { name: e.target.value })}
                  maxLength={60}
                />
                <button
                  type="button"
                  className="sk-btn is-small is-icon is-quiet"
                  aria-label={`Remove list ${l.name}`}
                  title="Remove list"
                  onClick={() => setLists(lists.filter((x) => x.id !== l.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              </header>
              <ul>
                {l.tasks.map((t) => (
                  <li key={t.id} className={`${taskDone(t, ctx) ? "is-done" : ""}${t.fin ? " sk-fd-finrow" : ""}`}>
                    {t.fin ? (
                      <span className={`sk-fin-dot${taskDone(t, ctx) ? " is-on" : ""}`} aria-label={taskDone(t, ctx) ? "Cleared in Finance" : "Linked to Finance"} />
                    ) : <button
                      type="button"
                      className={`sk-circle${t.done ? " is-on" : ""}`}
                      aria-pressed={t.done}
                      aria-label={`Mark ${t.text} ${t.done ? "not done" : "done"}`}
                      title={t.fills && !t.done ? `Check off — then type what you found for ${t.fills.label}` : undefined}
                      onClick={() =>
                        t.fills && !t.done
                          ? setFindOpen({ link: t.fills, task: { list: l.id, task: t.id } })
                          : patchList(l.id, {
                              tasks: l.tasks.map((x) =>
                                x.id === t.id ? { ...x, done: !x.done } : x,
                              ),
                            })
                      }
                    >
                      <Icon name="check" size={12} />
                    </button>}
                    {t.fin ? (
                      <button
                        type="button"
                        className="sk-fin-name"
                        title={`${t.text} · Open in Finance`}
                        onClick={() =>
                          t.fin!.key.startsWith("bill:")
                            ? openFinance?.(undefined, "flow")
                            : t.fin!.key.startsWith("own:")
                              ? setFindOpen({ link: t.fin! })
                              : openDebtPop(t.fin!.key, t.text)
                        }
                      >
                        {t.text}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="sk-fd-taskopen"
                        title="Open its notes and due day"
                        onClick={() => setSubOpen({ list: l.id, task: t.id })}
                      >
                        {t.text}
                        {t.note ? <Icon name="pencil" size={12} className="sk-fd-hasnote" /> : null}
                      </button>
                    )}
                    {!t.fin && t.due ? <small className="sk-fd-due">{shortDate(new Date(`${t.due}T12:00`))}</small> : null}
                    {t.fills ? (() => {
                      const rows = finRows(t.fills, ctx);
                      const pl = planOf(t.fills, ctx);
                      const amt = rows.length === 1 ? rows[0].amount : undefined;
                      return (
                        <button type="button" className="sk-fd-fills" title={`Fills in ${t.fills.label} — tap to type what you found`} onClick={() => setFindOpen({ link: t.fills! })}>
                          → {t.fills.label}{amt != null ? ` · ${usd(amt)}` : ""}{pl.state !== "unknown" ? ` · ${planShort(pl.state)}` : ""}
                        </button>
                      );
                    })() : null}
                    {t.fin ? <small>{(() => {
                      const rows = finRows(t.fin, ctx);
                      if (!rows.length) return "Not loaded";
                      if (rows.some((r) => r.unverified)) return "Unverified";
                      if (taskDone(t, ctx)) return "Cleared";
                      if (rows.some((r) => !r.settled && r.amount == null)) return "Amount unknown";
                      return usd(finStats(rows).owed);
                    })()}</small> : null}
                    {t.fin && !t.fin.key.startsWith("bill:") ? (() => {
                      const pl = planOf(t.fin, ctx);
                      return (
                        <button
                          type="button"
                          className={`sk-fd-plan is-${pl.state}`}
                          title={`${planShort(pl.state)}${pl.line ? ` — ${pl.line}` : ""} · tap to log the amount / payment plan`}
                          onClick={() => setFindOpen({ link: t.fin! })}
                        >
                          {planShort(pl.state)}
                        </button>
                      );
                    })() : null}
                    <button
                      type="button"
                      className="sk-btn is-small is-icon is-quiet"
                      aria-label={`Remove ${t.text}`}
                      onClick={() =>
                        patchList(l.id, {
                          tasks: l.tasks.filter((x) => x.id !== t.id),
                        })
                      }
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <form className="sk-fc-add" onSubmit={(e) => addTask(e, l)}>
                <input
                  value={taskText[l.id] || ""}
                  onChange={(e) =>
                    setTaskText({ ...taskText, [l.id]: e.target.value })
                  }
                  placeholder="Add — e.g. Cake $100"
                  aria-label={`Add a sub-task to ${l.name}`}
                  maxLength={160}
                />
                <button
                  type="submit"
                  className="sk-btn is-small"
                  disabled={!(taskText[l.id] || "").trim()}
                >
                  <Icon name="plus" size={14} />
                </button>
              </form>
              <SearchPick
                options={finOpts}
                label={`Add Finance to ${l.name}`}
                placeholder="+ Add Finance item to this list"
                disabled={!finOpts.length}
                onPick={(o) => addFinance(l, { key: o.key, label: o.label })}
              />
              <form
                className="sk-fc-add sk-fd-own"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (ownName[l.id] || "").trim();
                  if (!name) return;
                  const key = addOwnItem(name);
                  addFinance(l, { key, label: name });
                  setOwnName({ ...ownName, [l.id]: "" });
                  setFindOpen({ link: { key, label: name } });
                }}
              >
                <input
                  value={ownName[l.id] || ""}
                  onChange={(e) => setOwnName({ ...ownName, [l.id]: e.target.value })}
                  placeholder="+ New money item — e.g. Renewal fee"
                  aria-label={`New money item in ${l.name}`}
                  maxLength={120}
                />
                <button type="submit" className="sk-btn is-small" disabled={!(ownName[l.id] || "").trim()}>
                  <Icon name="plus" size={14} />
                </button>
              </form>
            </section>
          ))}

          {(item.siteLists || []).map((id) => {
            const l = ctx.sl?.store[id];
            if (!l || l.gone) return null;
            const v = viewOfList(l, ctx.sl!.snapshots, ctx.sl!.doneOf);
            return (
              <section key={id} className="sk-fd-box sk-fd-list sk-fd-sitelist" data-site={l.site}>
                <header>
                  <b>
                    <Icon name="steps" size={13} />
                    <input
                      className="sk-fd-listname"
                      value={l.name}
                      onChange={(e) => renameSiteList(l.id, e.target.value)}
                      onBlur={(e) => renameSiteList(l.id, e.target.value.trim())}
                      aria-label="List name"
                      title="Rename this list (it renames on its site too)"
                      maxLength={60}
                    />
                  </b>
                  <button
                    type="button"
                    className="sk-btn is-small is-icon is-quiet"
                    aria-label={`Unlink ${l.name}`}
                    title="Unlink from this goal (the list stays in its site)"
                    onClick={() => update({ siteLists: (item.siteLists || []).filter((x) => x !== id) })}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </header>
                <p className="sk-fd-hint">
                  {sourceById[l.site].shortName} · {v.done} of {v.total} done
                </p>
                <ul>
                  {v.items.map((t) => (
                    <li key={t.id} className={t.done ? "is-done" : ""}>
                      <button
                        type="button"
                        className="sk-circle"
                        aria-label={t.done ? `Uncheck ${t.title}` : `Mark ${t.title} done`}
                        title={t.done ? (l.site === "ticktick" ? "Done in TickTick — reopen it there" : "Uncheck (not done yet)") : undefined}
                        disabled={t.done && (l.site === "ticktick" || !ctx.sl?.reopen)}
                        onClick={() => (t.done ? ctx.sl?.reopen?.(l.site, t.id) : ctx.sl?.complete(l.site, t.id))}
                      >
                        <Icon name="check" size={12} />
                      </button>
                      <button type="button" className="sk-fd-taskopen" title="Open its notes, questions and findings" onClick={() => openTaskPanel(pinKey(l.site, t.id))}>
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="sk-link" onClick={() => openSiteList(id)}>
                  Open the list
                  <Icon name="chevron" size={13} />
                </button>
              </section>
            );
          })}

          {(item.siteTasks || []).length ? (
            <section className="sk-fd-box sk-fd-list sk-fd-sitetasks">
              <header>
                <b>
                  <Icon name="check" size={13} />
                  Linked tasks
                </b>
              </header>
              <p className="sk-fd-hint">Single tasks from your sites; they stay on their site too.</p>
              <ul>
                {(item.siteTasks || []).map((k) => {
                  const hit = linkedTask(k, ctx);
                  const unlink = () => update({ siteTasks: (item.siteTasks || []).filter((x) => x !== k) });
                  if (!hit) return null;
                  const isDone = hit.task.status === "done";
                  return (
                    <li key={k} className={isDone ? "is-done" : ""}>
                      <button
                        type="button"
                        className="sk-circle"
                        aria-label={isDone ? `Uncheck ${hit.task.title}` : `Mark ${hit.task.title} done`}
                        title={isDone ? (hit.site === "ticktick" ? "Done in TickTick — reopen it there" : "Uncheck (not done yet)") : undefined}
                        disabled={isDone && (hit.site === "ticktick" || !ctx.sl?.reopen)}
                        onClick={() => (isDone ? ctx.sl?.reopen?.(hit.site, hit.task.id) : ctx.sl?.complete(hit.site, hit.task.id))}
                      >
                        <Icon name="check" size={12} />
                      </button>
                      <button type="button" className="sk-fd-taskopen" title="Open its notes, questions and findings" onClick={() => openTaskPanel(k)}>
                        {hit.task.title}
                      </button>
                      <small>{sourceById[hit.site].shortName}</small>
                      <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Unlink ${hit.task.title}`} title="Unlink (the task stays on its site)" onClick={unlink}>
                        <Icon name="close" size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {(item.fin || []).map((l) => {
            const rows = finRows(l, ctx);
            const s = finStats(rows);
            return (
              <section key={l.key} className="sk-fd-box sk-fd-list sk-fd-fin">
                <header>
                  <b>
                    <Icon name="wallet" size={13} />
                    {l.label}
                  </b>
                  <button
                    type="button"
                    className="sk-btn is-small is-icon is-quiet"
                    aria-label={`Unlink ${l.label}`}
                    title="Unlink from this focus"
                    onClick={() =>
                      update({ fin: (item.fin || []).filter((x) => x.key !== l.key) })
                    }
                  >
                    <Icon name="close" size={14} />
                  </button>
                </header>
                <p className="sk-fd-hint">
                  {s.total
                    ? `${s.done} of ${s.total} cleared · ${usd(s.owed)} still owed${latestLine(glog, l.key) ? ` · ${latestLine(glog, l.key)}` : ""}`
                    : ctx.file || l.key.startsWith("bill:")
                      ? "Nothing to show"
                      : "Finance data isn’t loaded here yet."}
                </p>
                <ul>
                  {rows.map((r) => (
                    <li key={r.id} className={r.settled ? "is-done" : ""}>
                      <span className={`sk-fin-dot${r.settled ? " is-on" : ""}`} aria-hidden="true" />
                      <button
                        type="button"
                        className="sk-fin-name"
                        title="Open its details"
                        onClick={() =>
                          r.kind === "bill"
                            ? openFinance?.(undefined, "flow")
                            : openDebtPop(`item:${r.id}`, r.name)
                        }
                      >
                        {r.name}
                      </button>
                      <small>
                        {r.status} · {usd(r.amount)}
                      </small>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="sk-link"
                  onClick={() =>
                    openFinance?.(undefined, l.key.startsWith("bill:") ? "flow" : "owed")
                  }
                >
                  Open in Finance
                  <Icon name="chevron" size={13} />
                </button>
              </section>
            );
          })}

          <form className="sk-fd-box sk-fd-newlist" onSubmit={addList}>
            <span className="sk-cap">New checklist for this focus</span>
            <input
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="New list — e.g. Clean"
              aria-label="New sub-task list"
              maxLength={60}
            />
            <button
              type="submit"
              className="sk-btn is-small"
              disabled={!listName.trim()}
            >
              <Icon name="plus" size={14} />
              Add list
            </button>
          </form>

          <RefsBox item={item} update={update} />
        </div>

        <div className="sk-fd-panels">
          <section className="sk-fd-panel" aria-label="Plan">
            <h3 className="sk-fd-panelh"><Icon name="calendar" size={14} />Plan</h3>
            <div className="sk-fd-fields">
          <label>
            <span className="sk-cap">Priority</span>
            <select
              aria-label="Focus priority"
              value={item.priority || ""}
              onChange={(e) => update({ priority: (e.target.value || undefined) as FocusPriority | undefined })}
            >
              <option value="">Unranked</option>
              {Object.entries(FOCUS_PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sk-cap">Ongoing goal</span>
            <select
              value={item.section ? `section:${item.section}` : item.site || ""}
              aria-label="Focus destination"
              onChange={(e) =>
                e.target.value.startsWith("section:")
                  ? update({ section: e.target.value.slice(8) as FocusSectionId, site: undefined, ongoing: true, unassigned: false })
                  : update({ site: (e.target.value || undefined) as SourceId | undefined, section: undefined, unassigned: !e.target.value, ...(e.target.value ? { ongoing: true } : {}) })
              }
            >
              <option value="">No destination</option>
              <optgroup label="Focus sections">{Object.entries(FOCUS_SECTION_LABELS).map(([id, label]) => <option key={id} value={`section:${id}`}>{label}</option>)}</optgroup>
              {(Object.keys(sourceById) as SourceId[]).map((sid) => (
                <option key={sid} value={sid}>
                  {sourceById[sid].name}
                </option>
              ))}
            </select>
          </label>
          {item.section === 'fitness' || item.push !== undefined ? <>
            <label><span className="sk-cap">Effort</span><select aria-label="Fitness effort" value={item.push || 2} onChange={e => update({ push: Number(e.target.value) })}><option value={1}>Steady</option><option value={2}>More</option><option value={3}>All in</option></select></label>
            <label><span className="sk-cap">Started</span><input type="date" aria-label="Fitness start date" value={item.since || ''} max={dayKey(new Date())} onChange={e => update({ since: e.target.value || undefined })} /></label>
          </> : null}
          <div className="sk-fd-wide">
            <span className="sk-cap">Date {target ? "· linked" : "· calendar or pick a day"}</span>
            {target ? (
              <div className="sk-fd-linked">
                <Icon name="calendar" size={13} />
                <span>
                  {target.title ? `${target.title} · ` : ""}
                  {shortDate(target.date)}
                </span>
                <button
                  type="button"
                  className="sk-btn is-small is-icon is-quiet"
                  aria-label="Unlink the date"
                  onClick={() =>
                    update({ date: undefined, eventId: undefined, eventTitle: undefined })
                  }
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ) : (
              <div className="sk-fd-datepick">
                <SearchPick
                  options={dateOpts}
                  label="Search the calendar"
                  placeholder="Search events, plans, bills, tasks…"
                  onPick={(o) => {
                    const ev = events.find((x) => x.id === o.key);
                    if (!ev) return;
                    update({
                      eventId: ev.id,
                      eventTitle: ev.title,
                      date: dayKey(eventStart(ev)),
                    });
                  }}
                />
                <input
                  type="date"
                  aria-label="Or pick a date"
                  onChange={(e) =>
                    update({
                      date: e.target.value || undefined,
                      eventId: undefined,
                      eventTitle: undefined,
                    })
                  }
                />
              </div>
            )}
          </div>
            </div>
        {!target && added ? (
          <p className="sk-fd-hint">
            No date linked, so this counts days since it was added ({shortDate(added)}).
          </p>
        ) : null}
          </section>
          <section className="sk-fd-panel" aria-label="Link and add">
            <h3 className="sk-fd-panelh"><Icon name="plus" size={14} />Link &amp; add</h3>
            <div className="sk-fd-fields">
          <div>
            <span className="sk-cap">Task from any site</span>
            <SearchPick
              options={Object.entries(ctx.sl?.snapshots || {}).flatMap(([site, snap]) =>
                (snap?.tasks || [])
                  .filter(
                    (t) =>
                      t.status !== "done" &&
                      t.kind !== "list" &&
                      t.kind !== "habit" &&
                      !t.id.startsWith("habit-") &&
                      !(item.siteTasks || []).includes(pinKey(site as SourceId, t.id)),
                  )
                  .map((t) => ({
                    key: pinKey(site as SourceId, t.id),
                    label: t.title,
                    sub: sourceById[site as SourceId]?.shortName,
                    group: sourceById[site as SourceId]?.name,
                  })),
              )}
              label="Link a single task"
              placeholder="Search tasks on any site…"
              onPick={(o) => update({ siteTasks: [...(item.siteTasks || []), o.key] })}
            />
          </div>
          <div>
            <span className="sk-cap">Site list</span>
            <SearchPick
              options={Object.values(ctx.sl?.store || {})
                .filter((l) => l && !l.gone && !(item.siteLists || []).includes(l.id))
                .map((l) => ({
                  key: l.id,
                  label: l.name,
                  sub: `${sourceById[l.site].shortName} · ${viewOfList(l, ctx.sl!.snapshots, ctx.sl!.doneOf).open.length} left`,
                  group: sourceById[l.site].name,
                }))}
              label="Add a site list"
              placeholder={Object.values(ctx.sl?.store || {}).some((l) => l && !l.gone) ? "Search your site lists…" : "No site lists yet (make one from a site task’s menu)"}
              disabled={!Object.values(ctx.sl?.store || {}).some((l) => l && !l.gone)}
              onPick={(o) => update({ siteLists: [...(item.siteLists || []), o.key] })}
            />
          </div>
          <div className="sk-fd-finpick">
            <span className="sk-cap">Finance item → into a checklist</span>
            <select
              aria-label="List for Finance item"
              value={financeList?.id || ""}
              onChange={(e) => setFinanceListId(e.target.value)}
              disabled={!lists.length}
            >
              {!lists.length ? <option value="">Create a list first</option> : null}
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <SearchPick
              options={finOpts}
              label="Search Finance"
              placeholder="Search every bill, ticket, card, loan…"
              disabled={!finOpts.length || !financeList}
              onPick={(o) => {
                if (financeList) addFinance(financeList, { key: o.key, label: o.label });
              }}
            />
          </div>
            </div>
            <p className="sk-fd-hint">Linked tasks and lists stay on their sites too.</p>
          </section>
        </div>

        {item.ongoing ? <LinkedActionsBox item={item} update={update} ledger={ctx.ledger} ticktick={ctx.ticktick} /> : null}

        <HabitGoalBox item={item} update={update} count={ctx.habitCount} />

        <footer className="sk-fd-foot">
          {item.ongoing ? (
            <button
              type="button"
              className={`sk-btn is-small${item.inFocus ? " is-on" : ""}`}
              aria-pressed={Boolean(item.inFocus)}
              onClick={() => update({ inFocus: !item.inFocus })}
              title="Shows this goal in Short-term focus at the top of Today as well as on its site. It is one goal, so edits show in both."
            >
              <Icon name="target" size={14} />
              {item.inFocus ? "In Short-term focus — take it out" : "Show in Short-term focus"}
            </button>
          ) : null}
          <button
            type="button"
            className={`sk-btn is-small${item.done ? " is-on" : ""}`}
            aria-pressed={Boolean(item.done)}
            onClick={() => update({ done: !item.done })}
          >
            <Icon name="check" size={14} />
            {item.done ? "Marked done — undo" : "Mark the whole focus done"}
          </button>
          <button
            type="button"
            className="sk-btn is-small is-quiet"
            onClick={() => {
              remove();
              close();
            }}
          >
            Remove this focus
          </button>
        </footer>
      {(() => {
        const sl = subOpen ? lists.find((x) => x.id === subOpen.list) : undefined;
        const st = sl?.tasks.find((x) => x.id === subOpen?.task);
        if (!sl || !st) return null;
        const patch = (p: Partial<SubTask>) =>
          patchList(sl.id, { tasks: sl.tasks.map((x) => (x.id === st.id ? { ...x, ...p } : x)) });
        const fillOpts = lists.flatMap((x) => x.tasks.flatMap((y) => (y.fin && !y.fin.key.startsWith("bill:") ? [y.fin] : [])));
        return <SubTaskPop task={st} listName={sl.name} patch={patch} fillOpts={fillOpts} close={() => setSubOpen(null)} />;
      })()}
      {findOpen ? (() => {
        const tl = findOpen.task ? lists.find((x) => x.id === findOpen.task!.list) : undefined;
        const tt = tl?.tasks.find((x) => x.id === findOpen.task!.task);
        return (
          <FindingPop
            target={findingTarget(findOpen.link, ctx)}
            doneTask={tt?.text}
            onSaved={tl && tt ? () => patchList(tl.id, { tasks: tl.tasks.map((x) => (x.id === tt.id ? { ...x, done: true } : x)) }) : undefined}
            close={() => setFindOpen(null)}
          />
        );
      })() : null}
    </Dialog>
  );
}

const REG_SEED = "reg-lists-v1";
const needsRegSeed = (x: Entry) => !x.done && /registration\s+renew/i.test(x.title) && !(x.seeded || []).includes(REG_SEED);

/** Research → Payments (tickets) → MD state tax, flags & renewal fee, with research tasks wired to what they fill in. */
function seedRegistration(x: Entry, file: DebtFile): Entry {
  const srcLabel = (id: string) => `MD tickets · ${mdSources(file).find((s) => s.id === id)?.label || id}`;
  const fin = (key: string, label: string): SubTask => ({ id: uid(), text: label, done: false, fin: { key, label } });
  const task = (text: string, fills?: { key: string; label: string }): SubTask => ({ id: uid(), text, done: false, ...(fills ? { fills } : {}) });
  const fee = addOwnItem("Registration renewal fee", { amount: null, plan: "unknown", contact: "MVA renewal notice · mva.maryland.gov" }, "reg-renewal-fee");
  const flags = addOwnItem("MVA flag fees (13 × $30)", { amount: 390, plan: "none", terms: "Fee invoice — pay in full, after each ticket clears", contact: "mymva.maryland.gov · 410-768-7000" }, "mva-flag-fees");
  const lists = x.lists || [];
  const tickets = lists.find((l) => l.tasks.some((t) => t.fin?.key.startsWith("src:")) || /ticket/i.test(l.name));
  const rest = lists.filter((l) => l !== tickets);
  const taxName = file.items.find((i) => i.id === "md-tax")?.name || "MD income tax 2025";
  const research: SubList = {
    id: uid(),
    name: "Research",
    tasks: [
      task("Find the registration renewal fee", { key: fee, label: "Registration renewal fee" }),
      task("Look up the MDTA flag amount (DriveEzMD or MVA 1-800-950-1682)", { key: "src:mdta", label: srcLabel("mdta") }),
      task("Ask CCU about a payment arrangement (1-888-248-0345)", { key: "src:ccu", label: srcLabel("ccu") }),
      task("Check the MD tax balance now + plan options", { key: "item:md-tax", label: taxName }),
      task("Confirm MVA has the Root insurance policy on file"),
    ],
  };
  const payments: SubList = tickets
    ? { ...tickets, name: "Payments (tickets)" }
    : { id: uid(), name: "Payments (tickets)", tasks: ["city", "county", "ccu", "mdta"].map((id) => fin(`src:${id}`, srcLabel(id))) };
  const tax: SubList = {
    id: uid(),
    name: "MD state tax, flags & renewal fee",
    tasks: [fin("item:md-tax", taxName), fin(flags, "MVA flag fees (13 × $30)"), fin(fee, "Registration renewal fee")],
  };
  return { ...x, lists: [research, payments, tax, ...rest], seeded: [...(x.seeded || []), REG_SEED] };
}

const TICKET_SEED = "md-ticket-lists-v1";
const needsTicketSeed = (x: Entry) => !x.done && /speeding\s+ticket/i.test(x.title) && !(x.seeded || []).includes(TICKET_SEED);

/** Research / Watch For / Actions for the MD speeding ticket card (Randy's plan, one-time). */
const TICKET_LISTS: [string, [string, string][]][] = [
  ["Research", [
    ["Legal Outcomes & Consequences", "Dismissal, stet, PBJ, reduced charges, points, fines, insurance implications, and eligibility."],
    ["Citation & Evidence Review", "The 91-mph allegation, speed-measurement method, equipment accuracy, ramp conditions, posted limits, and work zones."],
    ["Representation Options", "Public defender eligibility, application requirements, free legal consultations, and affordable alternatives."],
    ["Court Procedures & Rights", "Mandatory appearance, discovery, evidence requests, plea procedures, deadlines, and possible negotiations."],
    ["Case Strategy & Mitigation", "Compare viable defenses and resolutions; identify what evidence, driving history, or preparation strengthens the case."],
  ]],
  ["Watch For", [
    ["Court Notice & Hearing Date", "Trigger: Citation processed; hearing date arrives by mail or appears in Case Search."],
    ["Legal Assistance Updates", "Trigger: Public defender decision, attorney communications, or requests for documents."],
    ["Evidence & Court Deadlines", "Trigger: Discovery responses, required submissions, schedule changes, or court orders."],
    ["Disposition & MVA Updates", "Trigger: Final ruling, payment obligations, MVA points, and insurance renewal changes."],
  ]],
  ["Actions", [
    ["Document the Incident", "Save citation; record the ramp, officer's statements, speed signs, traffic, and recollection of the stop.\nDependency: None — do now."],
    ["Secure Legal Assistance", "Apply for a public defender and explore free or affordable alternatives if necessary.\nDependency: Financial documentation and application requirements. Court date not needed to apply."],
    ["Confirm Court Information", "Monitor Case Search, verify mailing address, record the hearing date, and schedule reminders.\nDependency: Court processing and scheduling."],
    ["Request & Review Evidence", "Pursue available speed-measurement records, officer documentation, relevant video, and posted-limit evidence through the applicable procedures.\nDependency: Confirm the proper request process; coordinate with counsel if appointed. Preservation may be urgent."],
    ["Finalize Defense Strategy", "Review available evidence with counsel if possible; choose whether to contest the charge or pursue a negotiated resolution/PBJ. Prepare mitigating documentation.\nDependency: Legal advice where available and sufficient case information."],
    ["Attend Court & Resolve Case", "Appear as directed, pursue the chosen outcome, obtain the written disposition, complete requirements, and verify MVA/insurance treatment.\nDependency: Hearing date and strategy preparation; post-hearing compliance depends on the ruling."],
  ]],
];

function seedTicket(x: Entry): Entry {
  const have = new Set((x.lists || []).map((l) => l.name.trim().toLowerCase()));
  const add: SubList[] = TICKET_LISTS.filter(([name]) => !have.has(name.toLowerCase())).map(([name, rows]) => ({
    id: uid(),
    name,
    tasks: rows.map(([text, note]) => ({ id: uid(), text, done: false, note })),
  }));
  return { ...x, lists: [...(x.lists || []), ...add], seeded: [...(x.seeded || []), TICKET_SEED] };
}

/** Last saved TickTick pull + completion log, for cards opened where the live ones aren't passed in. */
const savedTickTick = () => readSaved<Partial<Record<SourceId, SourceSnapshot>>>(STORAGE_KEYS.snapshots, {}).ticktick;

/** Only read the saved log / pull when some card here is an ongoing goal or has linked actions. */
function linkCtx(lists: CardList[], ledger?: CompletionLedger, ticktick?: SourceSnapshot) {
  const need = lists.some(([items]) => items.some((x) => x.ongoing || x.links?.length));
  return need ? { ledger: ledger ?? loadLedger(), ticktick: ticktick ?? savedTickTick() } : { ledger, ticktick };
}

/** Daily Brief opens the very same editor without switching Today tabs. */
export function FocusEntryDialog({ bills, events: eventsIn, ...props }: Omit<Parameters<typeof Detail>[0], 'ctx'> & { bills: BillDue[] }) {
  // Raw copy: focus cards lay findings over it themselves (own: items stay findings, not debt items).
  const { raw: file, rawMarks: marks } = useDebtFile();
  const sl = useSiteLists();
  const findings = useFindings();
  const events = file?.registration ? [...eventsIn, {
    id: "fin:registration",
    title: `${file.registration.vehicle} registration renews`,
    start: file.registration.due,
    allDay: true,
    kind: "Finance",
  }] : eventsIn;
  return <Detail {...props} events={events} ctx={{ file, marks, bills, sl, findings, ledger: loadLedger(), ticktick: savedTickTick() }} />;
}

/** Short-term focus as cards: the square shows focus, scope, why and the lists; tap it for the full pop-out. */
export function FocusCards({
  list,
  extra = [],
  events: eventsIn,
  bills = [],
  openFinance,
  label,
  empty,
  noAdd,
  defaults,
  ticktick,
  ledger,
}: {
  /** Last TickTick pull + completion log (ongoing goals show their linked habits/tasks) */
  ticktick?: SourceSnapshot;
  ledger?: CompletionLedger;
  /** Where new entries go */
  list: CardList;
  /** More lists shown in the same grid (their entries are edited in place) */
  extra?: CardList[];
  events: LinkItem[];
  /** Bills still owed — linkable like debts */
  bills?: BillDue[];
  /** Jump to Finance, onto one item when given */
  openFinance?: OpenFinance;
  label: string;
  empty?: string;
  /** No "add" box (ongoing goals are made from Self) */
  noAdd?: boolean;
  defaults?: Partial<Entry>;
}) {
  // Raw copy: focus cards lay findings over it themselves (own: items stay findings, not debt items).
  const { raw: file, rawMarks: marks } = useDebtFile();
  const sl = useSiteLists();
  const lists0 = [list, ...extra];
  const goals = lists0.flatMap(([items]) => items.flatMap((x) => (x.habitGoal ? [{ habitId: x.habitGoal.habitId, from: x.habitGoal.from }] : [])));
  const habitCount = useHabitCounts(goals);
  const findings = useFindings();
  const ctx: FinCtx = { file, marks, bills, sl, habitCount, findings, ...linkCtx(lists0, ledger, ticktick) };
  // One-time: the MD registration card gets its Research / Payments / Tax-flags-fee lists (never twice).
  useEffect(() => {
    if (!file) return;
    for (const [items, save] of lists0) {
      if (!items.some(needsRegSeed)) continue;
      save(items.map((x) => (needsRegSeed(x) ? seedRegistration(x, file) : x)));
    }
  });
  // One-time: the MD speeding ticket card gets its Research / Watch For / Actions lists.
  useEffect(() => {
    for (const [items, save] of lists0) {
      if (items.some(needsTicketSeed)) save(items.map((x) => (needsTicketSeed(x) ? seedTicket(x) : x)));
    }
  });
  // A habit goal reached: the card finishes itself and a task to delete the TickTick habit is added (once).
  useEffect(() => {
    for (const [items, save] of lists0) {
      const hit = items.filter((x) => x.habitGoal && !x.done && !x.habitGoal.cleanupTaskId && (habitCount(x.habitGoal.habitId, x.habitGoal.from) ?? 0) >= x.habitGoal.count);
      if (!hit.length) continue;
      const ids = new Map<string, string>();
      for (const x of hit) {
        const [made] = addSelfItem(`Delete the TickTick habit “${x.habitGoal!.title}”`, `${x.title} is done: ${x.habitGoal!.count} check-ins reached. The habit isn't needed any more.`);
        ids.set(x.id, made.id);
      }
      window.dispatchEvent(new CustomEvent(SELF_ITEMS_EVENT));
      save(items.map((x) => (ids.has(x.id) ? { ...x, done: true, habitGoal: { ...x.habitGoal!, cleanupTaskId: ids.get(x.id) } } : x)));
    }
  });
  // The MD registration renewal date is a date a focus can count down to, too.
  const events: LinkItem[] = file?.registration
    ? [
        ...eventsIn,
        {
          id: "fin:registration",
          title: `${file.registration.vehicle} registration renews`,
          start: file.registration.due,
          allDay: true,
          kind: "Finance",
        },
      ]
    : eventsIn;
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const lists = [list, ...extra];
  const all = lists.flatMap(([items], li) => items.map((item) => ({ item, li })));
  const patchIn = (id: string, fn: (x: Entry) => Entry | null) => {
    const hit = all.find((a) => a.item.id === id);
    if (!hit) return;
    const [items, save] = lists[hit.li];
    save(
      items
        .map((x) => (x.id === id ? fn(x) : x))
        .filter((x): x is Entry => x !== null),
    );
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const id = `${Date.now()}`;
    list[1]([...list[0], { ...defaults, id, title: title.trim(), added: dayKey(new Date()) }]);
    setTitle("");
    setOpenId(id);
  };
  const ordered = orderFocus(all.map((a) => a.item));
  const openItem = all.find((a) => a.item.id === openId)?.item;
  return (
    <>
      {ordered.length ? (
        <div className="sk-fcards">
          {ordered.map((i) => (
            <Card
              key={i.id}
              item={i}
              events={events}
              ctx={ctx}
              open={() => setOpenId(i.id)}
            />
          ))}
        </div>
      ) : empty ? (
        <p className="sk-empty">{empty}</p>
      ) : null}
      {noAdd ? null : (
        <form className="sk-fc-add" onSubmit={add}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label}
            aria-label={label}
            maxLength={120}
          />
          <button
            type="submit"
            className="sk-btn is-small"
            disabled={!title.trim()}
          >
            <Icon name="plus" size={14} />
            Add
          </button>
        </form>
      )}
      {openItem ? (
        <Detail
          item={!openItem.site && !openItem.section && !openItem.unassigned && defaults?.section ? { ...openItem, section: defaults.section, ongoing: true } : openItem}
          events={events}
          ctx={ctx}
          openFinance={openFinance}
          update={(patch) => patchIn(openItem.id, (x) => ({ ...x, ...patch }))}
          remove={() => patchIn(openItem.id, () => null)}
          close={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

/** A focus checklist task's own pop-out: rename it, jot sub-details, give it an optional due day. */
function SubTaskPop({ task, listName, patch, fillOpts = [], close }: { task: SubTask; listName: string; patch: (p: Partial<SubTask>) => void; fillOpts?: Array<{ key: string; label: string }>; close: () => void }) {
  const closeNow = useRef(close);
  useEffect(() => {
    closeNow.current = close;
  });
  useEffect(() => {
    // Escape closes just this pop-out, not the focus card behind it.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeNow.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="sk-subpop-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sk-subpop" role="dialog" aria-modal="true" aria-label={task.text}>
        <header className="sk-subpop-head">
          <button
            type="button"
            className={`sk-circle${task.done ? " is-on" : ""}`}
            aria-pressed={task.done}
            aria-label={`Mark ${task.text} ${task.done ? "not done" : "done"}`}
            onClick={() => patch({ done: !task.done })}
          >
            <Icon name="check" size={12} />
          </button>
          <input
            className="sk-subpop-title"
            value={task.text}
            onChange={(e) => patch({ text: e.target.value })}
            onBlur={(e) => patch({ text: e.target.value.trim() || task.text })}
            aria-label="Task name"
            maxLength={160}
            data-autofocus
          />
          <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={close} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="sk-subpop-from">In checklist · {listName}</p>
        <label className="sk-subpop-field">
          <span className="sk-cap">Details</span>
          <textarea
            value={task.note || ""}
            onChange={(e) => patch({ note: e.target.value || undefined })}
            rows={5}
            placeholder="Sub-details, steps, numbers, who to call…"
          />
        </label>
        <label className="sk-subpop-field">
          <span className="sk-cap">Research for (optional)</span>
          <select
            value={task.fills?.key || ""}
            onChange={(e) => {
              const o = fillOpts.find((x) => x.key === e.target.value);
              patch({ fills: o ? { key: o.key, label: o.label } : undefined });
            }}
            aria-label="Finance item this task fills in"
          >
            <option value="">Not linked</option>
            {fillOpts.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <small className="sk-fd-hint">{fillOpts.length ? "Checking it off asks for the amount / payment plan you found and saves it on that item." : "Add a Finance item to one of this card's lists first."}</small>
        </label>
        <div className="sk-subpop-row">
          <label className="sk-subpop-field">
            <span className="sk-cap">Due day (optional)</span>
            <input type="date" value={task.due || ""} onChange={(e) => patch({ due: e.target.value || undefined })} />
          </label>
          {task.due ? (
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => patch({ due: undefined })}>
              Clear date
            </button>
          ) : null}
          <button type="button" className="sk-btn is-small" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Done after a TickTick habit is checked in N times" for a focus card. */
/** Ongoing goals: TickTick habits / recurring tasks that move it forward, with whether each is done today. */
function LinkedActionsBox({ item, update, ledger, ticktick }: { item: Entry; update: (patch: Partial<Entry>) => void; ledger?: CompletionLedger; ticktick?: SourceSnapshot }) {
  const links = item.links || [];
  const opts = linkOptions(ticktick, habitOptions()).filter((o) => !links.some((l) => l.id === o.id));
  const pick: Opt[] = opts.map((o) => ({ key: o.id, label: o.title, group: o.kind === "habit" ? "Habits" : "Tasks" }));
  return (
    <section className="sk-fd-box fc-habit fc-linkbox">
      <span><b>Linked TickTick actions</b></span>
      {links.length ? (
        <ul className="fc-links">
          {links.map((l) => {
            const st = linkStatus(l, ledger);
            return (
              <li key={l.id} className={st.doneToday ? "is-done" : ""}>
                <span aria-hidden="true">{st.doneToday ? "✓" : "○"}</span> {l.title}
                <small>{l.kind === "habit" ? "Habit" : "Task"} · {st.doneToday ? "done today" : "not yet today"} · {st.last7} of last 7 days</small>
                <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Unlink ${l.title}`} onClick={() => update({ links: links.filter((x) => x.id !== l.id) })}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <SearchPick
        options={pick}
        label="Link a TickTick habit or task"
        placeholder={opts.length ? "+ Link a TickTick habit or recurring task" : "Open the TickTick tab once to load your habits and tasks"}
        disabled={!opts.length}
        onPick={(o) => {
          const hit = opts.find((x) => x.id === o.key);
          if (hit) update({ links: [...links, hit] });
        }}
      />
      <small>Finishing it in TickTick (or here on Life Hub) counts toward this goal.</small>
    </section>
  );
}

function HabitGoalBox({ item, update, count }: { item: Entry; update: (patch: Partial<Entry>) => void; count?: (habitId: string, from: string) => number | undefined }) {
  const g = item.habitGoal;
  const [habitId, setHabitId] = useState(g?.habitId || "");
  const [times, setTimes] = useState(String(g?.count || 5));
  const [from, setFrom] = useState(g?.from || todayIso());
  const [editing, setEditing] = useState(false);
  const habits = habitOptions();
  const save = () => {
    const h = habits.find((x) => x.id === habitId);
    const n = Math.round(Number(times));
    if (!h || !(n > 0)) return;
    update({ habitGoal: { habitId: h.id, title: h.title, count: n, from: from || todayIso() } });
    setEditing(false);
  };
  const n = g ? count?.(g.habitId, g.from) : undefined;
  return (
    <section className="sk-fd-box fc-habit">
      <span><b>Done after a TickTick habit</b></span>
      {g && !editing ? (
        <>
          <span>
            {g.title}: {n ?? "?"} of {g.count} check-ins since {g.from}
            {g.cleanupTaskId ? " · finished, and a task to delete the habit was added" : ""}
          </span>
          <div className="fc-habit-row">
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => update({ habitGoal: undefined })}>Remove</button>
          </div>
        </>
      ) : (
        <div className="fc-habit-row">
          <select value={habitId} onChange={(e) => setHabitId(e.target.value)} aria-label="TickTick habit">
            <option value="">Pick a TickTick habit…</option>
            {habits.map((h) => (
              <option key={h.id} value={h.id}>{h.title}</option>
            ))}
          </select>
          <label>
            <span>Times</span>
            <input type="number" min={1} max={365} value={times} onChange={(e) => setTimes(e.target.value)} />
          </label>
          <label>
            <span>Counting from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <button type="button" className="sk-btn is-small" disabled={!habitId || !(Number(times) > 0)} onClick={save}>Save</button>
          {g ? <button type="button" className="sk-btn is-small is-quiet" onClick={() => setEditing(false)}>Cancel</button> : null}
          <small>When it&apos;s checked in that many times, this card is marked done and a task to delete the habit is added.</small>
        </div>
      )}
    </section>
  );
}

/** References: links, documents and images for this focus. Files live on the Worker (lib/focusRefs.ts). */
function RefsBox({ item, update }: { item: Entry; update: (patch: Partial<Entry>) => void }) {
  const refs = sortRefs(item.refs || []);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState<{ ref: FocusRef; src: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const live = useRef(item.refs || []);
  useEffect(() => { live.current = item.refs || []; }, [item.refs]);

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    const u = normalizeUrl(url);
    if (!u) return setErr("That doesn’t look like a web address.");
    const ref: FocusRef = { id: crypto.randomUUID(), kind: "link", title: label.trim() || linkLabel(u), url: u, at: new Date().toISOString() };
    update({ refs: [...live.current, ref] });
    setUrl("");
    setLabel("");
    setErr("");
  };
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr("");
    for (const f of Array.from(files)) {
      setBusy(`Uploading ${f.name}…`);
      try {
        const ref = await uploadRef(f);
        live.current = [...live.current, ref];
        update({ refs: live.current });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed.");
      }
    }
    setBusy("");
    if (fileInput.current) fileInput.current.value = "";
  };
  const remove = (r: FocusRef) => {
    if (r.fileId && !window.confirm(`Remove “${r.title}”? The stored file is deleted too.`)) return;
    deleteRemote(r);
    update({ refs: live.current.filter((x) => x.id !== r.id) });
  };
  const rename = (r: FocusRef) => {
    const t = window.prompt("Name", r.title)?.trim();
    if (t && t !== r.title) update({ refs: live.current.map((x) => (x.id === r.id ? { ...x, title: t.slice(0, 120) } : x)) });
  };
  const open = async (r: FocusRef) => {
    setErr("");
    if (r.kind !== "image") {
      try { await openRef(r); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t open it."); }
      return;
    }
    setBusy(`Opening ${r.title}…`);
    try {
      setView({ ref: r, src: URL.createObjectURL(await fetchRefBlob(r)) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t open it.");
    }
    setBusy("");
  };
  const closeView = () => {
    if (view) URL.revokeObjectURL(view.src);
    setView(null);
  };

  const images = refs.filter((r) => r.kind === "image");
  const rows = refs.filter((r) => r.kind !== "image");
  return (
    <section className="sk-fd-box sk-fd-list sk-fd-refs" aria-label="References">
      <header>
        <b>
          <Icon name="clip" size={13} />
          References
        </b>
        {refs.length ? <small>{refs.length}</small> : null}
      </header>
      <p className="sk-fd-hint">Links, documents and images for this focus.</p>
      {images.length ? (
        <div className="sk-ref-thumbs">
          {images.map((r) => (
            <div key={r.id} className="sk-ref-thumb">
              <button type="button" onClick={() => open(r)} title={`${r.title} — open full size`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL thumbnail */}
                {r.thumb ? <img src={r.thumb} alt={r.title} /> : <Icon name="file" size={18} />}
              </button>
              <button type="button" className="sk-ref-x" aria-label={`Remove ${r.title}`} title="Remove" onClick={() => remove(r)}>
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="sk-ref-rows">
          {rows.map((r) => (
            <li key={r.id}>
              <Icon name={r.kind === "link" ? "link" : "file"} size={13} />
              {r.kind === "link" ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.url} onContextMenu={(e) => { e.preventDefault(); rename(r); }}>
                  <span>{r.title}</span>
                  <small>{linkLabel(r.url || "")}</small>
                </a>
              ) : (
                <button type="button" className="sk-fd-taskopen" title="Open it" onClick={() => open(r)} onContextMenu={(e) => { e.preventDefault(); rename(r); }}>
                  <span>{r.title}</span>
                  <small>{`${docTag(r.title, r.type)} · ${formatSize(r.size)}`}</small>
                </button>
              )}
              <span className="sk-ref-tools">
                {r.kind === "doc" ? (
                  <button type="button" className="sk-btn is-small is-icon is-quiet sk-ref-dl" aria-label={`Download ${r.title}`} title="Download" onClick={() => downloadRef(r).catch((e) => setErr(String(e.message || e)))}>
                    <Icon name="chevron" size={13} />
                  </button>
                ) : null}
                <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Rename ${r.title}`} title="Rename" onClick={() => rename(r)}>
                  <Icon name="pencil" size={12} />
                </button>
                <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Remove ${r.title}`} title="Remove" onClick={() => remove(r)}>
                  <Icon name="close" size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="sk-ref-add" onSubmit={addLink}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link" aria-label="Link address" inputMode="url" />
        {url.trim() ? <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Link label" maxLength={120} /> : null}
        <div className="sk-ref-btns">
          <button type="submit" className="sk-btn is-small" disabled={!url.trim()}>
            <Icon name="link" size={13} />
            Add link
          </button>
          <button type="button" className="sk-btn is-small" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            <Icon name="plus" size={13} />
            Image / document
          </button>
        </div>
        <input ref={fileInput} type="file" hidden multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.pages,.numbers,.key,.heic" onChange={(e) => addFiles(e.target.files)} />
      </form>
      {busy ? <p className="sk-fd-hint" role="status">{busy}</p> : null}
      {err ? <p className="sk-ref-err" role="alert">{err}</p> : null}
      {view ? (
        <Dialog label={view.ref.title} onClose={closeView} className="sk-ref-view" backClassName="sk-ref-viewback">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob URL */}
          <img src={view.src} alt={view.ref.title} />
          <div className="sk-ref-viewbar">
            <span>{view.ref.title}</span>
            <a className="sk-btn is-small" href={view.src} download={view.ref.title}>Download</a>
            <button type="button" className="sk-btn is-small" onClick={closeView}>Close</button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
