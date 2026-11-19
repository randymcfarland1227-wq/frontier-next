"use client";

import { inFocusPlan, useFocusLinks } from "../../lib/focusLinks";
import { LinkDevicePrompt } from "./LinkDevicePrompt";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  FeaturedItem,
  SourceId,
  SourceSnapshot,
  SpaceId,
  TaskItem,
} from "../../lib/types";
import { sourceById } from "../../lib/sources";
import type {
  CompletionLedger,
  CompletionStats,
  CompletionEntry,
} from "../../lib/completions";
import type { FocusAreaConfig } from "../../lib/focusAreas";
import type { EnergyWindow } from "../../lib/energy";
import { PriorityBoard } from "./PriorityBoard";
import { completeFocusPin, isFocusPinId } from "../../lib/focusPins";
import { GroundingSummary } from "./DailyGrounding";
import { ReviewPanel } from "./ReviewPanel";
import { DailyBrief, BriefSummary } from "./DailyBrief";
import { useBriefPush } from "../../lib/dailyBrief";
import { shownMetric } from "../../lib/actionable";
import { PLAN, usePriorityPins } from "../../lib/priorityPins";
import { criticalKeys, useFeaturedLevels } from "../../lib/featuredLevels";
import {
  addDays,
  billDues,
  eventStart,
  onDay,
  paidBillKeys,
  type BillDue,
  type CalTask,
  type ScheduleSnapshot,
} from "../../lib/schedule";
import { applyBillEdits, isOverdue, useBillEdits } from "../../lib/billEdits";
import { usePlans } from "../../lib/plans";
import { requestOpenDebt } from "../../lib/finLinks";
import { ScheduleSection } from "./ScheduleSection";
import { KitBillRow } from "./BillsList";
import {
  FocusSection,
  ShortTermFocus,
  shortTermSummary,
  useShortTermFocus,
} from "./FocusSection";
import { HomeTop } from "../sticker/HomeTop";
import { MoneyZoom } from "./MoneyZoom";
import { HubBoard } from "./HubBoard";
import { ListHead, PaneHeadContext, PaneToolSlotContext, PaneZoomButtons, REVEAL_EVENT, reveal, Section } from "../sticker/kit";
import { CapPane } from "../sticker/CapPane";
import { SegTabs } from "../sticker/SegTabs";
import { readSaved, writeSaved } from "../../lib/storage";
import { TickTickRings } from "./TickTickRings";
import { Icon } from "../sticker/Icon";
import { AssignedFocus } from "./AssignedFocus";
import { GoalsView } from "./GoalsView";
import { SITE_ROWS, SitesTabs, SitePicker } from "../sticker/Sites";

type TodayTab = "brief" | "rhythm" | "grounding" | "calendar" | "focus" | "goals" | "money" | "sites";
const TODAY_TABS: [TodayTab, string][] = [
  ["brief", "Daily Brief"],
  ["rhythm", "Daily Rhythm"],
  ["focus", "Short-term focus"],
  ["goals", "Goals"],
  ["calendar", "Calendar"],
  ["grounding", "Grounding"],
  ["money", "Money"],
  ["sites", "Sites"],
];

