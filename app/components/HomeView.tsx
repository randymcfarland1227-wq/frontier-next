"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { ScheduleSection } from "./ScheduleSection";
import { KitBillRow } from "./BillsList";
import {
  FocusSection,
  ShortTermFocus,
  shortTermSummary,
  useShortTermFocus,
} from "./FocusSection";
import { HomeTop } from "../sticker/HomeTop";
import { ListHead, REVEAL_EVENT, Section } from "../sticker/kit";
import { readSaved, writeSaved } from "../../lib/storage";
import { TickTickRings } from "./TickTickRings";
import { Icon } from "../sticker/Icon";
import { SITE_ROWS, SitesSection } from "../sticker/Sites";

type TodayTab = "brief" | "grounding" | "calendar" | "focus";
const TODAY_TABS: [TodayTab, string][] = [
  ["brief", "Daily Brief"],
  ["grounding", "Grounding"],
  ["calendar", "Calendar"],
  ["focus", "Short-term focus"],
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

export function HomeView({
  snapshots,
  enter,
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
  unfinished,
  openFocus,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
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
  /** Today drawer: items not done yet, and how to open it (the one prominent button) */
  unfinished: number;
  openFocus: () => void;
}) {
  const { lanes } = usePriorityPins();
  // Open to-dos per site — the same blue numbers each card shows.
  const openBySite = SITE_ROWS.flatMap((r) => r.ids)
    .map((id) => ({
      id,
      name: sourceById[id].shortName,
      count: shownMetric(id, snapshots[id], lanes).value || 0,
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
  const overdueBills = bills.filter(isOverdue);
  useBriefPush(snapshots, bills);
  // Paid from anywhere a bill shows up as a Priority item ("Doing now").
  const payFromPriority = (source: SourceId, item: FeaturedItem) => {
    const due = bills.find((b) => b.key === item.id);
    if (source === "radall" && due) onBillPaid(due);
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
    todayTab === "grounding" && !grounding ? "brief" : todayTab;
  const pickTodayTab = (t: TodayTab) => {
    setTodayTab(t);
    writeSaved("sk-today-tab", t);
  };
  const shortTerm = useShortTermFocus();
  const todaySummary =
    tab === "grounding" ? (
      <GroundingSummary />
    ) : tab === "calendar" ? (
      <ScheduleSummary schedule={schedule} bills={bills} />
    ) : tab === "focus" ? (
      shortTermSummary(shortTerm.open)
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
  const ticktickRings = (
    <div className="sk-rings">
      <TickTickRings
        ledger={ledger}
        openTasks={
          ttTasks.filter((t) => t.status !== "done" && !isHabitTask(t)).length
        }
        openHabits={Number(snapshots.ticktick?.metrics?.habits) || 0}
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
      />

      <Section id="brief" title="Today" summary={todaySummary}>
        <div className="sk-seg sk-today-tabs" role="group" aria-label="Today">
          {TODAY_TABS.filter(([id]) => id !== "grounding" || grounding).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => pickTodayTab(id)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        {tab === "grounding" ? (
          grounding
        ) : tab === "calendar" ? (
          <ScheduleSection
            schedule={schedule}
            bills={bills}
            onBillPaid={onBillPaid}
            tasks={calTasks}
            onTaskDone={onTaskDone}
            onAddPrep={onAddPrep}
          />
        ) : tab === "focus" ? (
          <ShortTermFocus focus={shortTerm} />
        ) : (
          <DailyBrief snapshots={snapshots} bills={bills} enter={enter} />
        )}
      </Section>

      <FocusSection snapshots={snapshots} ledger={ledger} enter={enter} />

      <Section id="priority" title="Doing Now" summary={<PrioritySummary />}>
        <PriorityBoard
          snapshots={snapshots}
          enter={(id) => enter(id)}
          onComplete={payFromPriority}
          bills={bills.filter((b) => !b.skipped)}
        />
      </Section>

      <SitesSection
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
        extra={{
          self: capturesPanel,
          radall: bills.length ? financeBills : undefined,
          ticktick: ticktickRings,
        }}
      />

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
    </>
  );
}
