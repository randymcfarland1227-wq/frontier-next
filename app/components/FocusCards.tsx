"use client";

import { confirmedProjectBillPayment } from "../../lib/projectFinance";

import { projectContinuation, saveProjectContinuation } from "../../lib/projectContinuation";
import { focusCardPinKey, focusPinItems, focusTaskPinKey } from "../../lib/focusPins";
import { isProject, openProject } from "../../lib/selfProjects";
import { goalGroupOf, readGoalTypes } from "../../lib/goalTypes";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MenuRow, useRowMenu, type RowMenuItem } from "./RowMenu";
import { useFold } from "./Collapsible";
import { Icon } from "../sticker/Icon";
import { deleteRemote, docTag, downloadRef, fetchRefBlob, formatSize, linkLabel, normalizeUrl, openRef, sortRefs, uploadRef, type FocusRef } from "../../lib/focusRefs";
import { DECK, PLAN, openTaskPanel, pinKey, placePin, unpin, usePriorityPins } from "../../lib/priorityPins";
import { openDebtPop } from "./DebtPop";
import { FindingPop, type FindingTarget } from "./FindingPop";
import { addOwnItem, findingOf, ownItems, planLine, planShort, setFinding, useFindings, type FindingStore, type PlanState } from "../../lib/finFindings";
import { setOwedDone, useOwedDone } from "../../lib/owedComplete";
import { loadCachedMoney, parseMoney } from "../../lib/money";
import { paidBillKeys } from "../../lib/schedule";
import { AUTO_RULES, syncAutoLists } from "../../lib/autoLists";
import { incomingDues, useIncoming } from "../../lib/incoming";
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
import { FLAG_FEE, isFlagged, mdSources, oosSources, outstandingParts, type OwedLine } from "./OutstandingView";
import { isTaskList, SendToDoing, type Entry, type SubList, type SubListKind, type SubTask } from "./FocusSection";
import { habitOptions, todayIso, useHabitCounts } from "../../lib/locks";
import { linkOptions, linkStatus } from "../../lib/goalLinks";
import { LOG_LABEL, tickTickOffMap } from "../../lib/ticktickLog";
import { loadLedger, type CompletionLedger } from "../../lib/completions";
import { getHabitSchedule } from "../../lib/ticktickDone";
import { habitDueOn } from "../../lib/energy";
import { localDayKey } from "../../lib/dayKey";
import { readSaved, STORAGE_KEYS } from "../../lib/storage";
import { openBillPop, requestPayBill } from "../../lib/finLinks";
import type { SourceSnapshot } from "../../lib/types";
import { addSelfItem, SELF_ITEMS_EVENT } from "../../lib/adapters/self";
import { ResearchButton } from "./ResearchPanel";
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
type OwedRef = OwedLine & { group: string };
type FinCtx = { owed?: Record<string, OwedRef>; file: DebtFile | null; marks: DebtMarks; bills: BillDue[]; sl?: SiteListsContextValue; habitCount?: (habitId: string, from: string) => number | undefined; findings?: FindingStore; ledger?: CompletionLedger; ticktick?: SourceSnapshot };
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
  /** Flagged MD ticket: local flag fee + the MVA $30 on top of the ticket (what it really costs to clear). */
  fees?: number;
};

