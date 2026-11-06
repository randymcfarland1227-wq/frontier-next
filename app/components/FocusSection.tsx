"use client";

import { useCallback, useEffect, useState } from "react";
import { Circle, Group, ListHead, Section } from "../sticker/kit";
import { useFold } from "./Collapsible";
import { FocusCards, type LinkItem, type OpenFinance } from "./FocusCards";
import type { BillDue } from "../../lib/schedule";
import { Icon } from "../sticker/Icon";
import type { SourceId, SourceSnapshot, SpaceId, TaskItem } from "../../lib/types";
import { readSaved, writeSaved } from "../../lib/storage";
import { FOCUS_LIST_EVENT, ONGOING_KEY } from "../../lib/ongoingGoals";
import type { HabitGoal } from "../../lib/locks";
import { mondayScope, stampChanges } from "../../lib/focusSync";
import { dayRecord, localDayKey, useDayKey } from "../../lib/dayKey";
import { isReopened, type CompletionLedger } from "../../lib/completions";
import { tickTickToday } from "../../lib/tickTickToday";
import { clearTickTickLog, logTickTick, useLoggedToday } from "../../lib/ticktickLog";
import { loadDayLog, TICKTICK_DAYLOG_EVENT } from "../../lib/ticktickDone";
import { useSiteLists } from "../../lib/siteLists";
import type { FocusPriority } from "../../lib/focusPriority";
import type { FocusRef } from "../../lib/focusRefs";
import { activePursuits, type GoalLink } from "../../lib/goalLinks";
import { assignedFocusLists, focusListView, type FocusSectionId } from "../../lib/focusRouting";
import flowMap from "../../public/data/flow-map.json";
import { DECK, pinKey, placePin, unpin, usePriorityPins, type LaneMap } from "../../lib/priorityPins";
import { focusListId, focusTaskId } from "../../lib/focusPins";

type Snaps = Record<SourceId, SourceSnapshot>;

/** A remembered open/shut for a small list on this device. */
function useShut(key: string): [boolean, () => void] {
  const k = `sk-fold-${key}`;
  const [shut, setShut] = useState(() => readSaved<boolean>(k, false));
  return [
    shut,
    () => {
      writeSaved(k, !shut);
      setShut(!shut);
    },
  ];
}

/** A tiny per-day record on this device (starts empty every new day). */
function useDayState<T>(key: string, fallback: T) {
  const day = useDayKey();
  const [state, setState] = useState<{ day: string; v: T }>(() => ({
    day,
    v: dayRecord(key, day, fallback),
  }));
  // A new day shows the empty fallback until something is logged.
  const value = state.day === day ? state.v : fallback;
  const set = useCallback(
    (next: T) => {
      setState({ day, v: next });
      writeSaved(key, { day, v: next });
    },
    [key, day],
  );
  return [value, set] as const;
}

export type SubTask = {
  id: string;
  text: string;
  done: boolean;
  /** Sub-details typed in its pop-out */
  note?: string;
  /** Optional due day (YYYY-MM-DD) */
  due?: string;
  /** A read-only Finance reference, rendered as one row in this list. */
  fin?: { key: string; label: string };
  /** A research task that fills in a Finance item (its amount / payment plan): checking it off asks for what you found. */
  fills?: { key: string; label: string };
};
export type SubList = { id: string; name: string; tasks: SubTask[] };