/** "3 on your list · 13 on deck · 1 critical" for the Doing Now head. */
function PrioritySummary() {
  const { pins, lanes } = usePriorityPins();
  const { levels } = useFeaturedLevels();
  const critical = criticalKeys(levels).length;
  const plan = pins.filter((k) => lanes[k]?.lane === PLAN).length;
  return (
    <>
      {[
        `${plan} on your list`,
        `${pins.length - plan} pinned on deck`,
        critical ? `${critical} critical` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </>
  );
}

/** Collapsed Schedule bar: today's events, maybes waiting on an answer, bills due within 3 days. */
function ScheduleSummary({
  schedule,
  bills,
}: {
  schedule: ScheduleSnapshot | null;
  bills: BillDue[];
}) {
  const { plans } = usePlans();
  const today = new Date();
  const events = schedule?.events || [];
  const todayCount = events.filter(
    (e) => (e.myStatus === "owner" || e.myStatus === "yes") && onDay(e, today),
  ).length;
  const maybes =
    plans.filter((p) => p.status === "open").length +
    events.filter(
      (e) =>
        (e.myStatus === "invited" || e.myStatus === "maybe") &&
        eventStart(e) >= addDays(today, -1),
    ).length;
  const soon = bills.filter(
    (b) => b.days <= 3 && !(b.bill.kind && b.days < 0),
  ).length;
  return (
    <>
      {[
        `${todayCount} today`,
        maybes ? `${maybes} to confirm` : null,
        soon ? `${soon} ${soon === 1 ? "payment" : "payments"} due soon` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </>
  );
}

/** Split view pane zoom, in percent. */
const ZOOM_MIN = 70;
const ZOOM_MAX = 160;
const ZOOM_STEP = 10;

export function HomeView({
  snapshots,
  enter,
  onRefresh,
  syncing = false,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  completionStats,
  ledger,
  focusConfig,
  renderBalance,
  renderSorting,
  capturesPanel,
  schedule,
  moneyDues,
  onBillPaid,
  calTasks,
  onTaskDone,
  onAddPrep,
  grounding,
  money,
  unfinished,
  openFocus,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  /** Sync every source now (same as the sidebar Refresh). */
  onRefresh?: () => void;
  syncing?: boolean;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  completionStats: CompletionStats;
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
  renderBalance?: (period: EnergyWindow) => ReactNode;
  renderSorting?: (entries: CompletionEntry[]) => ReactNode;
  capturesPanel: ReactNode;
  schedule: ScheduleSnapshot | null;
  /** Money from the Radall sheet + planned payments (already minus what's marked paid) */
  moneyDues: BillDue[];
  onBillPaid: (due: BillDue) => void;
  calTasks: CalTask[];
  onTaskDone: (t: CalTask) => void;
  onAddPrep: (
    target: { id: string; title: string; date: string },
    title: string,
    due?: string,
  ) => void;
  /** Daily grounding: reminder guides + directions (rendered by the page) */
  grounding?: ReactNode;
  /** The Money page, shown unchanged as the last Today tab */
  money?: ReactNode;
  /** Today drawer: items not done yet, and how to open it (the one prominent button) */
  unfinished: number;
  openFocus: () => void;
}) {
  const { lanes } = usePriorityPins();
  const focusLinks = useFocusLinks();
  // Open to-dos per site — the same blue numbers each card shows.
  const openBySite = SITE_ROWS.flatMap((r) => r.ids)
    .map((id) => ({
      id,
      name: sourceById[id].shortName,
      count: shownMetric(id, snapshots[id], lanes, (k, t) => inFocusPlan(focusLinks, k, t)).value || 0,
    }))
    .filter((site) => site.count > 0)
    .sort((a, b) => b.count - a.count);
  const openTotal = openBySite.reduce((sum, site) => sum + site.count, 0);
  // Bills: next unpaid due date per bill (paid on Life Hub = a Radall completion in the ledger).
  // Plus the Radall sheet's money items (bills, card mins, subscriptions, pay later) — calendar only, never tasks.
  const paidKeys = paidBillKeys(ledger);
  const billEdits = useBillEdits();
  // Bills tab: each bill's next due still owed (an unpaid past one first), after Life Hub changes.
  const tabBills = (schedule?.bills || [])
    .map((b) => applyBillEdits(billDues(b, paidKeys), billEdits)[0])
    .filter((d): d is BillDue => Boolean(d));
  const bills = [...tabBills, ...moneyDues].sort((a, b) =>
    a.due.localeCompare(b.due),
  );
  const overdueBills = bills.filter(isOverdue).sort((a, b) => (a.bill.priority ? 0 : a.bill.nonCritical ? 2 : 1) - (b.bill.priority ? 0 : b.bill.nonCritical ? 2 : 1));
  useBriefPush(snapshots, bills);
  // Paid from anywhere a bill shows up as a Priority item ("Doing now").
  const payFromPriority = (source: SourceId, item: FeaturedItem) => {
    const due = bills.find((b) => b.key === item.id);
    // Short-term focus card task/list pinned into Doing Now: done on the card itself.
    if (isFocusPinId(item.id)) completeFocusPin(item.id);
    else if (source === "radall" && due) onBillPaid(due);
    else onCompleteFeatured(source, item);
  };
  // Today is one section with tabs (Daily Brief | Grounding | Calendar | Short-term focus); the last tab is remembered on this device.
  const [todayTab, setTodayTab] = useState<TodayTab>(() => {
    const saved = readSaved<string>("sk-today-tab", "brief");
    return TODAY_TABS.some(([id]) => id === saved)
      ? (saved as TodayTab)
      : "brief";
  });
  const tab: TodayTab =
    (todayTab === "grounding" && !grounding) || (todayTab === "money" && !money)
      ? "brief"
      : todayTab;
  const pickTodayTab = (t: TodayTab) => {
    setTodayTab(t);
    writeSaved("sk-today-tab", t);
  };
  // Split view: two tabs side by side, each scaled to its half. Remembered on this device.
  const [split, setSplitState] = useState<boolean>(() =>
    readSaved<boolean>("sk-today-split", false),
  );
  const setSplit = (v: boolean) => {
    setSplitState(v);
    writeSaved("sk-today-split", v);
    setBoard(false);
  };
  // Dashboard: the always-on second screen view (this device only).
  const [board, setBoardState] = useState<boolean>(() => readSaved<boolean>("sk-today-board", false));
  const setBoard = (v: boolean) => {
    setBoardState(v);
    writeSaved("sk-today-board", v);
  };
  // Dashboard size (this device): the big monitor still cuts the bottom off at 100%.
  const [boardZoom, setBoardZoomState] = useState<number>(() => Number(readSaved<number>("sk-today-board-zoom", 100)) || 100);
  const setBoardZoom = (v: number) => {
    const n = Math.min(ZOOM_MAX, Math.max(50, v));
    setBoardZoomState(n);
    writeSaved("sk-today-board-zoom", n);
  };
  // Phones never split: two stacked scroll boxes trap the page. The saved choice comes back on wider screens.
  const [phone, setPhone] = useState<boolean>(() => typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Split view zoom per pane (desktop vs laptop differ, so this stays on this device).
  const [splitZoom, setSplitZoomState] = useState<[number, number]>(() => {
    const z = readSaved<number[]>("sk-today-split-zoom", [100, 100]);
    return [Number(z[0]) || 100, Number(z[1]) || 100];
  });
  const setSplitZoom = (i: number, v: number) => {
    const next: [number, number] = [...splitZoom] as [number, number];
    next[i] = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
    setSplitZoomState(next);
    writeSaved("sk-today-split-zoom", next);
  };
  // Single view zoom: its own saved size (this device), same − % + as each Split pane.
  const [singleZoom, setSingleZoomState] = useState<number>(() => Number(readSaved<number>("sk-today-single-zoom", 100)) || 100);
  const setSingleZoom = (v: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
    setSingleZoomState(next);
    writeSaved("sk-today-single-zoom", next);
  };
  // Money in Single view: its own size (Money reads best at a different size than the other tabs).
  const [moneyZoom, setMoneyZoomState] = useState<number>(() => Number(readSaved<number>("sk-today-single-money-zoom", 100)) || 100);
  const setMoneyZoom = (v: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
    setMoneyZoomState(next);
    writeSaved("sk-today-single-money-zoom", next);
  };
  // Slots on each tab line (0 = Single, 1/2 = Split panes) where the pane's top box puts its buttons.
  const [paneSlots, setPaneSlots] = useState<(HTMLElement | null)[]>([null, null, null]);
  const slotRefs = useMemo(
    () => [0, 1, 2].map((i) => (el: HTMLElement | null) => setPaneSlots((s) => (s[i] === el ? s : s.map((x, j) => (j === i ? el : x))))),
    [],
  );
  // Beside each tab line's − % + control (Sites' selector goes there).
  const [toolSlots, setToolSlots] = useState<(HTMLElement | null)[]>([null, null, null]);
  const toolRefs = useMemo(
    () => [0, 1, 2].map((i) => (el: HTMLElement | null) => setToolSlots((s) => (s[i] === el ? s : s.map((x, j) => (j === i ? el : x))))),
    [],
  );
  const [todayTab2, setTodayTab2] = useState<TodayTab>(() => {
    const saved = readSaved<string>("sk-today-tab2", "calendar");
    return TODAY_TABS.some(([id]) => id === saved)
      ? (saved as TodayTab)
      : "calendar";
  });
  const pickTodayTab2 = (t: TodayTab) => {
    setTodayTab2(t);
    writeSaved("sk-today-tab2", t);
  };
  const shortTerm = useShortTermFocus();
  // Everything on the calendar a short-term focus can count down to: events, plans, bills, dated tasks.
  const { plans: hubPlans } = usePlans();
  const linkItems = [
    ...(schedule?.events || []).map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      allDay: e.allDay,
      kind: "Calendar",
    })),
    ...hubPlans
      .filter((p) => p.status === "open" || p.status === "yes")
      .map((p) => ({
        id: p.id,
        title: p.title,
        start: p.date,
        allDay: true,
        kind: "Plan",
      })),
    ...bills
      .filter((b) => !b.skipped)
      .map((b) => ({
        id: `bill:${b.key}`,
        title: `Pay ${b.bill.name}`,
        start: b.due,
        allDay: true,
        kind: "Bill",
      })),
    ...calTasks
      .filter((t) => !t.done)
      .map((t) => ({
        id: `task:${t.id}`,
        title: t.title,
        start: t.date,
        allDay: true,
        kind: "Task",
      })),
  ];
  const todaySummary =
    tab === "grounding" ? (
      <GroundingSummary />
    ) : tab === "calendar" ? (
      <ScheduleSummary schedule={schedule} bills={bills} />
    ) : tab === "focus" ? (
      shortTermSummary(shortTerm.open)
    ) : tab === "rhythm" ? (
      "Habits, routines and the shape of the day"
    ) : tab === "sites" ? (
      "Pick a site to open it here"
    ) : (
      <BriefSummary snapshots={snapshots} bills={bills} />
    );
  useEffect(() => {
    const onReveal = (e: Event) =>
      (e as CustomEvent).detail === "brief" && setTodayTab("brief");
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);
  // TickTick's "how much of today is logged" rings (done or won't-do vs still open) — tasks and habits.
  const ttTasks = snapshots.ticktick?.tasks || [];
  const isHabitTask = (t: TaskItem) =>
    t.kind === "habit" || t.id.startsWith("habit-");
  // TickTick habits live in Daily Rhythm & Routine now: not in Doing Now or the site tabs.
  const noHabits = useMemo(() => {
    const tt = snapshots.ticktick;
    if (!tt) return snapshots;
    return {
      ...snapshots,
      ticktick: {
        ...tt,
        tasks: tt.tasks.filter((t) => !isHabitTask(t)),
        featured: tt.featured.filter((f) => !f.id.startsWith("habit-")),
      },
    };
  }, [snapshots]);
  const ticktickRings = (
    <div className="sk-rings">
      <TickTickRings
        ledger={ledger}
        openTasks={
          ttTasks.filter((t) => t.status !== "done" && !isHabitTask(t)).length
        }
        openHabits={Number(snapshots.ticktick?.metrics?.habits) || 0}
        habitIds={ttTasks.some(isHabitTask) ? ttTasks.filter((t) => t.status !== "done" && isHabitTask(t)).map((t) => t.id) : undefined}
      />
    </div>
  );
  const soonBills = bills.filter((b) => b.days >= 0 && b.days <= 21);
  const financeBills = (
    <>
      <ListHead title="Money Due" meta="Next 3 weeks">
        <button
          type="button"
          className="sk-link"
          onClick={() => enter("money")}
        >
          Money page
          <Icon name="chevron" />
        </button>
      </ListHead>
      {soonBills.length ? (
        soonBills
          .slice(0, 4)
          .map((d) => <KitBillRow key={d.key} d={d} onPaid={onBillPaid} />)
      ) : (
        <p className="sk-empty">Nothing due in the next 3 weeks.</p>
      )}
      {soonBills.length > 4 ? (
        <p className="sk-sec sk-more">{soonBills.length - 4} more later</p>
      ) : null}
      {overdueBills.length ? (
        <>
          <ListHead title="Overdue" meta="Not marked paid" />
          {overdueBills.map((d) => (
            <KitBillRow key={d.key} d={d} onPaid={onBillPaid} />
          ))}
        </>
      ) : null}
    </>
  );
  const tabAvailable = (id: TodayTab) =>
    (id !== "grounding" || grounding) && (id !== "money" || money);
  const tab2: TodayTab = tabAvailable(todayTab2) ? todayTab2 : "calendar";
  const tabBar = (current: TodayTab, pick: (t: TodayTab) => void) => (
    <SegTabs
      label="Today"
      value={current}
      onPick={pick}
      items={TODAY_TABS.filter(([id]) => tabAvailable(id)).map(([id, label]) => ({ id, label }))}
    />
  );
  // A Today tab line: tabs | − % + (over Refresh sources), then the pane's own buttons.
  const todayBar = (t: TodayTab, pick: (t: TodayTab) => void, zoomEl: ReactNode, refresh: boolean, slot: number) => {
    const tools = zoomEl || (refresh && onRefresh);
    return (
      <div className="sk-todaybar">
        {tabBar(t, pick)}
        {tools ? <span className="sk-todaybar-div" aria-hidden="true" /> : null}
        {tools ? (
          <div className="sk-todaybar-tools">
            <span className="sk-todaybar-zoomrow">
              {zoomEl}
              <span className="sk-todaybar-toolslot" ref={toolRefs[slot]} />
            </span>
            {refresh && onRefresh ? (
              <button
                type="button"
                className="sk-todaybar-refresh"
                onClick={onRefresh}
                disabled={syncing}
                title="Sync Gmail, Radall, calendar, bills and TickTick now"
              >
                <Icon name="refresh" size={12} />
                {syncing ? "Syncing…" : "Refresh sources"}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="sk-todaybar-slot" ref={slotRefs[slot]} />
      </div>
    );
  };
  // Per-site body extras: Self = captures | focus tasks, Radall = money due, TickTick = rings (Home's site tabs and Today › Sites).
  const siteExtra = Object.fromEntries(SITE_ROWS.flatMap(r => r.ids).map(id => [id, <div key={id}>
            {id === 'self' ? (
              capturesPanel
            ) : id === 'radall' ? (bills.length ? financeBills : null) : id === 'ticktick' ? ticktickRings : null}
            {id === 'self' ? null : <AssignedFocus target={id} focus={shortTerm} events={linkItems} bills={bills} openFinance={(debtId, tab) => { requestOpenDebt(debtId, tab); enter("money"); }} />}
          </div>]));
  const renderTab = (t: TodayTab, pane = 0) =>
        t === "rhythm" ? (
          <FocusSection bare snapshots={snapshots} ledger={ledger} completeHabit={(x) => onCompleteTask("ticktick", x)} enter={enter} focus={shortTerm} events={linkItems} bills={bills} openFinance={(id, tab) => { requestOpenDebt(id, tab); enter("money"); }} />
        ) : t === "sites" ? (
          <SitePicker
            snapshots={noHabits}
            enter={enter}
            openSource={openSource}
            onCompleteFeatured={onCompleteFeatured}
            onCompleteTask={onCompleteTask}
            onStarTask={onStarTask}
            extra={siteExtra}
            storeKey={pane === 2 ? "sk-today-site-2" : "sk-today-site"}
          />
        ) : t === "money" ? (
          <div className="sk-money-tab">{money}</div>
        ) : t === "grounding" ? (
          <div className="sk-mountain">
            <svg
              className="sk-mtn-art"
              viewBox="0 0 800 240"
              preserveAspectRatio="xMidYMax slice"
              aria-hidden="true"
            >
              <circle className="sk-mtn-sun" cx="610" cy="70" r="26" />
              <path className="sk-mtn-far" d="M0 240V150l90-60 70 45 110-85 120 100 80-50 100 80 90-70 140 90v40z" />
              <path className="sk-mtn-mid" d="M0 240V175l120-80 90 60 130-100 140 120 90-60 110 90 120-70v105z" />
              <path className="sk-mtn-snow" d="M340 55l-26 21 14-6 12 10 10-9 16 8z" />
              <path className="sk-mtn-near" d="M0 240V205l140-70 100 70 160-90 150 100 110-60 140 80v35z" />
            </svg>
            <div className="sk-mtn-body">{grounding}</div>
          </div>
        ) : t === "calendar" ? (
          <ScheduleSection
            schedule={schedule}
            bills={bills}
            onBillPaid={onBillPaid}
            tasks={calTasks}
            onTaskDone={onTaskDone}
            onAddPrep={onAddPrep}
          />
        ) : t === "goals" ? (
          <GoalsView
            events={linkItems}
            bills={bills}
            openFinance={(id, tab) => {
              requestOpenDebt(id, tab);
              enter("money");
            }}
          />
        ) : t === "focus" ? (
          <ShortTermFocus
            focus={shortTerm}
            snapshots={snapshots}
            ledger={ledger}
            events={linkItems}
            bills={bills}
            openFinance={(id, tab) => {
              requestOpenDebt(id, tab);
              enter("money");
            }}
          />
        ) : (
          <DailyBrief
            complete={payFromPriority}
            snapshots={snapshots}
            bills={bills}
            schedule={schedule}
            enter={enter}
            focus={shortTerm}
            events={linkItems}
            openFinance={(id, tab) => {
              requestOpenDebt(id, tab);
              enter("money");
            }}
          />
        );

  return (
    <>
      <HomeTop
        snapshots={snapshots}
        bills={bills}
        stats={completionStats}
        ledger={ledger}
        schedule={schedule}
        openTotal={openTotal}
        openSites={openBySite.length}
        unfinished={unfinished}
        openFocus={openFocus}
        enter={enter}
        focusCount={shortTerm.open}
        onFocusPress={() => {
          pickTodayTab("focus");
          reveal("brief");
        }}
      />

      <Section
        id="brief"
        title="Today"
        summary={todaySummary}
        actions={
          <>
          {board ? <PaneZoomButtons zoom={boardZoom} set={setBoardZoom} min={50} max={ZOOM_MAX} step={ZOOM_STEP} /> : null}
          <div className="sk-seg sk-viewseg" role="group" aria-label="Today view">
            <button
              type="button"
              aria-pressed={!split && !board}
              onClick={() => setSplit(false)}
              title="One tab at a time"
            >
              <svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="2" /></svg>
              Single
            </button>
            <button
              type="button"
              aria-pressed={split && !board}
              onClick={() => setSplit(true)}
              title="Two tabs side by side"
            >
              <svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="6" height="10" rx="2" /><rect x="9" y="1" width="6" height="10" rx="2" /></svg>
              Split
            </button>
            <button
              type="button"
              aria-pressed={board}
              onClick={() => setBoard(true)}
              title="Dashboard for an always-on screen: clock, weather, calendar, bills, focus"
            >
              <svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="5" height="10" rx="1.5" /><rect x="7.5" y="1" width="7.5" height="4.5" rx="1.5" /><rect x="7.5" y="6.5" width="7.5" height="4.5" rx="1.5" /></svg>
              Dashboard
            </button>
          </div>
          </>
        }
      >
        {board ? (
          <div className="sk-boardzoom" style={boardZoom === 100 ? undefined : { zoom: boardZoom / 100 }}>
            <HubBoard
              snapshots={snapshots}
              bills={bills}
              schedule={schedule}
              focus={shortTerm}
              ledger={ledger}
              events={linkItems}
              openTab={(t) => {
                setBoard(false);
                pickTodayTab(t);
              }}
              sites={openBySite}
              openSite={(id) => enter(id as SpaceId)}
              completeTask={(t) => onCompleteTask("ticktick", t)}
            />
          </div>
        ) : split && !phone ? (
          <div className="sk-split">
            {([
              [tab, pickTodayTab],
              [tab2, pickTodayTab2],
            ] as const).map(([t, pick], i) => (
              <div key={i} className="sk-splitcol">
                {/* Money has its own − / + (it starts at 60%), so the pane zoom leaves it alone. */}
                {todayBar(t, pick, t === "money" ? <MoneyZoom pane /> : <PaneZoomButtons zoom={splitZoom[i]} set={(v) => setSplitZoom(i, v)} min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} />, i === 0, i + 1)}
                <PaneHeadContext.Provider value={paneSlots[i + 1]}><PaneToolSlotContext.Provider value={toolSlots[i + 1]}>
                  <div className="sk-splitzoom" style={t === "money" || splitZoom[i] === 100 ? undefined : { zoom: splitZoom[i] / 100 }}>
                    <CapPane key={t} cap="split" label={TODAY_TABS.find(([id]) => id === t)?.[1] || "Today"}>
                      {renderTab(t, i + 1)}
                    </CapPane>
                  </div>
                </PaneToolSlotContext.Provider></PaneHeadContext.Provider>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* The tab row is the Today header: tabs | page size over Refresh sources | the pane's buttons. */}
            {todayBar(tab, pickTodayTab, tab === "money"
              ? <PaneZoomButtons zoom={moneyZoom} set={setMoneyZoom} min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} />
              : <PaneZoomButtons zoom={singleZoom} set={setSingleZoom} min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} />, true, 0)}
            <PaneHeadContext.Provider value={paneSlots[0]}><PaneToolSlotContext.Provider value={toolSlots[0]}>
              <div className="sk-splitzoom" style={(tab === "money" ? moneyZoom : singleZoom) === 100 ? undefined : { zoom: (tab === "money" ? moneyZoom : singleZoom) / 100 }}>
                <CapPane key={tab} cap="page" label={TODAY_TABS.find(([id]) => id === tab)?.[1] || "Today"}>
                  {renderTab(tab)}
                </CapPane>
              </div>
            </PaneToolSlotContext.Provider></PaneHeadContext.Provider>
          </>
        )}
      </Section>

      <Section
        id="priority"
        title="Doing Now & Sites"
        summary={<PrioritySummary />}
      >
        <PriorityBoard
          snapshots={noHabits}
          enter={(id) => enter(id)}
          onComplete={payFromPriority}
          bills={bills.filter((b) => !b.skipped)}
        >
        <SitesTabs
          snapshots={noHabits}
          enter={enter}
          openSource={openSource}
          onCompleteFeatured={onCompleteFeatured}
          onCompleteTask={onCompleteTask}
          onStarTask={onStarTask}
          extra={siteExtra}
        />
        </PriorityBoard>
      </Section>

      <Section
        id="review"
        title="Review"
        summary={
          <>
            {completionStats.today} done today · {completionStats.allTime} total
            · {completionStats.openAcrossSources} open
          </>
        }
      >
        <ReviewPanel
          stats={completionStats}
          ledger={ledger}
          focusConfig={focusConfig}
          renderBalance={renderBalance}
          renderSorting={renderSorting}
        />
      </Section>

      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>11 sources · completion ledger · cloud backup</p>
        <span>Est. 2026</span>
      </footer>
      <LinkDevicePrompt compact />
    </>
  );
}
