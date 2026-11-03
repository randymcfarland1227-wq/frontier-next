"use client";

import { useCallback, useEffect, useState } from "react";
import { Group, ListHead, Section } from "../sticker/kit";
import { FocusCards, type LinkItem, type OpenFinance } from "./FocusCards";
import type { BillDue } from "../../lib/schedule";
import { Icon } from "../sticker/Icon";
import type { SourceId, SourceSnapshot, SpaceId } from "../../lib/types";
import { readSaved, writeSaved } from "../../lib/storage";
import { FOCUS_LIST_EVENT, ONGOING_KEY } from "../../lib/ongoingGoals";
import { stampChanges } from "../../lib/focusSync";
import { dayRecord, localDayKey, useDayKey } from "../../lib/dayKey";
import type { CompletionLedger } from "../../lib/completions";
import { tickTickToday } from "../../lib/tickTickToday";
import type { FocusPriority } from "../../lib/focusPriority";
import { assignedFocusLists, type FocusSectionId } from "../../lib/focusRouting";

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
  /** A read-only Finance reference, rendered as one row in this list. */
  fin?: { key: string; label: string };
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
  /** An ongoing goal: a direction, not a one-time task (made from Self) */
  ongoing?: boolean;
  /** Finance lists linked in as sub-task lists (key says which debt-file items: see lib/finLinks) */
  fin?: Array<{ key: string; label: string }>;
};

const mondayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

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
  const items = state.scope === scope ? state.items : [];
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
  const open = [...now[0], ...weeks[0]].filter((i) => !i.done).length;
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
}: {
  focus: ReturnType<typeof useShortTermFocus>;
  events?: LinkItem[];
  bills?: BillDue[];
  openFinance?: OpenFinance;
}) {
  const [ongoingShut, toggleOngoing] = useShut("focus-ongoing");
  const ongoingCount = focus.ongoing[0].filter((i) => !i.done).length;
  return (
    <Group
      tone="focus"
      icon="target"
      title="Short-Term Focus"
      meta={focus.open || undefined}
    >
      <FocusCards
        list={focus.now}
        extra={[focus.weeks, focus.nutrition, focus.fitness, focus.marvel]}
        events={events}
        bills={bills}
        openFinance={openFinance}
        label="What needs real attention — type it, then fill in the rest"
        empty="Type what needs real attention right now."
      />
      {focus.ongoing[0].length ? (
        <>
          <ListHead
            title="Ongoing goals"
            meta={`${ongoingCount} · directions, not one-time tasks`}
            shut={ongoingShut}
            onToggle={toggleOngoing}
          />
          {ongoingShut ? null : (
            <FocusCards
              list={focus.ongoing}
              events={events}
              bills={bills}
              openFinance={openFinance}
              label=""
              noAdd
            />
          )}
        </>
      ) : null}
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
}: {
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
  const summary = `${water} of ${BOTTLES} bottles · Marvel ${marvelDone} of ${MARVEL_MENU.length}`;
  return (
    <Section id="focus" title="Daily Rhythm" summary={summary}>
      <div className="sk-trio is-duo" data-day={day}>
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
      </div>
    </Section>
  );
}