export type Entry = {
  id: string;
  title: string;
  /** Scope (what it is) — the old "detail" note */
  note?: string;
  done?: boolean;
  /** Optional ranking shared by the card and Daily Brief. */
  priority?: FocusPriority;
  push?: number;
  /** Day (YYYY-MM-DD) it started — drives "Day 3 · started 2 days ago" */
  since?: string;
  /** Short-term focus cards: why it matters */
  why?: string;
  /** Named sub-task lists, layered under the card */
  lists?: SubList[];
  /** One-time setups already applied to this card (e.g. 'reg-lists-v1') so they never run twice */
  seeded?: string[];
  /** Day (YYYY-MM-DD) it counts down to, and the calendar item it's linked to (if any) */
  date?: string;
  eventId?: string;
  eventTitle?: string;
  /** Day (YYYY-MM-DD) it was added */
  added?: string;
  /** When this card last changed (set on save; the cloud backup keeps the newest) */
  at?: string;
  /** The site it belongs to — colours its card */
  site?: SourceId;
  /** A Home focus section, using the same record as the main Short-term Focus view. */
  section?: FocusSectionId;
  /** Explicitly remove a legacy section assignment without moving its saved record. */
  unassigned?: boolean;
  /** Site lists (tasks grouped in one site) linked into this goal; they stay in the pool too (lib/siteLists.ts) */
  siteLists?: string[];
  /** Single site tasks linked in by search, as pin keys (`source:id`); they stay in their site too */
  siteTasks?: string[];
  /** An ongoing goal also shown in the Short-term focus view at the top of Today (same record, so edits mirror) */
  inFocus?: boolean;
  /** An ongoing goal: a direction, not a one-time task (made from Self) */
  ongoing?: boolean;
  /** Finance lists linked in as sub-task lists (key says which debt-file items: see lib/finLinks) */
  fin?: Array<{ key: string; label: string }>;
  /** Finished by itself once a TickTick habit is checked in N times (then a "delete the habit" task is added) */
  habitGoal?: HabitGoal;
  /** References: links, documents and images for this focus (lib/focusRefs.ts) */
  refs?: FocusRef[];
  /** Ongoing goals: TickTick habits / recurring tasks that move it forward (lib/goalLinks.ts) */
  links?: GoalLink[];
};

const mondayKey = () => mondayScope();

/** A saved typed list; `week` lists start empty every Monday. */
function useFocusList(storageKey: string, week?: boolean) {
  const scope = week ? mondayKey() : "";
  const [state, setState] = useState(() =>
    readSaved<{ scope: string; items: Entry[] }>(storageKey, {
      scope,
      items: [],
    }),
  );
  // Something else (Self's capture box) can add to a list; pick it up when it says so.
  useEffect(() => {
    const reload = (e: Event) => {
      if ((e as CustomEvent).detail !== storageKey) return;
      setState(readSaved(storageKey, { scope, items: [] as Entry[] }));
    };
    // The cloud backup merged cards in from another device.
    const synced = () => setState(readSaved(storageKey, { scope, items: [] as Entry[] }));
    window.addEventListener(FOCUS_LIST_EVENT, reload);
    window.addEventListener('lifehub:synced', synced);
    return () => {
      window.removeEventListener(FOCUS_LIST_EVENT, reload);
      window.removeEventListener('lifehub:synced', synced);
    };
  }, [storageKey, scope]);
  // Only a `week` list empties itself on Monday. Every other list shows all its cards whatever scope
  // was saved (a stray scope hid the restored MD Registration card on 2026-11-05).
  const items = !week || state.scope === scope ? state.items : [];
  const save = (changed: Entry[]) => {
    // New and edited cards get a change time, removed ones a tombstone, so the cloud backup can merge them.
    const next = stampChanges(storageKey, items, changed);
    const v = { scope, items: next };
    setState(v);
    writeSaved(storageKey, v);
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: storageKey }));
  };
  return [items, save] as const;
}

/** The existing fitness key stores a plain array; keep that shape and key unchanged. */
function useFitnessFocus() {
  const key = 'lifehub-focus-fit-areas';
  const [items, setItems] = useState(() => readSaved<Entry[]>(key, []));
  useEffect(() => {
    const reload = (e: Event) => { if ((e as CustomEvent).detail === key) setItems(readSaved<Entry[]>(key, [])); };
    const synced = () => setItems(readSaved<Entry[]>(key, []));
    window.addEventListener(FOCUS_LIST_EVENT, reload);
    window.addEventListener('lifehub:synced', synced);
    return () => {
      window.removeEventListener(FOCUS_LIST_EVENT, reload);
      window.removeEventListener('lifehub:synced', synced);
    };
  }, []);
  const save = (changed: Entry[]) => {
    const next = stampChanges(key, items, changed);
    setItems(next); writeSaved(key, next);
    window.dispatchEvent(new CustomEvent(FOCUS_LIST_EVENT, { detail: key }));
  };
  return [items, save] as const;
}

const BOTTLES = 5;
function Water({
  water,
  setWater,
}: {
  water: number;
  setWater: (n: number) => void;
}) {
  return (
    <>
      <p className="sk-water-name">
        Drink 5 bottles of water{" "}
        <small>
          {water} of {BOTTLES}
        </small>
      </p>
      <div
        className="sk-bottles"
        role="group"
        aria-label="Bottles of water today"
      >
        {Array.from({ length: BOTTLES }, (_, i) => (
          <button
            key={i}
            type="button"
            className={i < water ? "is-on" : ""}
            aria-label={`Bottle ${i + 1}`}
            aria-pressed={i < water}
            onClick={() => setWater(i + 1 === water ? i : i + 1)}
          />
        ))}
      </div>
    </>
  );
}