/** "City 1000 · $95 ($40 ticket + $25 flag fee + $30 MVA)" → main line + the breakdown underneath. */
function splitFinText(text: string): [string, string] {
  const due = /^(.*?)\s*·\s*\$[\d.,]+\s+by\s+(\d\d\/\d\d)$/.exec(text);
  if (due) return [due[1], `Due ${due[2]}`];
  const unk = /^(.*?)\s*·\s*\?$/.exec(text);
  if (unk) return [unk[1], "Amount not known yet"];
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text);
  // With a breakdown underneath, the "· $95" moves to the amount on the right (it's the same number).
  return m ? [m[1].replace(/\s*·\s*\$[\d.,?]+$/, ""), m[2]] : [text, ""];
}

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
    const paid = confirmedProjectBillPayment(link.key.slice(5), ctx.ledger);
    const b = ctx.bills.find((x) => x.key === link.key.slice(5));
    if (b && !paid)
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
    // A partial, offline or different-month feed cannot prove that this payment was cleared.
    return [
      {
        id: link.key,
        kind: "bill",
        name: link.label,
        amount: null,
        status: paid ? "paid" : "Not in current finance data",
        settled: paid,
        unverified: !paid,
      },
    ];
  }
  if (link.key.startsWith("owed:")) {
    const l = ctx.owed?.[link.key.slice(5)];
    if (!l) return [];
    return [{ id: link.key, kind: "debt" as const, name: l.name || link.label, amount: l.amount ?? null, status: l.done ? "paid" : "open", settled: Boolean(l.done) }];
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
    fees: isFlagged(i) ? (i.ticket?.flagFee || 0) + FLAG_FEE : 0,
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
    .reduce((s, r) => s + (r.amount || 0) + (r.fees || 0), 0);
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
  for (const l of Object.values(ctx.owed || {}).filter((x) => !x.done && x.name))
    out.push({ key: `owed:${l.key}`, label: l.name, sub: `${l.group} · ${usd(l.amount)}`, group: `Current liabilities · ${l.group}` });
  for (const f of ctx.findings ? ownItems(ctx.findings) : [])
    out.push({ key: f.key, label: f.name || "Money item", sub: `${f.buy ? "task purchase" : "yours"} · ${usd(f.amount)}`, group: f.buy ? "Task purchases" : "Your money items" });
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
  if (task.pin) {
    const hit = linkedTask(task.pin, ctx);
    return hit ? hit.task.status === "done" : task.done;
  }
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
  const all = (i.lists || []).filter(isTaskList).flatMap((l) => l.tasks);
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


/** Current liabilities (Money › Liabilities: Projects / Required, Taxes / Legal, cash advances…), by line key,
 *  so a focus can link one and see / set it paid. Paid = struck in the sheet, marked complete there, or paid on Life Hub. */
function useOwedLines(file: DebtFile | null, marks: DebtMarks, bills: BillDue[]): Record<string, OwedRef> {
  const owedDone = useOwedDone();
  const snap = loadCachedMoney();
  const sig = snap?.refreshedAt || "";
  const model = useMemo(() => {
    try {
      const m = loadCachedMoney();
      return m ? parseMoney(m) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const paidAt = Object.fromEntries([...paidBillKeys(loadLedger())].map((k) => [k, "1"]));
  const parts = outstandingParts(model, file, marks, bills, paidAt, owedDone);
  const out: Record<string, OwedRef> = {};
  const add = (xs: OwedLine[], group: string) => xs.forEach((x) => { if (x.key) out[x.key] = { ...x, group }; });
  add(parts.projects, "Projects / Required");
  add(parts.taxes, "Taxes / Legal");
  add(parts.cashAdv, "Cash advances");
  add(parts.advances, "Older advances");
  add(parts.payLater, "Pay laters");
  return out;
}


/** Links whose paid state Life Hub can set itself: liabilities (owed:) and your own items / task purchases (own:). */
const settable = (key: string) => key.startsWith("owed:") || key.startsWith("own:");
function settleLink(key: string, on: boolean, ctx: FinCtx) {
  if (key.startsWith("owed:")) {
    const l = ctx.owed?.[key.slice(5)];
    setOwedDone(key.slice(5), on, Boolean(l?.recurring));
    if (!on && l?.legacyKey) setOwedDone(l.legacyKey, false);
  } else if (key.startsWith("own:")) setFinding(key, { paid: on });
}


/** Gallery tiles start with the small synced thumbnail, then swap in the full image from the backup (kept for the session). */
const fullImg = new Map<string, string>();
function RefImg({ r, full }: { r: FocusRef; full: boolean }) {
  const [src, setSrc] = useState(() => (r.fileId && fullImg.get(r.fileId)) || r.thumb || "");
  useEffect(() => {
    if (!full || !r.fileId || fullImg.has(r.fileId)) return;
    let live = true;
    fetchRefBlob(r)
      .then((b) => {
        const u = URL.createObjectURL(b);
        fullImg.set(r.fileId!, u);
        if (live) setSrc(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [full, r]);
  // eslint-disable-next-line @next/next/no-img-element -- local thumbnail / object URL
  return <img src={src} alt={r.title} loading="lazy" decoding="async" />;
}


/** Today's state of one TickTick habit: done, skipped / uncompleted, open, or not due today; plus the last 7 days. */
function habitDay(id: string, ledger: CompletionLedger, off: Record<string, string>) {
  const key = `habit-${id}`;
  const days = new Set(
    Object.values(ledger.entries)
      .filter((e) => e.source === "ticktick" && e.taskId === key)
      .map((e) => localDayKey(new Date(e.completedAt))),
  );
  const today = localDayKey();
  const sched = (getHabitSchedule() || []).find((h) => h.id === key || h.id === id);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = localDayKey(d);
    return { k, done: days.has(k), due: sched ? habitDueOn(sched, d) : true, label: d.toLocaleDateString([], { weekday: "narrow" }) };
  });
  const state = days.has(today) ? "done" : off[key] ? "off" : sched && !habitDueOn(sched, new Date()) ? "notdue" : "open";
  return { state, week, title: sched?.title };
}

/** A focus list that isn't check-off steps: Notes (bullets) or Habits (TickTick habits with today's state). */
function KindList({ l, ctx, patch, remove }: { l: SubList; ctx: FinCtx; patch: (p: Partial<SubList>) => void; remove: () => void }) {
  const [text, setText] = useState("");
  const { reopen } = useSiteLists();
  // Re-read the completion log after a check-off here or anywhere else.
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener("lifehub:completions", on);
    window.addEventListener("lifehub:synced", on);
    const t = window.setTimeout(on, 0);
    return () => {
      window.removeEventListener("lifehub:completions", on);
      window.removeEventListener("lifehub:synced", on);
      window.clearTimeout(t);
    };
  }, []);
  const ledger = loadLedger() || ctx.ledger;
  const off = tickTickOffMap() as Record<string, string>;
  const setRow = (id: string, next: string) => patch({ tasks: l.tasks.map((t) => (t.id === id ? { ...t, text: next } : t)) });
  const drop = (id: string) => patch({ tasks: l.tasks.filter((t) => t.id !== id) });
  const habitOpts: Opt[] = l.kind === "habits"
    ? habitOptions()
        .map((h) => ({ key: h.id.replace(/^habit-/, ""), label: h.title, sub: "TickTick habit", group: "Habits" }))
        .filter((o) => !l.tasks.some((t) => t.habitId === o.key))
    : [];
  return (
    <section className={`sk-fd-box sk-fd-list sk-fd-kind is-${l.kind}`}>
      <header>
        <input value={l.name} aria-label="List name" onChange={(e) => patch({ name: e.target.value })} />
        <small className="sk-fd-kindtag">{l.kind === "notes" ? "Notes" : "Habits · today"}</small>
        <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Remove list ${l.name}`} title="Remove list" onClick={remove}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {l.kind === "notes" ? (
        <ul className="sk-fd-notes">
          {l.tasks.map((t) => {
            const url = t.text.match(/https?:\/\/\S+/)?.[0];
            return (
              <li key={t.id}>
                <textarea value={t.text} rows={1} aria-label="Note" onChange={(e) => setRow(t.id, e.target.value)} onBlur={(e) => (!e.target.value.trim() ? drop(t.id) : null)} />
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" title={url} aria-label="Open link">↗</a> : null}
                <button type="button" className="sk-fd-notex" aria-label="Remove note" title="Remove" onClick={() => drop(t.id)}>
                  <Icon name="close" size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="sk-fd-habits">
          {l.tasks.length ? (
            <li className="sk-fd-hdays" aria-hidden="true">
              <span /><span /><span />
              <span className="sk-fd-week">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date();
                  d.setDate(d.getDate() - (6 - i));
                  return <b key={i} className={i === 6 ? "is-today" : ""}>{i === 6 ? "Today" : d.toLocaleDateString([], { weekday: "narrow" })}</b>;
                })}
              </span>
              <span />
            </li>
          ) : null}
          {l.tasks.map((t) => {
            const h = habitDay(t.habitId || "", ledger, off);
            return (
              <li key={t.id} className={`is-${h.state}`}>
                <button
                  type="button"
                  className="sk-fd-hstate"
                  disabled={h.state === "notdue" || h.state === "off"}
                  aria-label={h.state === "done" ? `Undo ${t.text} for today` : `Check off ${t.text} for today`}
                  title={h.state === "done" ? "Done today — tap to undo (also in TickTick and Daily Rhythm)" : h.state === "notdue" ? "Not due today" : h.state === "off" ? "Skipped today" : "Check off today (also in TickTick and Daily Rhythm)"}
                  onClick={() => {
                    const id = `habit-${t.habitId}`;
                    if (h.state === "done") reopen?.("ticktick", id);
                    else window.dispatchEvent(new CustomEvent("lifehub:complete-task", { detail: { source: "ticktick", id } }));
                    setTick((n) => n + 1);
                  }}
                >
                  {h.state === "done" ? "✓" : h.state === "off" ? "–" : h.state === "notdue" ? "·" : ""}
                </button>
                <span className="sk-fd-hname">{t.text}</span>
                <small className="sk-fd-hlabel">{h.state === "done" ? "Done today" : h.state === "off" ? "Skipped" : h.state === "notdue" ? "Not due today" : "Open"}</small>
                <span className="sk-fd-week" title="Last 7 days · today on the right">
                  {h.week.map((d, i) => (
                    <i key={d.k} className={`${d.done ? "is-done" : d.due ? "" : "is-off"}${i === 6 ? " is-today" : ""}`} title={`${d.k}${d.done ? " · done" : d.due ? "" : " · not due"}`} />
                  ))}
                </span>
                <button type="button" className="sk-fd-notex" aria-label={`Remove ${t.text}`} title="Remove" onClick={() => drop(t.id)}>
                  <Icon name="close" size={11} />
                </button>
              </li>
            );
          })}
          {!l.tasks.length ? <li className="sk-empty">Add TickTick habits below.</li> : null}
        </ul>
      )}
      {l.kind === "notes" ? (
        <form
          className="sk-fc-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            patch({ tasks: [...l.tasks, { id: uid(), text: text.trim(), done: false }] });
            setText("");
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="+ Add a note" aria-label={`Add a note to ${l.name}`} />
          <button type="submit" className="sk-btn is-small" disabled={!text.trim()}>
            <Icon name="plus" size={14} />
          </button>
        </form>
      ) : (
        <SearchPick
          options={habitOpts}
          label={`Add a habit to ${l.name}`}
          placeholder="+ Add a TickTick habit"
          disabled={!habitOpts.length}
          onPick={(o) => patch({ tasks: [...l.tasks, { id: uid(), text: o.label, done: false, habitId: o.key }] })}
        />
      )}
    </section>
  );
}


const KIND_LABELS: Array<[SubListKind, string]> = [["tasks", "Steps"], ["pay", "To pay"], ["buy", "To buy"], ["notes", "Notes"], ["habits", "Habits"]];
const KIND_HINT: Record<SubListKind, string> = {
  tasks: "Things to do: check-off steps (count toward %)",
  pay: "Bills and liabilities to pay: link them from Money (count toward %)",
  buy: "Things to buy: each one shows in Money › Purchases › Task-based",
  notes: "Plain bullet points: tips, details (not counted)",
  habits: "TickTick habits with today's state (not counted)",
};
/** A list card's header: name, type tag, progress; right-click to change its type or delete it. */
function ListHead({ l, ctx, patch, remove, children }: { l: SubList; ctx: FinCtx; patch: (p: Partial<SubList>) => void; remove: () => void; children: ReactNode }) {
  const kind = l.kind || "tasks";
  const rows = l.tasks;
  const done = rows.filter((t) => taskDone(t, ctx)).length;
  let meta = `${done} of ${rows.length}`;
  if (kind === "pay" || kind === "buy") {
    let paid = 0, all = 0;
    for (const t of rows) {
      if (!t.fin) continue;
      const fr = finRows(t.fin, ctx);
      const a = fr.reduce((n, r) => n + (r.amount || 0) + (r.fees || 0), 0);
      all += a;
      if (fr.length && fr.every((r) => r.settled)) paid += a;
    }
    if (all) meta = `${usd(paid)} of ${usd(all)}`;
  }
  const { bind, menu } = useRowMenu(
    () => [
      ...KIND_LABELS.filter(([k]) => k !== kind).map(([k, label]) => ({ label: `Make it ${label}`, onSelect: () => patch({ kind: k === "tasks" ? undefined : k }) })),
      { label: "Stop filling it on its own", hidden: !l.auto, onSelect: () => patch({ auto: undefined, autoSkip: undefined }) },
      { label: "Delete list", danger: true, onSelect: remove },
    ],
    l.name,
  );
  return (
    <>
      <header className="sk-fd-lhead" {...bind}>
        <i className={`sk-fd-dot is-${kind}`} />
        {children}
        {l.auto ? <span className="sk-fd-lauto" title={AUTO_RULES.find((r) => r.rule === l.auto)?.hint}>Auto</span> : <span className={`sk-fd-ltype is-${kind}`}>{KIND_LABELS.find(([k]) => k === kind)?.[1]}</span>}
        <span className="sk-fd-lmeta">{meta}</span>
      </header>
      <div className="sk-fd-lbar"><i className={`is-${kind}`} style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }} /></div>
      {menu}
    </>
  );
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

/** A linked TickTick row on a card: right-click / long-press takes it off this card without deleting it. */
function LinkRow({ className, title, label, onRemove, children }: { className: string; title: string; label: string; onRemove?: () => void; children: ReactNode }) {
  const { bind, menu } = useRowMenu(onRemove ? [{ label: "Remove from this card (stays in TickTick)", onSelect: onRemove }] : [], label);
  return (
    <li className={className} title={title} {...(onRemove ? bind : {})}>
      {children}
      {menu}
    </li>
  );
}

function Card({
  item,
  events,
  ctx,
  open,
  unlink,
}: {
  item: Entry;
  events: LinkItem[];
  ctx: FinCtx;
  open: () => void;
  /** Take a linked TickTick item off this card (it stays in TickTick) */
  unlink?: (linkId: string) => void;
}) {
  const p = progressOf(item, ctx);
  const w = whenOf(item, events);
  const glog = useGroupLog();
  const lists = (item.lists || []).filter(isTaskList).slice(0, 3);
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
      {item.site || item.section || item.ongoing || isProject(item) ? (
        <span className="sk-fcard-tags">
          {item.site || item.section ? (
            <span className="sk-fcard-site">{item.section ? FOCUS_SECTION_LABELS[item.section] : sourceById[item.site!]?.shortName}</span>
          ) : null}
          {isProject(item) ? <span className="sk-fcard-ongoing">Project</span> : item.ongoing ? <span className="sk-fcard-ongoing">{item.inFocus ? "Goal · in focus" : "Goal"}</span> : item.site ? <span className="sk-fcard-ongoing">Short-term focus</span> : null}
        </span>
      ) : null}
      {item.ongoing || item.section ? null : (
        <span className={`sk-fcard-corner${item.done || (p.pct ?? 0) >= 100 ? " is-full" : ""}`} aria-label={item.done ? "Done" : `${p.pct ?? 0}% complete`} title={p.total ? `${p.done} of ${p.total} done` : "No sub-tasks yet"}>
          {item.done ? (
            <span className="sk-ring is-check" aria-hidden="true">
              <b>✓</b>
            </span>
          ) : (
            <Ring pct={p.pct ?? 0} />
          )}
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
            const off = st.doneToday ? undefined : tickTickOffMap()[l.id];
            return (
              <LinkRow key={l.id} className={st.doneToday ? "is-done" : off ? "is-off" : ""} title={`${l.kind === "habit" ? "Habit" : "Task"} · done ${st.last7} of the last 7 days`} label={l.title} onRemove={unlink ? () => unlink(l.id) : undefined}>
                <span aria-hidden="true">{st.doneToday ? "✓" : "○"}</span> {l.title}
                <small>{st.doneToday ? "today" : off ? LOG_LABEL[off] : `${st.last7}/7`}</small>
              </LinkRow>
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
  const [listKind, setListKind] = useState<SubListKind>("tasks");
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
  // Auto lists (Overdue / Due today / Before next pay) keep themselves filled from the bills.
  const incoming = useIncoming();
  const payday = incomingDues(incoming, new Date(), 0, 30).filter((d) => (d.item.amount || 0) > 0 && d.days > 0).map((d) => d.due).sort()[0] ?? null;
  useEffect(() => {
    const next = syncAutoLists(lists, ctx.bills, payday, uid);
    if (next) setLists(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, ctx.bills, payday]);
  const addAuto = (rule: (typeof AUTO_RULES)[number]) => {
    const same = lists.find((l) => !l.auto && l.name.trim().toLowerCase() === rule.name.toLowerCase());
    if (same) patchList(same.id, { auto: rule.rule, kind: "pay" });
    else setLists([...lists, { id: uid(), name: rule.name, tasks: [], kind: "pay", auto: rule.rule }]);
  };
  const dropFrom = (l: SubList, t: SubTask) =>
    patchList(l.id, {
      tasks: l.tasks.filter((x) => x.id !== t.id),
      ...(l.auto && t.fin ? { autoSkip: [...new Set([...(l.autoSkip || []), t.fin.key])] } : {}),
    });
  const addList = (e: FormEvent) => {
    e.preventDefault();
    if (!listName.trim()) return;
    setLists([...lists, { id: uid(), name: listName.trim(), tasks: [], ...(listKind !== "tasks" ? { kind: listKind } : {}) }]);
    setListName("");
  };
  const addTask = (e: FormEvent, l: SubList) => {
    e.preventDefault();
    const text = (taskText[l.id] || "").trim();
    if (!text) return;
    const fin = l.kind === "buy" ? { key: addOwnItem(text, { buy: true, task: item.title }), label: text } : undefined;
    patchList(l.id, {
      tasks: [...l.tasks, { id: uid(), text, done: false, ...(fin ? { fin } : {}) }],
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
  const pinned = new Set([...(item.siteTasks || []), ...lists.flatMap((l) => l.tasks.map((t) => t.pin).filter(Boolean) as string[])]);
  const taskOpts = Object.entries(ctx.sl?.snapshots || {}).flatMap(([site, snap]) =>
    (snap?.tasks || [])
      .filter((t) => t.status !== "done" && t.kind !== "list" && t.kind !== "habit" && !t.id.startsWith("habit-") && !pinned.has(pinKey(site as SourceId, t.id)))
      .map((t) => ({ key: `pin:${pinKey(site as SourceId, t.id)}`, label: t.title, sub: sourceById[site as SourceId]?.shortName, group: `Tasks · ${sourceById[site as SourceId]?.name || site}` })),
  );
  const planRef = useRef<HTMLDetailsElement>(null);
  // An odd last list card takes the full width (no empty half beside it).
  const cardLists = lists.filter((x) => x.kind !== "notes" && x.kind !== "habits");
  const linkedLists = (item.siteLists || []).filter((id) => ctx.sl?.store[id] && !ctx.sl.store[id].gone).length;
  const wideId = !linkedLists && !isProject(item) && cardLists.length % 2 ? cardLists[cardLists.length - 1].id : "";
  const lede = (item.note || item.why || "").split(/(?<=[.!?])\s/)[0].slice(0, 160);
  // Money across this card's lists: paid · still to pay · to buy (task purchases)
  // The same ticket can sit in two lists (a "MD tickets · City" group and its own flag row): count each once.
  // Flag rows already carry the MVA $30 each, so the lump "MVA flag fees (13 × $30)" item is skipped when they're here.
  const money = { paid: 0, pay: 0, buy: 0, total: 0 };
  // Still to pay, split by whether it can go on a payment plan (each item once, like the total).
  const plans = { can: 0, canN: 0, full: 0, unknown: 0, names: [] as string[] };
  const finTasks = lists.filter(isTaskList).flatMap((l) => l.tasks.filter((t) => t.fin).map((t) => ({ t, rows: finRows(t.fin!, ctx) })));
  const hasFlagRows = finTasks.some((x) => x.rows.some((r) => r.fees));
  const counted = new Set<string>();
  for (const { t, rows: all } of finTasks) {
      if (hasFlagRows && t.fin!.key === "own:mva-flag-fees") continue;
      const rows = all.filter((r) => !counted.has(r.id));
      rows.forEach((r) => counted.add(r.id));
      const amt = rows.reduce((n, r) => n + (r.amount || 0) + (r.fees || 0), 0);
      if (!amt) continue;
      if (rows.every((r) => r.settled)) money.paid += amt;
      else if (ctx.findings?.[t.fin!.key]?.buy) money.buy += amt;
      else {
        money.pay += amt;
        const st = t.fin!.key.startsWith("bill:") ? "none" : planOf(t.fin!, ctx).state;
        if (st === "yes" || st === "ask") {
          plans.can += amt;
          plans.canN += 1;
          plans.names.push(splitFinText(t.text)[0]);
        } else if (st === "none") plans.full += amt;
        else plans.unknown += amt;
      }
  }
  money.total = money.paid + money.pay + money.buy;
  const habitRows = lists.filter((l) => l.kind === "habits").flatMap((l) => l.tasks);
  const habitsToday = habitRows.length
    ? (() => {
        const off = tickTickOffMap() as Record<string, string>;
        const st = habitRows.map((t) => habitDay(t.habitId || "", ctx.ledger || loadLedger(), off).state);
        return { done: st.filter((x) => x === "done").length, due: st.filter((x) => x !== "notdue").length };
      })()
    : null;
  // Wait for: a step locked until another step in this card is done (returns that step's name).
  const allSteps = lists.flatMap((l) => l.tasks);
  const lockOf = (t: SubTask) => {
    if (!t.after) return "";
    const w8 = allSteps.find((x) => x.id === t.after);
    return w8 && !taskDone(w8, ctx) ? w8.text : "";
  };
  const patchTask = (l: SubList, id: string, q: Partial<SubTask>) => patchList(l.id, { tasks: l.tasks.map((x) => (x.id === id ? { ...x, ...q } : x)) });
  const rowMenu = (l: SubList, t: SubTask): RowMenuItem[] => [
    { label: t.fin ? "Notes…" : "Date and notes…", onSelect: () => setSubOpen({ list: l.id, task: t.id }) },
    ...allSteps
      .filter((x) => x.id !== t.id && !x.fin && !taskDone(x, ctx))
      .slice(0, 8)
      .map((x) => ({ label: `Wait for: ${x.text}`, on: t.after === x.id, onSelect: () => patchTask(l, t.id, { after: t.after === x.id ? undefined : x.id }) })),
    { label: "Stop waiting", hidden: !t.after, onSelect: () => patchTask(l, t.id, { after: undefined }) },
    {
      label: "🛒 Make it a task purchase",
      hidden: Boolean(t.fin),
      onSelect: () => {
        const key = addOwnItem(t.text, { buy: true, task: item.title, ...(t.done ? { paid: true } : {}) });
        patchTask(l, t.id, { fin: { key, label: t.text } });
      },
    },
    ...lists
      .filter((x) => x.id !== l.id && isTaskList(x))
      .map((x) => ({
        label: `Move to ${x.name || "list"}`,
        onSelect: () => setLists(lists.map((y) => (y.id === l.id ? { ...y, tasks: y.tasks.filter((z) => z.id !== t.id) } : y.id === x.id ? { ...y, tasks: [...y.tasks, t] } : y))),
      })),
    ...(() => {
      const k = stepPin(l, t);
      if (!k) return [];
      const lane = doingLanes[k]?.lane;
      return [
        { label: "Add to Action List", hidden: lane === PLAN, onSelect: () => placePin(k, PLAN) },
        { label: "Add to On Deck", hidden: Boolean(lane), onSelect: () => placePin(k, DECK) },
        { label: "Take off Doing Now (stays here)", hidden: !lane, onSelect: () => unpin(k) },
      ];
    })(),
    { label: "Remove", danger: true, onSelect: () => dropFrom(l, t) },
  ];
  const markDone = () => {
    if (!item.done) {
      const keys = [...(item.fin || []), ...(item.lists || []).flatMap((l) => l.tasks.flatMap((x) => (x.fin ? [x.fin] : [])))].map((f) => f.key);
      for (const k of keys) if (settable(k)) settleLink(k, true, ctx);
    }
    update({ done: !item.done });
  };
  // Doing Now pins a whole card as `self:fcard:<code>:<id>`; taking it off there must never delete the card.
  const { lanes: doingLanes } = usePriorityPins();
  const availableDoingKey = focusCardPinKey(item.id);
  // One open step on this card → its own Doing Now item (On Deck or the Action List).
  const pinIds = new Set(focusPinItems().map((x) => x.id));
  const stepPin = (l: SubList, t: SubTask) => (t.fin || t.done ? undefined : focusTaskPinKey(item.id, l.id, t.id, pinIds));
  const doingKey = ["n", "w", "o"].map((c) => `self:fcard:${c}:${item.id}`).find((k) => doingLanes[k]?.lane);
  const deleteCard = () => {
    if (!window.confirm(`Delete the card “${item.title}” and every list and task on it?\n\nThis can't be undone.${doingKey ? " To only take it off Doing Now, use “Take off Doing Now” instead." : ""}`)) return;
    remove();
    close();
  };
  const [continuing, setContinuing] = useState(false);
  const [nextTitle, setNextTitle] = useState(`${item.title} · ${dayKey(new Date())}`);
  const [continuationError, setContinuationError] = useState('');
  const openFinanceLinks = (link: { key: string; label: string }) => {
    const rows = finRows(link, ctx);
    if (!rows.length) return [link];
    return rows.filter(row => !row.settled || row.unverified).map(row => ({
      key: /^(bill:|owed:|own:)/.test(row.id) ? row.id : `item:${row.id}`, label: row.name,
    }));
  };
  const carriedLists = lists.map(list => ({ ...list, tasks: isTaskList(list)
    ? list.tasks.flatMap(task => task.fin
      ? openFinanceLinks(task.fin).map((link, index) => ({ ...task, id: index ? `${task.id}:${index}` : task.id, text: link.label, fin: link, done: false }))
      : taskDone(task, ctx) ? [] : [task])
    : list.tasks,
  })).filter(list => list.tasks.length);
  const unresolvedLists: string[] = [];
  for (const id of item.siteLists || []) {
    const list = ctx.sl?.store[id];
    if (!list || list.gone) { unresolvedLists.push(id); continue; }
    const tasks = list.tasks.flatMap(id => {
      const key = pinKey(list.site, id);
      const hit = linkedTask(key, ctx);
      if (hit?.task.status === 'done') return [];
      return [{ id: `${list.id}:${id}`, text: hit?.task.title || 'Linked task', pin: key, done: false }];
    });
    if (tasks.length) carriedLists.push({ id: `carry:${id}`, name: list.name, tasks });
  }
  const carriedFinance = (item.fin || []).flatMap(openFinanceLinks);
  const carriedTasks = (item.siteTasks || []).filter(key => linkedTask(key, ctx)?.task.status !== 'done');
  const openCount = carriedLists.filter(isTaskList).reduce((count, list) => count + list.tasks.length, 0) + carriedFinance.length + carriedTasks.length + unresolvedLists.length;
  const carryForward = (event: FormEvent) => {
    event.preventDefault();
    if (!nextTitle.trim() || !openCount) return;
    try {
      const next = projectContinuation(item, nextTitle, { lists: carriedLists, fin: carriedFinance, siteTasks: carriedTasks, siteLists: unresolvedLists });
      const id = saveProjectContinuation(item, next);
      close();
      openProject(id);
    } catch (error) {
      setContinuationError(error instanceof Error ? error.message : 'Could not save the new project. Try again.');
    }
  };
  const cardMenu = useRowMenu(
    () => [
      { label: "Plan and settings…", onSelect: () => { if (planRef.current) { planRef.current.open = true; planRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); } } },
      { label: item.inFocus ? "Take out of Short-term focus" : "Show in Short-term focus", hidden: !item.ongoing || isProject(item), on: Boolean(item.inFocus), onSelect: () => update({ inFocus: !item.inFocus }) },
      // A plain project keeps the same record (lists, links, Doing Now pin) but leaves Short-term focus and Goals.
      { label: "Make it just a project", hidden: isProject(item), onSelect: () => update({ kind: "project", inFocus: false }) },
      { label: item.ongoing ? "Make it a goal again" : "Make it a short-term focus", hidden: item.kind !== "project" || item.site === "self", onSelect: () => update({ kind: undefined }) },
      { label: item.done ? "Marked done — undo" : "Mark the whole focus done", on: Boolean(item.done), onSelect: markDone },
      { label: "Mark done and create new project with open tasks", hidden: Boolean(item.done), onSelect: () => setContinuing(true) },
      { label: "Add to On Deck", hidden: Boolean(item.done || doingKey || !availableDoingKey), onSelect: () => { if (availableDoingKey) placePin(availableDoingKey, DECK); } },
      { label: "Add to Action List", hidden: Boolean(item.done || !availableDoingKey || (doingKey && doingLanes[doingKey]?.lane === PLAN)), onSelect: () => { if (availableDoingKey) placePin(doingKey || availableDoingKey, PLAN); } },
      { label: "Take off Doing Now (stays here)", hidden: !doingKey, onSelect: () => { if (doingKey) unpin(doingKey); } },
      { label: "Delete this card…", danger: true, onSelect: deleteCard },
    ],
    item.title,
  );
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
      className={`sk-fdetail${isProject(item) ? " is-project" : ""}`}
      backClassName="sk-fdetail-back"
      dataSite={item.site || undefined}
    >
        <header className="sk-fd-hero">
          <div className="sk-fd-ring" style={{ "--p": p.pct ?? 0 } as React.CSSProperties}>
            <b>{p.pct === null ? "–" : `${p.pct}%`}</b>
            <small>{p.total ? `${p.done} of ${p.total} done` : "no steps yet"}</small>
          </div>
          <div className="sk-fd-hmain">
            <div className="sk-fd-titlerow">
              <input className="sk-fd-title" value={item.title} onChange={(e) => update({ title: e.target.value })} maxLength={120} aria-label="Focus" />
              {item.section ? <span className={`sk-fd-cat is-${item.section}`}>{FOCUS_SECTION_LABELS[item.section]}</span> : item.site ? <span className="sk-fd-cat is-site">{sourceById[item.site]?.shortName}</span> : null}
              {item.ongoing && goalGroupOf(item).toLowerCase() !== (item.section ? FOCUS_SECTION_LABELS[item.section] : "").toLowerCase() ? <span className="sk-fd-cat is-goal">{goalGroupOf(item)}</span> : null}
              {item.ongoing ? <span className="sk-fd-cat is-goal">Ongoing</span> : null}
            </div>
            {lede ? <p className="sk-fd-lede">{lede}</p> : null}
            <div className="sk-fd-stats">
              {money.total ? (
                <span className="sk-fd-stat"><small>Money left</small><b>{usd(money.pay + money.buy)}</b></span>
              ) : null}
              {money.paid ? <span className="sk-fd-stat"><small>Paid</small><b>{usd(money.paid)}</b></span> : null}
              {item.priority ? <span className="sk-fd-stat"><small>Priority</small><b>{FOCUS_PRIORITY_LABEL[item.priority]}</b></span> : null}
              {habitsToday ? <span className="sk-fd-stat"><small>Habits today</small><b>{habitsToday.done} of {habitsToday.due}</b></span> : null}
              <span className="sk-fd-stat"><small>Lists</small><b>{lists.length}</b></span>
            </div>
          </div>
          <div className={`sk-fd-count${target && daysBetween(new Date(), target.date) <= 14 ? " is-near" : ""}`}>
            <b>{w.big}</b>
            {w.cap ? <small>{w.cap}</small> : null}
            <span>{w.linked ? <Icon name="calendar" size={11} /> : null}{w.num}</span>
          </div>
          <div className="sk-fd-hbtns">
            <button type="button" className="sk-btn is-small is-icon" aria-label="More for this focus" title="More: plan, short-term focus, done, remove" onClick={(e) => cardMenu.open(e.currentTarget)}>
              <Icon name="more" size={16} />
            </button>
            <button data-autofocus type="button" className="sk-btn is-small is-icon" onClick={close} aria-label="Close" title="Close">
              <Icon name="close" size={16} />
            </button>
          </div>
          {cardMenu.menu}
        </header>

        <div className="sk-fd-grid">
        <div className="sk-fd-main">
        <div className="sk-fd-three">
          {[...lists].filter((l) => l.kind !== "notes").sort((x, y) => (y.kind === "habits" ? 1 : 0) - (x.kind === "habits" ? 1 : 0)).map((l) => l.kind === "habits" ? (
            <KindList key={l.id} l={l} ctx={ctx} patch={(p) => patchList(l.id, p)} remove={() => setLists(lists.filter((x) => x.id !== l.id))} />
          ) : (
            <section key={l.id} className={`sk-fd-box sk-fd-list is-${l.kind || "tasks"}${l.id === wideId ? " is-wide" : ""}`}>
              <ListHead l={l} ctx={ctx} patch={(q) => patchList(l.id, q)} remove={() => setLists(lists.filter((x) => x.id !== l.id))}>
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
              </ListHead>
              <ul>
                {/* Open rows first; done ones stay on, crossed out, below them (order otherwise kept). */}
                {[...l.tasks].sort((a, b) => Number(taskDone(a, ctx)) - Number(taskDone(b, ctx))).map((t) => (
                  <MenuRow as="li" key={t.id} title={t.text} items={() => rowMenu(l, t)} className={`${taskDone(t, ctx) ? "is-done" : ""}${t.fin ? " sk-fd-finrow" : ""}${lockOf(t) ? " is-locked" : ""}${t.fin && !t.fin.key.startsWith("bill:") && !taskDone(t, ctx) && ["yes", "ask"].includes(planOf(t.fin, ctx).state) ? " is-planable" : ""}`}>
                    {t.fin && t.fin.key.startsWith("bill:") && !taskDone(t, ctx) ? (
                      <button
                        type="button"
                        className="sk-circle"
                        aria-pressed={false}
                        aria-label={`Mark ${t.text} paid`}
                        title="Marks it paid in Money too (crosses it off the sheet)"
                        onClick={() => {
                          const due = ctx.bills.find((b) => b.key === t.fin!.key.slice(5));
                          if (!due) return;
                          const amt = due.bill.amount != null ? ` (${usd(due.bill.amount)})` : "";
                          if (window.confirm(`Mark ${due.bill.name}${amt} paid? It's crossed off in Money too.`)) requestPayBill(due.key);
                        }}
                      >
                        <Icon name="check" size={12} />
                      </button>
                    ) : t.fin && settable(t.fin.key) ? (
                      <button
                        type="button"
                        className={`sk-circle${taskDone(t, ctx) ? " is-on" : ""}`}
                        aria-pressed={taskDone(t, ctx)}
                        aria-label={`Mark ${t.text} ${taskDone(t, ctx) ? "not paid" : "paid"}`}
                        title={t.fin.key.startsWith("owed:") ? "Marks it paid in Money › Liabilities too" : "Marks it bought / paid in Money too"}
                        onClick={() => settleLink(t.fin!.key, !taskDone(t, ctx), ctx)}
                      >
                        <Icon name="check" size={12} />
                      </button>
                    ) : t.fin ? (
                      <span className={`sk-fin-dot${taskDone(t, ctx) ? " is-on" : ""}`} aria-label={taskDone(t, ctx) ? "Cleared in Finance" : "Linked to Finance"} />
                    ) : t.pin ? (
                      <button
                        type="button"
                        className={`sk-circle${taskDone(t, ctx) ? " is-on" : ""}`}
                        aria-pressed={taskDone(t, ctx)}
                        aria-label={`Mark ${t.text} ${taskDone(t, ctx) ? "not done" : "done"}`}
                        title="Checks it off on its site too"
                        onClick={() => {
                          const at = t.pin!.indexOf(":");
                          const site = t.pin!.slice(0, at) as SourceId;
                          const id = t.pin!.slice(at + 1);
                          if (taskDone(t, ctx)) ctx.sl?.reopen?.(site, id);
                          else ctx.sl?.complete(site, id);
                        }}
                      >
                        <Icon name="check" size={12} />
                      </button>
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
                    <span className="sk-fd-rowmain">
                    {t.fin ? (
                      <button
                        type="button"
                        className="sk-fin-name"
                        title={`${t.text} · Open in Finance`}
                        onClick={() =>
                          t.fin!.key.startsWith("bill:")
                            ? openBillPop(t.fin!.key.slice(5))
                            : t.fin!.key.startsWith("owed:")
                              ? openFinance?.(undefined, "owed")
                              : t.fin!.key.startsWith("own:")
                              ? setFindOpen({ link: t.fin! })
                              : openDebtPop(t.fin!.key, t.text)
                        }
                      >
                        {splitFinText(t.text)[0]}
                      </button>
                    ) : t.pin ? (
                      <button type="button" className="sk-fd-taskopen" title="Open its notes, questions and findings" onClick={() => openTaskPanel(t.pin!)}>
                        {linkedTask(t.pin, ctx)?.task.title || t.text}
                        <small className="sk-fd-pinsite">{sourceById[t.pin.slice(0, t.pin.indexOf(":")) as SourceId]?.shortName}</small>
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
                    {t.fin && splitFinText(t.text)[1] ? <small className="sk-fd-rowsub">{splitFinText(t.text)[1]}</small> : null}
                    {lockOf(t) ? <small className="sk-fd-lock" title={`Waits for “${lockOf(t)}”`}>🔒 after {lockOf(t)}</small> : null}
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
                    {stepPin(l, t) ? <SendToDoing pin={stepPin(l, t)} label={t.text} lanes={doingLanes} /> : null}
                    </span>
                    <span className="sk-fd-rowtools">
                    {!t.fin && !t.pin ? (
                      <button
                        type="button"
                        className="sk-fd-buy"
                        title="Make this a task-based purchase (shows in Money › Spend › Purchases › Task-based)"
                        aria-label={`Make ${t.text} a task purchase`}
                        onClick={() => {
                          const key = addOwnItem(t.text, { buy: true, task: item.title, paid: t.done || undefined });
                          patchList(l.id, { tasks: l.tasks.map((x) => (x.id === t.id ? { ...x, fin: { key, label: t.text } } : x)) });
                          setFindOpen({ link: { key, label: t.text } });
                        }}
                      >
                        🛒
                      </button>
                    ) : t.fin?.key.startsWith("own:") && ctx.findings?.[t.fin.key]?.buy ? (
                      <span className="sk-fd-buytag" title="Task-based purchase">🛒</span>
                    ) : null}
                    <ResearchButton
                      rkey={t.fin ? ctx.findings?.[t.fin.key]?.rkey || t.fin.key : t.pin || `focus:${item.id}:${t.id}`}
                      title={t.fin?.label || t.text}
                      sub={`${item.title} · ${l.name || "list"}`}
                    />
                    {t.fin ? <small>{(() => {
                      const rows = finRows(t.fin, ctx);
                      if (!rows.length) return "Not loaded";
                      if (rows.some((r) => r.unverified)) return "Unverified";
                      if (taskDone(t, ctx)) return "Cleared";
                      if (rows.some((r) => !r.settled && r.amount == null)) return "Amount unknown";
                      return usd(finStats(rows).owed);
                    })()}</small> : null}
                    {t.fin && !t.fin.key.startsWith("bill:") && !ctx.findings?.[t.fin.key]?.buy ? (() => {
                      const pl = planOf(t.fin, ctx);
                      return (
                        <button
                          type="button"
                          className={`sk-fd-plan is-${pl.state}`}
                          title={`${planShort(pl.state)}${pl.line ? ` — ${pl.line}` : ""} · tap to log the amount / payment plan`}
                          onClick={() => setFindOpen({ link: t.fin! })}
                        >
                          {pl.state === "yes" ? "Plan ✓" : pl.state === "ask" ? "Plan possible" : planShort(pl.state)}
                        </button>
                      );
                    })() : null}
                    <button
                      type="button"
                      className="sk-btn is-small is-icon is-quiet"
                      aria-label={`Remove ${t.text}`}
                      onClick={() => dropFrom(l, t)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                    </span>
                  </MenuRow>
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
                options={l.kind === "pay" ? [...finOpts, ...taskOpts] : [...taskOpts, ...finOpts]}
                label={`Link a task or money item to ${l.name}`}
                placeholder="+ Link a task or bill from any site"
                disabled={!finOpts.length && !taskOpts.length}
                onPick={(o) =>
                  o.key.startsWith("pin:")
                    ? patchList(l.id, { tasks: [...l.tasks, { id: uid(), text: o.label, done: false, pin: o.key.slice(4) }] })
                    : addFinance(l, { key: o.key, label: o.label })
                }
              />
              {l.kind === "pay" || l.kind === "buy" ? <form
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
              </form> : null}
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
                            ? openBillPop(r.id.slice(5))
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

          <div className="sk-fd-autobar" role="group" aria-label="Lists that fill themselves with bills">
            <span className="sk-cap">Auto list</span>
            {AUTO_RULES.map((r) => {
              const has = lists.some((l) => l.auto === r.rule);
              const label = r.rule === "payday" && payday ? `${r.name} (${shortDate(fromDayKey(payday))})` : r.name;
              return (
                <button key={r.rule} type="button" className="sk-btn is-small" disabled={has || (r.rule === "payday" && !payday)} title={r.rule === "payday" && !payday ? "No payday found in Money › Incoming" : has ? "Already on this card" : r.hint} onClick={() => addAuto(r)}>
                  <Icon name="plus" size={13} />
                  {label}
                </button>
              );
            })}
          </div>
          <form className="sk-fd-box sk-fd-newlist" onSubmit={addList}>
            <span className="sk-cap">New list</span>
            <span className="sk-fd-kinds" role="radiogroup" aria-label="List type">
              {(KIND_LABELS).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={listKind === k} className={listKind === k ? "is-on" : ""} onClick={() => setListKind(k)}
                  title={KIND_HINT[k]}>
                  {label}
                </button>
              ))}
            </span>
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

        </div>
        </div>

        <aside className="sk-fd-side">
          {money.total && !isProject(item) ? (
            <section className="sk-fd-box sk-fd-money">
              <h3 className="sk-fd-sideh"><i className="sk-fd-dot is-pay" />Money for this</h3>
              <div className="sk-fd-moneybig"><b>{usd(money.pay + money.buy)}</b> <span>left of {usd(money.total)}</span></div>
              <div className="sk-fd-stack">
                <i className="is-paid" style={{ width: `${(money.paid / money.total) * 100}%` }} />
                <i className="is-pay" style={{ width: `${(money.pay / money.total) * 100}%` }} />
                <i className="is-buy" style={{ width: `${(money.buy / money.total) * 100}%` }} />
              </div>
              <div className="sk-fd-legend">
                <span><i className="is-paid" />Paid {usd(money.paid)}</span>
                <span><i className="is-pay" />To pay {usd(money.pay)}</span>
                {money.buy ? <span><i className="is-buy" />To buy {usd(money.buy)}</span> : null}
              </div>
              {plans.canN ? (
                <div className="sk-fd-plansum" aria-label="Payment plan split">
                  <span className="is-can"><b>{usd(plans.can)}</b> could go on a payment plan · {plans.canN}</span>
                  <span className="is-full"><b>{usd(plans.full)}</b> pay in full</span>
                  {plans.unknown ? <span className="is-unknown"><b>{usd(plans.unknown)}</b> plan not checked</span> : null}
                  <small title={plans.names.join(" · ")}>{plans.names.join(" · ")}</small>
                </div>
              ) : null}
            </section>
          ) : null}
          {item.ongoing || (item.refs || []).some((r) => r.kind === "image") ? <RefsBox item={item} update={update} mode="gallery" /> : null}
          <section className="sk-fd-box sk-fd-why">
            <label>
              <span className="sk-fd-ql">Why</span>
              <textarea value={item.why || ""} onChange={(e) => update({ why: e.target.value || undefined })} placeholder="Why it matters — e.g. so we can do his dog DNA test" />
            </label>
            <label>
              <span className="sk-fd-ql">Scope</span>
              <textarea className="is-scope" value={item.note || ""} onChange={(e) => update({ note: e.target.value || undefined })} placeholder="What it is — e.g. people at our home for Savannah’s baby shower" />
            </label>
          </section>
          {lists.filter((l) => l.kind === "notes").map((l) => (
            <details key={l.id} className="sk-fd-box sk-fd-fold" open={lists.filter((x) => x.kind === "notes")[0]?.id === l.id}>
              <summary>{l.name || "Notes"} <span>{l.tasks.length}</span></summary>
              <KindList l={l} ctx={ctx} patch={(q) => patchList(l.id, q)} remove={() => setLists(lists.filter((x) => x.id !== l.id))} />
            </details>
          ))}
          <RefsBox item={item} update={update} mode={item.ongoing ? "files" : "all"} />
          <details className="sk-fd-box sk-fd-fold sk-fd-planfold" ref={planRef}>
            <summary>Plan and settings <span>priority · date · links</span></summary>
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
          {item.ongoing ? (
            <label>
              <span className="sk-cap">Goal type</span>
              <input
                list="sk-goal-types"
                aria-label="Goal type"
                placeholder={goalGroupOf({ ...item, goalType: undefined })}
                defaultValue={item.goalType || ""}
                onBlur={(e) => update({ goalType: e.target.value.trim() || undefined })}
                maxLength={40}
              />
              <datalist id="sk-goal-types">{readGoalTypes().map((t) => <option key={t} value={t} />)}</datalist>
            </label>
          ) : null}
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
          </details>
        </aside>
        </div>

        {continuing ? <form className="sk-form sk-fd-box" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }} onSubmit={carryForward} aria-label="Carry open work to a new project">
          <label className="sk-field"><span>New project name</span><input value={nextTitle} onChange={event => setNextTitle(event.target.value)} maxLength={120} required /></label>
          <p className="sk-sec">{openCount ? `${openCount} open item${openCount === 1 ? '' : 's'} will carry forward with the project’s context and references. Unpaid items stay unpaid.` : 'There are no open tasks to carry forward.'}</p>
          {continuationError ? <p role="alert">{continuationError}</p> : null}
          <div className="sk-form-actions" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="sk-btn is-small" style={{ whiteSpace: 'normal', maxWidth: '100%' }} disabled={!nextTitle.trim() || !openCount}>Mark done and create new project</button>
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => setContinuing(false)}>Cancel</button>
          </div>
        </form> : null}
        <footer className="sk-fd-foot" hidden>
          {!item.done && availableDoingKey ? <button type="button" className="sk-btn is-small" onClick={() => {
            if (!doingKey) placePin(availableDoingKey, DECK);
          }} disabled={Boolean(doingKey)}>{doingKey ? (doingLanes[doingKey]?.lane === PLAN ? "In Action List" : "On Deck") : "Add to On Deck"}</button> : null}
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
            onClick={() => {
              // Finishing the focus marks its linked liabilities / task purchases paid in Money too.
              if (!item.done) {
                const keys = [...(item.fin || []), ...(item.lists || []).flatMap((l) => l.tasks.flatMap((x) => (x.fin ? [x.fin] : [])))].map((f) => f.key);
                for (const k of keys) if (settable(k)) settleLink(k, true, ctx);
              }
              update({ done: !item.done });
            }}
          >
            <Icon name="check" size={14} />
            {item.done ? "Marked done — undo" : "Mark the whole focus done"}
          </button>
          {!item.done ? <button type="button" className="sk-btn is-small" style={{ whiteSpace: 'normal', maxWidth: '100%' }} onClick={() => setContinuing(true)}>Mark done and create new project with open tasks</button> : null}
          <button
            type="button"
            className="sk-btn is-small is-quiet"
            onClick={deleteCard}
          >
            Delete this card…
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
/** v2 (11/20 MVA list): every flag as its own payment task with its full cost, then what to pay before it flags. */
const REG_FLAGS_SEED = "reg-flags-1120";
const isRegCard = (x: Entry) => !x.done && /registration\s+renew/i.test(x.title);
const needsRegSeed = (x: Entry) =>
  isRegCard(x) && (!(x.seeded || []).includes(REG_SEED) || !(x.seeded || []).includes(REG_FLAGS_SEED));

function regFlagLists(file: DebtFile): SubList[] {
  const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const short = (i: DebtFile["items"][number]) => {
    const who = i.ticket?.who || "";
    const where = /county/i.test(who) ? "County" : /city/i.test(who) ? "City" : /transportation/i.test(who) ? "MDTA toll" : /highway|safezones/i.test(who) ? "Work zone" : who;
    const num = (i.sub || "").split("·").pop()!.replace(/→.*$/, "").trim();
    return `${where} ${num}`;
  };
  const fin = (i: DebtFile["items"][number], text: string): SubTask => ({ id: uid(), text, done: false, fin: { key: `item:${i.id}`, label: i.name } });
  const md = file.items.filter((i) => i.group === "md");
  const flags = md.filter(isFlagged).sort((a, b) => (a.ticket?.date || "").localeCompare(b.ticket?.date || ""));
  const soon = md.filter((i) => !isFlagged(i) && i.blocksRegistration).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const out: SubList[] = [{
    id: uid(),
    name: `Clear the ${flags.length} flags (MVA list 11/20)`,
    tasks: flags.map((i) => {
      const local = i.ticket?.flagFee || 0;
      const cost = i.amount === null ? null : i.amount + local + FLAG_FEE;
      const parts = i.amount === null ? `? ticket + $${FLAG_FEE} MVA` : `${usd(i.amount)} ticket${local ? ` + $${local} flag fee` : ""} + $${FLAG_FEE} MVA`;
      return fin(i, `${short(i)} · ${cost === null ? "?" : usd(cost)} (${parts})`);
    }),
  }];
  if (soon.length) out.push({
    id: uid(),
    name: "Pay before they flag",
    tasks: soon.map((i) => fin(i, `${short(i)} · ${usd(i.amount || 0)}${i.due ? ` by ${i.due.slice(5, 7)}/${i.due.slice(8, 10)}` : ""}`)),
  });
  return out;
}

/** Research → Payments (tickets) → MD state tax, flags & renewal fee, with research tasks wired to what they fill in. */
function seedRegistration(x0: Entry, file: DebtFile): Entry {
  const x = (x0.seeded || []).includes(REG_SEED) ? x0 : seedRegistrationV1(x0, file);
  if ((x.seeded || []).includes(REG_FLAGS_SEED)) return x;
  const lists = x.lists || [];
  const at = lists.findIndex((l) => l.name === "Research") + 1;
  return { ...x, lists: [...lists.slice(0, at), ...regFlagLists(file), ...lists.slice(at)], seeded: [...(x.seeded || []), REG_FLAGS_SEED] };
}

function seedRegistrationV1(x: Entry, file: DebtFile): Entry {
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


/* ── Physique Goals (Body chat, 2026-11-17): Scope, Why and four lists, filled once ── */
const PHYSIQUE_SEED = "physique-v1";
const needsPhysiqueSeed = (x: Entry) => !x.done && /^physique goals?$/i.test(x.title.trim()) && !(x.seeded || []).includes(PHYSIQUE_SEED);
const PHYSIQUE_SCOPE =
  "Cut from 235 lb to about 209–214 lb and 10–12% body fat while keeping strength. The look is lean and athletic: full upper chest, capped delts, quad sweep, visible abs. Eat 2,450 kcal · P205 / C250 / F70 and train Fine Shyte 3 six days a week at Planet Fitness.";
const PHYSIQUE_WHY =
  "To look and feel like the version of me I picture, lean, athletic and strong, in a body that holds up long-term with my back (L4) and left shoulder. (Draft: rewrite this in your own words.)";
const PHYSIQUE_HABITS: [string, string][] = [
  ["6afc0f948f088035a8cda5f6", "Hit Macros — 2,450 kcal · 205g Protein"],
  ["6afc0f8e8f087a59c826d494", "Weigh-in — Morning, Before Food"],
  ["6afc0f928f08cf67d963cb7a", "Measure Belly (Waist at Navel)"],
  ["6afc0f938f08eed2a016c3d9", "Progress Photos — Every 2 Weeks"],
  ["6a939b8e8f087e0df42d2bb6", "Full Gym Session — Complete Flow"],
  ["6a9fb6ba8f08ecb120d19e23", "Cardio — Gym"],
  ["6a9fb6da8f08ea0eca04480d", "Abdominal Training — Gym"],
  ["6a939b928f080f71bbb37508", "Active PT — Follow PDF"],
  ["6a939b9e8f08defd95911710", "Creatine and Fiber Supplements"],
  ["6a939b9a8f08defd959116e4", "Drink 5 Bottles of Water"],
];
const PHYSIQUE_MILESTONES = [
  "Weekly average down 1–2 lb (repeat check each Monday)",
  "First 4 weeks done: about 227–229 lb, waist down about 1.2 in",
  "Milestone 1: about 220 lb, 13–14% body fat (around mid-Feb 2027)",
  "Ab outline visible in daylight progress photos",
  "Keep strength on main lifts through the cut (no drop over 10%)",
  "Milestone 2: 209–214 lb, 10–12% body fat, the goal look",
  "Then plan the switch to maintenance (about +300 kcal)",
];
const PHYSIQUE_TIPS = [
  "Protein from chicken, eggs and whites, Greek yogurt and cheese. No powder.",
  "Portion raw ingredients ahead and cook fresh. Keep one cookie a day.",
  "Compare weekly averages, never one weigh-in. Water and salt swing the scale.",
  "No change for 2 weeks: cut 150 kcal or add 2,000 steps a day.",
  "Protect the L4 back and left shoulder: no grinding reps, use the listed backups if anything pinches.",
  "Sleep 7–8 hours. Hunger and cravings get worse on short sleep.",
  "Weekend drinks count toward the calories, so plan them in.",
];
const PHYSIQUE_DETAILS = [
  "Start: 6'4\", 235 lb (106.8 kg), 25 yo, 2026-11-17.",
  "Targets: 2,450 kcal · P205 / C250 / F70.",
  "Training: Fine Shyte 3, Mon–Sat, Thu off, legs Wed/Sat.",
  "Check-ins: weigh M/W/F, waist Mon, photos every 2nd Sun.",
  "Example days: Body site › Food › Cut plan https://randymcfarland1227-wq.github.io/#/food/plan",
];
function seedPhysique(x: Entry): Entry {
  const have = new Set((x.lists || []).map((l) => l.name.trim().toLowerCase()));
  const row = (text: string): SubTask => ({ id: uid(), text, done: false });
  const add: SubList[] = [
    { id: uid(), name: "Daily TickTick habits", kind: "habits" as const, tasks: PHYSIQUE_HABITS.map(([habitId, text]) => ({ ...row(text), habitId })) },
    { id: uid(), name: "Milestones", tasks: PHYSIQUE_MILESTONES.map(row) },
    { id: uid(), name: "Tips", kind: "notes" as const, tasks: PHYSIQUE_TIPS.map(row) },
    { id: uid(), name: "Scope details", kind: "notes" as const, tasks: PHYSIQUE_DETAILS.map(row) },
  ].filter((l) => !have.has(l.name.toLowerCase()));
  return {
    ...x,
    note: x.note?.trim() ? x.note : PHYSIQUE_SCOPE,
    why: x.why?.trim() ? x.why : PHYSIQUE_WHY,
    lists: [...(x.lists || []), ...add],
    seeded: [...(x.seeded || []), PHYSIQUE_SEED, PHYSIQUE_LB],
  };
}


/** Physique Goals in pounds (Randy, 2026-11-17): rewrite the kg figures already on the card, once. */
const PHYSIQUE_LB = "physique-lb";
const LB_SWAPS: [RegExp, string][] = [
  [/106\.8 kg \(235 lb\)/g, "235 lb (106.8 kg)"],
  [/106\.8 kg/g, "235 lb"],
  [/95–97 kg/g, "209–214 lb"],
  [/0\.5–0\.9 kg/g, "1–2 lb"],
  [/103–104 kg/g, "227–229 lb"],
  [/about 100 kg/g, "about 220 lb"],
  [/waist down about 3 cm/g, "waist down about 1.2 in"],
];
const toLb = (t?: string) => (t ? LB_SWAPS.reduce((x, [re, to]) => x.replace(re, to), t) : t);
const needsPhysiqueLb = (x: Entry) => /^physique goals?$/i.test(x.title.trim()) && !(x.seeded || []).includes(PHYSIQUE_LB);
function physiqueToLb(x: Entry): Entry {
  return {
    ...x,
    note: toLb(x.note),
    why: toLb(x.why),
    lists: (x.lists || []).map((l) => ({ ...l, tasks: l.tasks.map((t) => ({ ...t, text: toLb(t.text) || t.text })) })),
    seeded: [...(x.seeded || []), PHYSIQUE_LB],
  };
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
  const owed = useOwedLines(file, marks, bills);
  return <Detail key={props.item.id} {...props} events={events} ctx={{ owed, file, marks, bills, sl, findings, ledger: loadLedger(), ticktick: savedTickTick() }} />;
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
  addAs,
}: {
  /** The + asks what it is (Project / Short-term focus / Goal); each choice saves the new entry and returns its id */
  addAs?: Array<{ id: string; label: string; add: (title: string) => string }>;
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
  const owed = useOwedLines(file, marks, bills);
  const ctx: FinCtx = { owed, file, marks, bills, sl, habitCount, findings, ...linkCtx(lists0, ledger, ticktick) };
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
  // One-time: the Physique Goals card gets its Scope, Why and lists (habits · milestones · tips · details).
  useEffect(() => {
    for (const [items, save] of lists0) {
      if (items.some(needsPhysiqueSeed)) save(items.map((x) => (needsPhysiqueSeed(x) ? seedPhysique(x) : x)));
      else if (items.some(needsPhysiqueLb)) save(items.map((x) => (needsPhysiqueLb(x) ? physiqueToLb(x) : x)));
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
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState(addAs?.[0]?.id || "");
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
    const pick = addAs?.find((k) => k.id === addKind) || addAs?.[0];
    let id = `${Date.now()}`;
    if (pick) id = pick.add(title.trim());
    else list[1]([...list[0], { ...defaults, id, title: title.trim(), added: dayKey(new Date()) }]);
    setTitle("");
    setAdding(false);
    setOpenId(id);
  };
  const ordered = orderFocus(all.map((a) => a.item));
  const active = ordered.filter((i) => !i.done);
  const finished = ordered.filter((i) => i.done);
  const [doneShut, toggleDone] = useFold(`focus-done-${label || "cards"}`);
  const openItem = all.find((a) => a.item.id === openId)?.item;
  const cardOf = (i: Entry) => (
    <Card key={i.id} item={i} events={events} ctx={ctx} open={() => setOpenId(i.id)} unlink={(linkId) => patchIn(i.id, (x) => ({ ...x, links: (x.links || []).filter((l) => l.id !== linkId), at: new Date().toISOString() }))} />
  );
  const addTitle = label || "Add one";
  return (
    <>
      {noAdd ? null : adding ? (
        <form className="sk-fc-add" onSubmit={add}>
          {addAs?.length ? (
            <span className="sk-seg" role="group" aria-label="Add it as">
              {addAs.map((k) => (
                <button key={k.id} type="button" aria-pressed={addKind === k.id}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => setAddKind(k.id)}>{k.label}</button>
              ))}
            </span>
          ) : null}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setTitle(""); setAdding(false); } }}
            onBlur={() => { if (!title.trim()) setAdding(false); }}
            placeholder="Name it, then fill in the rest"
            aria-label={addTitle}
            maxLength={120}
          />
          <button type="submit" className="sk-btn is-small" disabled={!title.trim()}>Add</button>
        </form>
      ) : (
        <div className="sk-fc-plusrow">
          <button type="button" className="sk-fc-plus" aria-label={addTitle} title={addTitle} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
          </button>
        </div>
      )}
      {active.length ? (
        <div className="sk-fcards">{active.map(cardOf)}</div>
      ) : empty && !finished.length ? (
        <p className="sk-empty">{empty}</p>
      ) : null}
      {finished.length ? (
        <div className={`sk-fdone${doneShut ? "" : " is-open"}`}>
          <button type="button" className="sk-fdone-head" aria-expanded={!doneShut} onClick={toggleDone}>
            <span className="sk-fdone-check" aria-hidden="true">✓</span>
            Done · {finished.length}
            <span className="sk-fdone-chev" aria-hidden="true">{doneShut ? "▸" : "▾"}</span>
          </button>
          {doneShut ? null : <div className="sk-fcards">{finished.map(cardOf)}</div>}
        </div>
      ) : null}
      {openItem ? (
        <Detail
          key={openItem.id}
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
            const off = st.doneToday ? undefined : tickTickOffMap()[l.id];
            return (
              <li key={l.id} className={st.doneToday ? "is-done" : off ? "is-off" : ""}>
                <span aria-hidden="true">{st.doneToday ? "✓" : "○"}</span> {l.title}
                <small>{l.kind === "habit" ? "Habit" : "Task"} · {st.doneToday ? "done today" : off ? `${LOG_LABEL[off]} today` : "not yet today"} · {st.last7} of last 7 days</small>
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
function RefsBox({ item, update, mode = "all" }: { item: Entry; update: (patch: Partial<Entry>) => void; mode?: "all" | "gallery" | "files" }) {
  const refs = sortRefs(item.refs || []).filter((r) => (mode === "gallery" ? r.kind === "image" : mode === "files" ? r.kind !== "image" : true));
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
    <section className={`sk-fd-box sk-fd-list sk-fd-refs${mode === "gallery" ? " is-gallery" : ""}`} aria-label={mode === "gallery" ? "Gallery" : "References"}>
      <header>
        <b>
          <Icon name={mode === "gallery" ? "image" : "clip"} size={13} />
          {mode === "gallery" ? "Gallery" : "References"}
        </b>
        {refs.length ? <small>{refs.length}</small> : null}
      </header>
      <p className="sk-fd-hint">{mode === "gallery" ? "Reference images for this goal. Tap one to see it full size." : mode === "files" ? "Links and documents for this goal." : "Links, documents and images for this focus."}</p>
      {images.length ? (
        <div className="sk-ref-thumbs">
          {images.map((r) => (
            <div key={r.id} className="sk-ref-thumb">
              <button type="button" onClick={() => open(r)} title={`${r.title} — open full size`}>
                {r.thumb ? <RefImg r={r} full={mode === "gallery"} /> : <Icon name="file" size={18} />}
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
      {mode === "gallery" ? (
        <div className="sk-ref-btns">
          <button type="button" className="sk-btn is-small" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            <Icon name="plus" size={13} />
            Add images
          </button>
          <input ref={fileInput} type="file" hidden multiple accept="image/*,.heic" onChange={(e) => addFiles(e.target.files)} />
        </div>
      ) : (
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
            {mode === "files" ? "Document" : "Image / document"}
          </button>
        </div>
        <input ref={fileInput} type="file" hidden multiple accept={mode === "files" ? ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.pages,.numbers,.key" : "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.pages,.numbers,.key,.heic"} onChange={(e) => addFiles(e.target.files)} />
      </form>
      )}
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

/**
 * Focus tasks board (Self): one finance link's status as the card shows it — amount owed / Cleared /
 * Amount unknown, plus its payment-plan tag. Context only, never counted as a task.
 */
export function useFinSummary(bills: BillDue[] = []) {
  const { raw: file, rawMarks: marks } = useDebtFile();
  const findings = useFindings();
  const owed = useOwedLines(file, marks, bills);
  const ctx: FinCtx = { owed, file, marks, bills, findings };
  return (fin: { key: string; label: string }) => {
    // Without the bill list a bill link can't be read (it would look paid), so say nothing.
    if (fin.key.startsWith("bill:") && !bills.length) return { text: "", cleared: false, plan: "" };
    const rows = finRows(fin, ctx);
    const cleared = rows.length > 0 && rows.every((r) => r.settled && !r.unverified);
    const text = !rows.length
      ? "Not loaded"
      : rows.some((r) => r.unverified)
        ? "Unverified"
        : cleared
          ? "Cleared"
          : rows.some((r) => !r.settled && r.amount == null)
            ? "Amount unknown"
            : usd(finStats(rows).owed);
    const pl = fin.key.startsWith("bill:") ? null : planOf(fin, ctx);
    return { text, cleared, plan: pl && pl.state !== "unknown" ? planShort(pl.state) : "", planState: pl?.state };
  };
}

/** Dashboard: the same % done and day count each focus card shows, for any list of entries. */
export function useFocusProgress(lists: CardList[], bills: BillDue[] = [], events: LinkItem[] = [], ledger?: CompletionLedger, ticktick?: SourceSnapshot) {
  const { raw: file, rawMarks: marks } = useDebtFile();
  const sl = useSiteLists();
  const goals = lists.flatMap(([items]) => items.flatMap((x) => (x.habitGoal ? [{ habitId: x.habitGoal.habitId, from: x.habitGoal.from }] : [])));
  const habitCount = useHabitCounts(goals);
  const findings = useFindings();
  const owed = useOwedLines(file, marks, bills);
  const ctx: FinCtx = { owed, file, marks, bills, sl, habitCount, findings, ...linkCtx(lists, ledger, ticktick) };
  return (e: Entry) => {
    const added = addedOf(e);
    const target = targetOf(e, events);
    return { ...progressOf(e, ctx), added, target };
  };
}

/**
 * Finance links for any task pop-out (Self tasks, site tasks): the same picker, paid state and two-way
 * settling the focus pop-out uses — bills, Current liabilities, your money items and task purchases.
 */
export function useFinLinker(bills: BillDue[] = []) {
  const { raw: file, rawMarks: marks } = useDebtFile();
  const findings = useFindings();
  const owed = useOwedLines(file, marks, bills);
  const ctx: FinCtx = { owed, file, marks, bills, findings };
  const status = (link: { key: string; label: string }) => {
    const rows = finRows(link, ctx);
    const settled = rows.length > 0 && rows.every((r) => r.settled && !r.unverified);
    const text = !rows.length
      ? "Not loaded"
      : rows.some((r) => r.unverified)
        ? "Unverified"
        : settled
          ? "Cleared"
          : rows.some((r) => !r.settled && r.amount == null)
            ? "Amount unknown"
            : usd(finStats(rows).owed);
    return { settled, text, buy: Boolean(findings[link.key]?.buy) };
  };
  return {
    options: financeOptions(ctx),
    status,
    canSettle: settable,
    settle: (key: string, on: boolean) => settleLink(key, on, ctx),
  };
}
