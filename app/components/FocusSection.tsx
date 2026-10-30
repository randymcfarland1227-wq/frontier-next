"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Group, ListHead, Section } from "../sticker/kit";
import { Icon } from "../sticker/Icon";
import type { SourceId, SourceSnapshot, SpaceId } from "../../lib/types";
import { readSaved, writeSaved } from "../../lib/storage";
import { dayRecord, localDayKey, useDayKey } from "../../lib/dayKey";
import type { CompletionLedger } from "../../lib/completions";
import { tickTickToday } from "../../lib/tickTickToday";

type Snaps = Record<SourceId, SourceSnapshot>;

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

type Entry = {
  id: string;
  title: string;
  note?: string;
  done?: boolean;
  push?: number;
  /** Day (YYYY-MM-DD) it started — drives "Day 3 · started 2 days ago" */
  since?: string;
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
  const items = state.scope === scope ? state.items : [];
  const save = (next: Entry[]) => {
    const v = { scope, items: next };
    setState(v);
    writeSaved(storageKey, v);
  };
  return [items, save] as const;
}

/** A typed list: a title plus an optional note (folds to two lines, tap to open), circle to mark off, ✕ to remove. */
function FocusList({
  list: [items, save],
  label,
  noteLabel = "Details (optional)",
  empty,
  marks = true,
}: {
  list: ReturnType<typeof useFocusList>;
  label: string;
  noteLabel?: string;
  empty?: string;
  marks?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    save([
      ...items,
      {
        id: `${Date.now()}`,
        title: title.trim(),
        note: note.trim() || undefined,
      },
    ]);
    setTitle("");
    setNote("");
  };
  const live = items.filter((i) => !i.done);
  const finished = items.filter((i) => i.done);
  const row = (i: Entry) => (
    <div
      key={i.id}
      className={`sk-row sk-fc-row${marks ? "" : " is-plain"}${i.done ? " is-done" : ""}${open === i.id ? " is-open" : ""}`}
    >
      <span className="sk-rlead">
        {marks ? (
          <button
            type="button"
            className={`sk-circle${i.done ? " is-on" : ""}`}
            aria-pressed={!!i.done}
            aria-label={
              i.done ? `Mark ${i.title} not done` : `Mark ${i.title} done`
            }
            onClick={() =>
              save(
                items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)),
              )
            }
          >
            <Icon name="check" size={12} />
          </button>
        ) : null}
      </span>
      <button
        type="button"
        className="sk-rmain"
        aria-expanded={i.note ? open === i.id : undefined}
        onClick={() => setOpen(open === i.id ? null : i.id)}
      >
        <span className="sk-rt">{i.title}</span>
        {i.note ? <span className="sk-rs">{i.note}</span> : null}
      </button>
      <span className="sk-rv">
        <button
          type="button"
          className="sk-btn is-small is-icon is-quiet"
          aria-label={`Remove ${i.title}`}
          title="Remove"
          onClick={() => save(items.filter((x) => x.id !== i.id))}
        >
          <Icon name="close" size={14} />
        </button>
      </span>
      <span />
    </div>
  );
  return (
    <>
      {items.length ? (
        <div className="sk-list">
          {live.map(row)}
          {finished.map(row)}
        </div>
      ) : empty ? (
        <p className="sk-empty">{empty}</p>
      ) : null}
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
        {title.trim() ? (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteLabel}
            aria-label={noteLabel}
            rows={2}
            maxLength={400}
          />
        ) : null}
      </form>
    </>
  );
}

const FIT_AREAS = [
  "Abs",
  "Cardio",
  "Movement",
  "Strength",
  "Mobility",
  "Positioning",
  "Posture",
  "Legs",
  "Back",
  "Recovery",
];
const PUSH = ["", "Steady", "More", "All in"];

const daysSince = (day: string) =>
  Math.max(
    0,
    Math.round(
      (new Date(`${localDayKey()}T00:00:00`).getTime() -
        new Date(`${day}T00:00:00`).getTime()) /
        86400000,
    ),
  );
const startedText = (day: string) => {
  const n = daysSince(day);
  return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};