/** Marvel's options for today, straight from the Calm Plan in his Den: this OR that in each group, then mark it done. */
const MARVEL_MENU: {
  id: string;
  label: string;
  options: { id: string; t: string; d: string }[];
}[] = [
  {
    id: "sniff",
    label: "Sniff",
    options: [
      { id: "walk", t: "Sniff walk", d: "15–25 min, quiet route" },
      {
        id: "scatter",
        t: "Scatter a meal",
        d: "In the grass, bowl up after 15 min",
      },
    ],
  },
  {
    id: "move",
    label: "Move",
    options: [
      { id: "tug", t: "Tug with rules", d: "5 min · sit, get it, drop" },
      { id: "outlet", t: "Walk", d: "15–25 min, slack leash" },
    ],
  },
  {
    id: "think",
    label: "Think",
    options: [
      { id: "findit", t: "Find it", d: "Hide 10 kibble, he finds it" },
      { id: "paycalm", t: "Pay calm", d: "Lies down quiet → toss kibble ×10" },
    ],
  },
];
type MarvelPicks = Record<string, { pick?: string; done?: boolean }>;

/** Today's tasks and habits for an area (from TickTick), struck through once done. */
function DayTasks({ tasks }: { tasks: { title: string; done: boolean }[] }) {
  if (!tasks.length) return <p className="sk-empty">Nothing today</p>;
  return (
    <ul className="sk-daytasks" aria-label="Today's tasks and habits">
      {tasks.map((t) => (
        <li key={t.title} className={t.done ? "is-done" : ""}>
          <Icon name={t.done ? "check" : "minus"} size={13} />
          <span>{t.title}</span>
        </li>
      ))}
    </ul>
  );
}
const NUTRITION_RE =
  /nutri|protein|meal|eat\b|food|calorie|vitamin|supplement|creatine|breakfast|lunch|dinner|water|bottle|drink|fiber|veg/i;
const FITNESS_RE =
  /workout|gym|lift|run\b|walk|stretch|fitness|exercise|cardio|steps|mobility|posture|abs\b|strength|squat|push.?up|yoga|recovery|physical therapy|\bpt\b/i;
const notMarvel = (t: { title: string }) => !/marvel/i.test(t.title);

const isHabit = (t: TaskItem) => t.kind === "habit" || t.id.startsWith("habit-");

// TickTick's own habit sections, folded into the four times of day Randy sorts them by.
const HABIT_GROUPS = [
  { id: "pregym", label: "Pre-gym" },
  { id: "day", label: "Daytime" },
  { id: "optional", label: "Optional" },
  { id: "night", label: "Night" },
] as const;
const HABIT_SECTIONS = new Map<string, string>();
const HABIT_TITLES = new Map<string, string>();
const HABIT_NAMES = new Map<string, string>();
for (const r of (flowMap as { records?: Array<{ id: string; title?: string; name?: string; sectionName?: string; executionType?: string }> }).records || []) {
  if (r.executionType !== "Habit" || !r.sectionName) continue;
  HABIT_SECTIONS.set(r.id, r.sectionName);
  HABIT_NAMES.set(r.id, r.title || r.name || "Habit");
  HABIT_TITLES.set((r.title || r.name || "").toLowerCase(), r.sectionName);
}
function habitGroupOf(id: string, title: string): (typeof HABIT_GROUPS)[number]["id"] {
  const sec = HABIT_SECTIONS.get(id) || HABIT_TITLES.get(title.toLowerCase()) || "";
  if (/gym/i.test(sec)) return "pregym";
  if (/night/i.test(sec)) return "night";
  if (/optional/i.test(sec)) return "optional";
  return "day";
}

/**
 * Every TickTick habit for today (moved here from Doing Now and the TickTick tab, 2026-11-04):
 * open ones to check in, then the ones already checked in today (struck through).
 */
function TickTickHabits({
  ticktick,
  ledger,
  day,
  complete,
}: {
  ticktick?: SourceSnapshot;
  ledger?: CompletionLedger;
  day: string;
  complete?: (t: TaskItem) => void;
}) {
  const { reopen } = useSiteLists();
  const logged = useLoggedToday();
  const [dayLog, setDayLog] = useState(loadDayLog);
  useEffect(() => {
    const on = () => setDayLog(loadDayLog());
    window.addEventListener(TICKTICK_DAYLOG_EVENT, on);
    return () => window.removeEventListener(TICKTICK_DAYLOG_EVENT, on);
  }, []);
  const [shutGroups, setShutGroups] = useState<Record<string, boolean>>({ optional: true, night: true });
  const [msg, setMsg] = useState("");
  const skippedIds = new Set([...Object.keys(logged), ...dayLog.skippedHabits, ...(dayLog.notDoneHabits || [])]);
  const offLabel = (id: string) => (logged[id] ? logged[id] === 'notdone' : (dayLog.notDoneHabits || []).includes(id) && !dayLog.skippedHabits.includes(id)) ? 'uncompleted' : 'skipped';
  const all = (ticktick?.tasks || []).filter((t) => isHabit(t) && t.status !== "done");
  const open = all.filter((t) => !skippedIds.has(t.id));
  const titleOf = (id: string) => all.find((t) => t.id === id)?.title || HABIT_NAMES.get(id) || "Habit";
  const skipped = [...skippedIds]
    .filter((id) => HABIT_NAMES.has(id) || all.some((t) => t.id === id))
    .map((id) => ({ id, title: titleOf(id) }));
  const openIds = new Set(all.map((t) => t.id));
  const done = Object.entries(ledger?.entries || {})
    .filter(
      ([k, e]) =>
        e.source === "ticktick" &&
        !isReopened(e) &&
        (k.split("::").length === 3 || e.taskId.startsWith("habit-")) &&
        !openIds.has(e.taskId) &&
        localDayKey(new Date(e.completedAt)) === day,
    )
    .map(([k, e]) => ({ key: k, id: e.taskId, title: e.title || "Habit" }));
  if (!open.length && !done.length && !skipped.length) return <p className="sk-empty">No TickTick habits today.</p>;
  const say = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(""), 4000);
  };
  const skip = async (t: TaskItem) => {
    if (!(await logTickTick(t, "skipped"))) say("Skip wasn’t saved to TickTick");
  };
  const notDone = async (t: TaskItem) => {
    if (!(await logTickTick(t, "notdone"))) say("Uncompleted wasn’t saved to TickTick");
  };
  const unskip = async (id: string) => {
    if (!(await clearTickTickLog(id))) say("Undo wasn’t saved to TickTick");
  };
  return (
    <div className="sk-habits" aria-label="TickTick habits today">
      {msg ? <p className="sk-cap" role="status">{msg}</p> : null}
      {HABIT_GROUPS.map((g) => {
        const mine = open.filter((t) => habitGroupOf(t.id, t.title) === g.id);
        const fin = done.filter((t) => habitGroupOf(t.id, t.title) === g.id);
        const off = skipped.filter((t) => habitGroupOf(t.id, t.title) === g.id);
        if (!mine.length && !fin.length && !off.length) return null;
        const shut = shutGroups[g.id] ?? false;
        return (
          <div key={g.id} className={`sk-habit-group${shut ? " is-shut" : ""}`}>
            <button
              type="button"
              className="sk-habit-head"
              aria-expanded={!shut}
              onClick={() => setShutGroups({ ...shutGroups, [g.id]: !shut })}
            >
              <Icon name={shut ? "chevron" : "chevronDown"} size={12} />
              <strong>{g.label}</strong>
              <em>{mine.length ? `${mine.length} left` : "all logged"}</em>
            </button>
            {shut ? null : (
              <ul className="sk-daytasks">
                {mine.map((t) => (
                  <li key={t.id}>
                    {complete ? <Circle onDone={() => complete(t)} label={`Check in: ${t.title}`} /> : <Icon name="minus" size={12} />}
                    <span>{t.title}</span>
                    <button type="button" className="sk-habit-act" onClick={() => void skip(t)} title="Skip today: you're choosing not to do it (TickTick Skip)">
                      Skip
                    </button>
                    <button type="button" className="sk-habit-act" onClick={() => void notDone(t)} title="Uncompleted: you didn't get it done (TickTick Uncompleted)">
                      Uncompleted
                    </button>
                  </li>
                ))}
                {fin.map((t) => (
                  <li key={t.key} className="is-done">
                    <button
                      type="button"
                      className="sk-circle is-done"
                      onClick={() => reopen?.("ticktick", t.id)}
                      aria-label={`Uncheck ${t.title}`}
                      title="Uncheck (undo today’s check-in)"
                    >
                      <Icon name="check" size={12} />
                    </button>
                    <span>{t.title}</span>
                    <em className="sk-habit-tag">done</em>
                  </li>
                ))}
                {off.map((t) => (
                  <li key={t.id} className="is-skipped">
                    <Icon name="minus" size={12} />
                    <span>{t.title}</span>
                    <em className="sk-habit-tag">{offLabel(t.id)}</em>
                    <button type="button" className="sk-habit-act" onClick={() => void unskip(t.id)} title="Take back the skip / uncompleted mark">
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Today's Marvel tasks and habits from TickTick, above the menu, each marked done or not. */
function MarvelToday({ tasks }: { tasks: { title: string; done: boolean }[] }) {
  const [shut, toggle] = useShut("focus-marvel-today");
  if (!tasks.length) return null;
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="sk-mv-today">
      <ListHead
        title="Marvel today"
        meta={`${done} of ${tasks.length} done`}
        shut={shut}
        onToggle={toggle}
      />
      {shut ? null : (
        <ul>
          {tasks.map((t) => (
            <li key={t.title} className={t.done ? "is-done" : ""}>
              <Icon name={t.done ? "check" : "minus"} size={13} />
              <span>{t.title}</span>
              <em>{t.done ? "done" : "not yet"}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MarvelMenu({
  st,
  setSt,
}: {
  st: MarvelPicks;
  setSt: (v: MarvelPicks) => void;
}) {
  return (
    <>
      {MARVEL_MENU.map((g) => {
        const cur = st[g.id] || {};
        return (
          <div key={g.id} className={`sk-mv${cur.done ? " is-done" : ""}`}>
            <div className="sk-mv-head">
              <span className="sk-hl">{g.label}</span>
              <span className="sk-sec">
                {cur.done ? "Done" : cur.pick ? "Picked" : "Pick one"}
              </span>
            </div>
            <div className={`sk-either${cur.pick ? " has-pick" : ""}`}>
              {g.options.map((o, idx) => (
                <span key={o.id} className="sk-either-cell">
                  {idx === 1 ? <span className="sk-sec sk-or">or</span> : null}
                  <button
                    type="button"
                    title={o.d}
                    className={`sk-opt${cur.pick === o.id ? " is-on" : ""}`}
                    aria-pressed={cur.pick === o.id}
                    onClick={() =>
                      setSt({
                        ...st,
                        [g.id]: { pick: cur.pick === o.id ? undefined : o.id },
                      })
                    }
                  >
                    <span className="sk-opt-t">{o.t}</span>
                    <span className="sk-opt-d">{o.d}</span>
                  </button>
                </span>
              ))}
            </div>
            {cur.pick ? (
              <button
                type="button"
                className="sk-link sk-mv-done"
                aria-pressed={!!cur.done}
                onClick={() =>
                  setSt({ ...st, [g.id]: { ...cur, done: !cur.done } })
                }
              >
                {cur.done ? (
                  <>
                    <Icon name="check" size={14} />
                    Done today
                  </>
                ) : (
                  "Mark done"
                )}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The short-term lists (kept in Today's Short-term focus tab); one instance owns the state. */
export function useShortTermFocus() {
  const now = useFocusList("lifehub-focus-now2");
  const weeks = useFocusList("lifehub-focus-weeks2");
  const ongoing = useFocusList(ONGOING_KEY);
  const nutrition = useFocusList("lifehub-focus-nut2");
  const marvel = useFocusList("lifehub-focus-marvel-goals");
  const fitness = useFitnessFocus();
  // Short-term = what needs catching up; ongoing goals (and the fitness / nutrition / Marvel directions) aren't counted.
  const open = [...now[0], ...weeks[0], ...ongoing[0].filter((i) => i.inFocus)].filter((i) => !i.done).length;
  return { now, weeks, ongoing, nutrition, marvel, fitness, open };
}

export const shortTermSummary = (open: number) =>
  open ? `${count(open, "thing")} to focus on` : "Nothing typed in yet";

/** Today tab: what needs real attention right now and in the next few weeks (MD tickets paid, Marvel's DNA test…). */
export function ShortTermFocus({
  focus,
  events = [],
  bills = [],
  openFinance,
  snapshots,
  ledger,
}: {
  focus: ReturnType<typeof useShortTermFocus>;
  events?: LinkItem[];
  bills?: BillDue[];
  openFinance?: OpenFinance;
  snapshots?: Partial<Record<SourceId, SourceSnapshot>>;
  ledger?: CompletionLedger;
}) {
  const [ongoingShut, toggleOngoing] = useShut("focus-ongoing");
  const [pursuitsShut, togglePursuits] = useShut("focus-pursuits");
  const pursuits = activePursuits(snapshots?.income);
  // A goal promoted to Short-term focus is the SAME record (so edits show in both places): it appears in the
  // top grid and on its site, and is left out of the "Ongoing goals" row below so it isn't shown twice here.
  const promoted = focusListView(focus.ongoing, (i) => Boolean(i.inFocus));
  const rest = focusListView(focus.ongoing, (i) => !i.inFocus);
  const ongoingCount = rest[0].filter((i) => !i.done).length;
  return (
    <Group
      tone="focus"
      icon="target"
      title="Short-Term Focus"
      meta={focus.open || undefined}
    >
      <FocusCards
        list={focus.now}
        extra={[focus.weeks, promoted, focus.nutrition, focus.fitness, focus.marvel]}
        events={events}
        bills={bills}
        openFinance={openFinance}
        label="What needs real attention — type it, then fill in the rest"
        empty="Type what needs real attention right now."
      />
      {rest[0].length ? (
        <>
          <ListHead
            title="Ongoing goals"
            meta={`${ongoingCount} · directions, not one-time tasks`}
            shut={ongoingShut}
            onToggle={toggleOngoing}
          />
          {ongoingShut ? null : (
            <FocusCards
              list={rest}
              events={events}
              bills={bills}
              openFinance={openFinance}
              ticktick={snapshots?.ticktick}
              ledger={ledger}
              label=""
              noAdd
            />
          )}
        </>
      ) : null}
      <ListHead
        title="Active Pursuits"
        meta={`${pursuits.length} · Venture Lab ideas marked active or building`}
        shut={pursuitsShut}
        onToggle={togglePursuits}
      />
      {pursuitsShut ? null : pursuits.length ? (
        <ul className="sk-pursuits">
          {pursuits.map((p) => (
            <li key={p.id}>
              <a href={p.url || "https://randymcfarland1227-wq.github.io/income-venture-lab/"} target="_blank" rel="noreferrer">
                <b>{p.title}</b>
                {p.status ? <span className="sk-pursuit-tag">{p.status}</span> : null}
                <small>{p.open ? `${p.open} open task${p.open === 1 ? "" : "s"}` : "No open tasks"}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sk-fd-hint">Nothing from the Venture Lab yet. Open the Venture Lab once and its active and building ideas show up here.</p>
      )}
    </Group>
  );
}

export function FocusSection({
  snapshots,
  ledger,
  enter,
  focus,
  events = [],
  bills = [],
  openFinance,
  completeHabit,
}: {
  /** Check in a TickTick habit (same path as the TickTick tab used) */
  completeHabit?: (t: TaskItem) => void;
  focus: ReturnType<typeof useShortTermFocus>;
  events?: LinkItem[];
  bills?: BillDue[];
  openFinance?: OpenFinance;
  snapshots?: Snaps;
  ledger?: CompletionLedger;
  enter: (id: SpaceId) => void;
}) {
  const day = useDayKey();
  const nutritionLists = assignedFocusLists(focus, "nutrition");
  const fitnessLists = assignedFocusLists(focus, "fitness");
  const marvelLists = assignedFocusLists(focus, "marvel");
  const [water, setWater] = useDayState<number>("lifehub-focus-water", 0);
  const [picks, setPicks] = useDayState<MarvelPicks>(
    "lifehub-focus-marvel-pick",
    {},
  );
  const [daysShut, toggleDays] = useShut("focus-fit-today");
  const fitToday = tickTickToday(
    FITNESS_RE,
    snapshots?.ticktick,
    ledger,
    day,
  ).filter(notMarvel);
  const nutToday = tickTickToday(
    NUTRITION_RE,
    snapshots?.ticktick,
    ledger,
    day,
  ).filter(notMarvel);
  const marvelDone = MARVEL_MENU.filter((g) => picks[g.id]?.done).length;
  const habitsOpen = (snapshots?.ticktick?.tasks || []).filter((t) => isHabit(t) && t.status !== "done").length;
  const summary = `${water} of ${BOTTLES} bottles · Marvel ${marvelDone} of ${MARVEL_MENU.length}`;
  return (
    <Section id="focus" title="Daily Rhythm & Routine" summary={summary}>
      <div className="sk-trio sk-rhythm" data-day={day}>
        <Group
          tone="habit"
          icon="apple"
          title="Nutrition & Fitness"
          meta={`${water} of ${BOTTLES} bottles`}
        >
          <div className="sk-mv-today sk-day-panel">
            <ListHead
              title="Today’s tasks & habits"
              meta={`${fitToday.filter((t) => t.done).length + nutToday.filter((t) => t.done).length} of ${fitToday.length + nutToday.length} done`}
              shut={daysShut}
              onToggle={toggleDays}
            />
            {daysShut ? null : (
              <div className="sk-daysplit" aria-label="Today's tasks and habits">
                <div>
                  <p className="sk-cap">Fitness today</p>
                  <DayTasks tasks={fitToday} />
                </div>
                <div>
                  <p className="sk-cap">Nutrition today</p>
                  <DayTasks tasks={nutToday} />
                </div>
              </div>
            )}
          </div>
          <ListHead title="Nutrition focus" />
          <FocusCards list={nutritionLists[3]} extra={nutritionLists.filter((_, i) => i !== 3)} events={events} bills={bills} openFinance={openFinance} defaults={{ section: 'nutrition', ongoing: true }} label="Add a nutrition focus" empty="Add what you’re working on with nutrition." />
          <button
            type="button"
            className="sk-link sk-fc-log"
            onClick={() => enter("logs")}
          >
            Log in the tracker
            <Icon name="chevron" size={14} />
          </button>
          <ListHead title="Fitness focus" />
          <FocusCards list={fitnessLists[4]} extra={fitnessLists.filter((_, i) => i !== 4)} events={events} bills={bills} openFinance={openFinance} defaults={{ section: 'fitness', ongoing: true, push: 2, since: localDayKey() }} label="Add a fitness focus" empty="Add what you’re working on with fitness." />
          <ListHead title="Drink tracker" />
          <Water water={water} setWater={setWater} />
        </Group>

        <Group
          tone="marvel"
          icon="paw"
          title="Marvel · This or That"
          meta={`${marvelDone} of ${MARVEL_MENU.length}`}
        >
          <MarvelToday
            tasks={tickTickToday(/marvel/i, snapshots?.ticktick, ledger, day)}
          />
          <ListHead title="Short-term goals" />
          <FocusCards list={marvelLists[5]} extra={marvelLists.filter((_, i) => i !== 5)} events={events} bills={bills} openFinance={openFinance} defaults={{ section: 'marvel', ongoing: true }} label="Add a Marvel focus" empty="Add what you’re working on with Marvel right now." />
          <ListHead title="This or that" />
          <MarvelMenu st={picks} setSt={setPicks} />
        </Group>

        <Group
          tone="habit"
          icon="repeat"
          title="TickTick habits"
          meta={`${habitsOpen} left today`}
        >
          <TickTickHabits ticktick={snapshots?.ticktick} ledger={ledger} day={day} complete={completeHabit} />
        </Group>
      </div>
    </Section>
  );
}

/** Send-to-Doing-Now toggle for a focus list or task (pinned under Self, see lib/focusPins.ts). */
function SendToDoing({ id, label, lanes }: { id: string; label: string; lanes: LaneMap }) {
  const key = pinKey("self", id);
  const on = Boolean(lanes[key]?.lane);
  return (
    <button
      type="button"
      className={`sk-ftg-pin${on ? " is-on" : ""}`}
      aria-pressed={on}
      title={on ? `In Doing Now — click to take “${label}” out` : `Send “${label}” to Doing Now`}
      aria-label={on ? `Take ${label} out of Doing Now` : `Send ${label} to Doing Now`}
      onClick={(e) => {
        e.stopPropagation();
        if (on) unpin(key);
        else placePin(key, DECK);
      }}
    >
      <Icon name="pin" size={12} />
      {on ? <span>Doing</span> : null}
    </button>
  );
}

/** One short-term focus card's sub-list tasks, folded or open (fold state remembered per card). */
function FocusTaskGroup({ card, code, tag, lanes, onToggle }: { card: Entry; code: string; tag: string; lanes: LaneMap; onToggle: (listId: string, taskId: string) => void }) {
  const [collapsed, toggle] = useFold(`self-focus-${card.id}`);
  const lists = (card.lists || []).map((l) => ({ l, tasks: l.tasks.filter((t) => !t.fin) })).filter((x) => x.tasks.length);
  const open = lists.reduce((n, x) => n + x.tasks.filter((t) => !t.done).length, 0);
  const done = lists.reduce((n, x) => n + x.tasks.filter((t) => t.done).length, 0);
  return (
    <div className={`sk-ftg${collapsed ? " is-folded" : ""}`}>
      <button type="button" className="sk-ftg-head" aria-expanded={!collapsed} onClick={toggle}>
        <span className="sk-ftg-caret" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        <span className="sk-ftg-title">{card.title}</span>
        <span className="sk-ftg-meta">{tag} · {open ? `${open} open` : "all done"}{done ? ` · ${done} done` : ""}</span>
      </button>
      {collapsed ? null : lists.map(({ l, tasks }) => {
        const left = tasks.filter((t) => !t.done);
        const ordered = [...left, ...tasks.filter((t) => t.done)];
        return (
          <div key={l.id} className="sk-ftg-sub">
            <div className="sk-ftg-subhead">
              <span className="sk-ftg-subname">{l.name}</span>
              <span className="sk-ftg-subcount">{left.length ? `${left.length} open` : "done"}</span>
              {left.length ? <SendToDoing id={focusListId(code, card.id, l.id)} label={`${card.title} · ${l.name}`} lanes={lanes} /> : null}
            </div>
            <ul className="sk-ftg-list">
              {ordered.map((t) => (
                <li key={t.id} className={t.done ? "is-done" : ""}>
                  <button
                    type="button"
                    className={`sk-circle${t.done ? " is-on" : ""}`}
                    aria-pressed={t.done}
                    aria-label={`Mark ${t.text} ${t.done ? "not done" : "done"}`}
                    onClick={() => onToggle(l.id, t.id)}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <span className="sk-ftg-text">{t.text}</span>
                  {t.due ? <span className="sk-ftg-due">{new Date(`${t.due}T12:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> : null}
                  {t.done ? null : <SendToDoing id={focusTaskId(code, card.id, l.id, t.id)} label={t.text} lanes={lanes} />}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Self tab / Self site card: the tasks inside each Short-term focus card, grouped by card. Same records as the cards, so checking one here checks it there. */
export function FocusTaskBoard({ compact }: { compact?: boolean } = {}) {
  const [now, saveNow] = useFocusList("lifehub-focus-now2");
  const [weeks, saveWeeks] = useFocusList("lifehub-focus-weeks2");
  const [ongoing, saveOngoing] = useFocusList(ONGOING_KEY);
  const { lanes } = usePriorityPins();
  const groups: Array<{ card: Entry; code: string; tag: string; items: Entry[]; save: (e: Entry[]) => void }> = [
    ...now.map((card) => ({ card, code: "n", tag: "Right now", items: now, save: saveNow })),
    ...weeks.map((card) => ({ card, code: "w", tag: "Next few weeks", items: weeks, save: saveWeeks })),
    ...ongoing.filter((c) => c.inFocus).map((card) => ({ card, code: "o", tag: "Ongoing", items: ongoing, save: saveOngoing })),
  ].filter((g) => !g.card.done && (g.card.lists || []).some((l) => l.tasks.some((t) => !t.fin)));
  const openCount = groups.reduce((n, g) => n + (g.card.lists || []).reduce((m, l) => m + l.tasks.filter((t) => !t.fin && !t.done).length, 0), 0);
  return (
    <section className={`self-focus-tasks${compact ? " is-compact" : ""}`}>
      {compact ? (
        <p className="task-split-label">Focus tasks · {openCount}</p>
      ) : (
        <div className="ledger-heading">
          <div>
            <p className="section-label">Short-term focus</p>
            <h2>Focus tasks · {openCount}</h2>
          </div>
        </div>
      )}
      {groups.length ? (
        groups.map((g) => (
          <FocusTaskGroup
            key={g.card.id}
            card={g.card}
            code={g.code}
            tag={g.tag}
            lanes={lanes}
            onToggle={(listId, taskId) =>
              g.save(g.items.map((c) => (c.id !== g.card.id ? c : {
                ...c,
                lists: (c.lists || []).map((l) => (l.id !== listId ? l : { ...l, tasks: l.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) })),
              })))
            }
          />
        ))
      ) : (
        <p className="local-note">No tasks inside your Short-term focus cards yet. Add them on a card in Today → Short-term focus.</p>
      )}
    </section>
  );
}