/** Fitness: tap an area to start pushing it, set how hard (1–3), add a note. */
function FitnessFocus() {
  const [state, setState] = useState(() =>
    readSaved<Entry[]>("lifehub-focus-fit-areas", []),
  );
  const save = (next: Entry[]) => {
    setState(next);
    writeSaved("lifehub-focus-fit-areas", next);
  };
  const [custom, setCustom] = useState("");
  const has = (t: string) =>
    state.some((i) => i.title.toLowerCase() === t.toLowerCase());
  const add = (t: string) =>
    t.trim() &&
    !has(t) &&
    save([
      ...state,
      {
        id: `fit-${t.trim().toLowerCase()}`,
        title: t.trim(),
        push: 2,
        since: localDayKey(),
      },
    ]);
  const extra = state.filter((i) => !FIT_AREAS.includes(i.title));
  return (
    <>
      <div className="sk-chips" role="group" aria-label="Areas I’m pushing">
        {[...FIT_AREAS, ...extra.map((i) => i.title)].map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={has(a)}
            onClick={() =>
              has(a) ? save(state.filter((i) => i.title !== a)) : add(a)
            }
          >
            {a}
          </button>
        ))}
      </div>
      <form
        className="sk-fc-add"
        onSubmit={(e) => {
          e.preventDefault();
          add(custom);
          setCustom("");
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="What are you pushing on? e.g. Learning new split"
          aria-label="What are you pushing on"
          maxLength={80}
        />
        <button
          type="submit"
          className="sk-btn is-small"
          disabled={!custom.trim()}
        >
          <Icon name="plus" size={14} />
          Add
        </button>
      </form>
      {state.length ? (
        <div className="sk-list sk-fit">
          {state.map((i) => (
            <div key={i.id} className="sk-row sk-fit-row">
              <span className="sk-rlead" />
              <span className="sk-rmain">
                <span className="sk-rt">{i.title}</span>
                <span className="sk-fit-when">
                  {i.since
                    ? `Day ${daysSince(i.since) + 1} · started ${startedText(i.since)}`
                    : "No start date yet"}
                  <input
                    type="date"
                    className="sk-fit-since"
                    value={i.since || ""}
                    max={localDayKey()}
                    aria-label={`${i.title} start date`}
                    title="Day it started"
                    onChange={(e) =>
                      save(
                        state.map((x) =>
                          x.id === i.id
                            ? { ...x, since: e.target.value || undefined }
                            : x,
                        ),
                      )
                    }
                  />
                </span>
              </span>
              <span
                className="sk-rv sk-push"
                role="group"
                aria-label={`${i.title} effort`}
              >
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n <= (i.push || 0) ? "is-on" : ""}
                    aria-label={`Push level ${n}: ${PUSH[n]}`}
                    aria-pressed={n === i.push}
                    onClick={() =>
                      save(
                        state.map((x) =>
                          x.id === i.id ? { ...x, push: n } : x,
                        ),
                      )
                    }
                  />
                ))}
                <span className="sk-push-label">{PUSH[i.push || 0]}</span>
              </span>
              <span>
                <button
                  type="button"
                  className="sk-btn is-small is-icon is-quiet"
                  aria-label={`Remove ${i.title}`}
                  title="Remove"
                  onClick={() => save(state.filter((x) => x.id !== i.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
              <input
                className="sk-fit-note"
                value={i.note || ""}
                placeholder="Note"
                aria-label={`${i.title} note`}
                maxLength={140}
                onChange={(e) =>
                  save(
                    state.map((x) =>
                      x.id === i.id ? { ...x, note: e.target.value } : x,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
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

/** Today's Marvel tasks and habits from TickTick, above the menu, each marked done or not. */
function MarvelToday({ tasks }: { tasks: { title: string; done: boolean }[] }) {
  if (!tasks.length) return null;
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="sk-mv-today">
      <p className="sk-cap">
        Marvel today · {done} of {tasks.length} done
      </p>
      <ul>
        {tasks.map((t) => (
          <li key={t.title} className={t.done ? "is-done" : ""}>
            <Icon name={t.done ? "check" : "minus"} size={13} />
            <span>{t.title}</span>
            <em>{t.done ? "done" : "not yet"}</em>
          </li>
        ))}
      </ul>
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
  const open = [...now[0], ...weeks[0]].filter((i) => !i.done).length;
  return { now, weeks, open };
}

export const shortTermSummary = (open: number) =>
  open ? `${count(open, "thing")} to focus on` : "Nothing typed in yet";

/** Today tab: what needs real attention right now and in the next few weeks (MD tickets paid, Marvel's DNA test…). */
export function ShortTermFocus({
  focus,
}: {
  focus: ReturnType<typeof useShortTermFocus>;
}) {
  return (
    <Group
      tone="focus"
      icon="target"
      title="Short-Term Focus"
      meta={focus.open || undefined}
    >
      <ListHead title="Right now" />
      <FocusList
        list={focus.now}
        label="What needs doing"
        noteLabel="The detail: what, why, next step"
        empty="Type what needs real attention right now."
      />
      <ListHead title="Next few weeks" />
      <FocusList
        list={focus.weeks}
        label="A short-term goal"
        noteLabel="What it takes"
      />
    </Group>
  );
}

export function FocusSection({
  snapshots,
  ledger,
  enter,
}: {
  snapshots?: Snaps;
  ledger?: CompletionLedger;
  enter: (id: SpaceId) => void;
}) {
  const day = useDayKey();
  const nut = useFocusList("lifehub-focus-nut2");
  const meals = useFocusList("lifehub-focus-meals2", true);
  const [water, setWater] = useDayState<number>("lifehub-focus-water", 0);
  const [picks, setPicks] = useDayState<MarvelPicks>(
    "lifehub-focus-marvel-pick",
    {},
  );
  const marvelDone = MARVEL_MENU.filter((g) => picks[g.id]?.done).length;
  const summary = `${water} of ${BOTTLES} bottles · Marvel ${marvelDone} of ${MARVEL_MENU.length}`;
  return (
    <Section id="focus" title="Focus" summary={summary}>
      <div className="sk-trio is-duo" data-day={day}>
        <Group
          tone="habit"
          icon="apple"
          title="Nutrition & Fitness"
          meta={`${water} of ${BOTTLES} bottles`}
        >
          <Water water={water} setWater={setWater} />
          <ListHead title="Nutrition focus" />
          <FocusList
            list={nut}
            label="e.g. more protein"
            noteLabel="How: 170 g, shake after the gym…"
            marks={false}
          />
          <ListHead title="Meals this week" />
          <FocusList
            list={meals}
            label="A meal I can make"
            noteLabel="What it uses"
          />
          <button
            type="button"
            className="sk-link sk-fc-log"
            onClick={() => enter("logs")}
          >
            Log in the tracker
            <Icon name="chevron" size={14} />
          </button>
          <ListHead title="Pushing on" />
          <FitnessFocus />
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
          <MarvelMenu st={picks} setSt={setPicks} />
        </Group>
      </div>
    </Section>
  );
}
