"use client";

import { useEffect, useState } from "react";
import type { SourceId, SourceSnapshot, SpaceId } from "../../lib/types";
import type { CompletionLedger, CompletionStats } from "../../lib/completions";
import {
  eventEnd,
  eventStart,
  onDay,
  type BillDue,
  type CalEvent,
  type ScheduleSnapshot,
} from "../../lib/schedule";
import { briefParts, useBrief } from "../components/DailyBrief";
import { useTickTickDay } from "../components/TickTickRings";
import { reveal } from "./kit";
import { Icon, type IconName } from "./Icon";
import { sunTimes, towsonHours, towsonTime } from "../../lib/sun";

const DAY_START = 6;
const DAY_HOURS = 18;
const time = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const pct = (d: Date) =>
  Math.min(
    100,
    Math.max(
      0,
      ((d.getHours() + d.getMinutes() / 60 - DAY_START) / DAY_HOURS) * 100,
    ),
  );
/** 6 AM–noon morning, noon–6:30 PM afternoon, the rest night. */
const greeting = (d: Date) => {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= 6 && h < 12
    ? "Good Morning"
    : h >= 12 && h < 18.5
      ? "Good Afternoon"
      : "Goodnight";
};
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Re-render each minute so "now" and "in 18 min" stay true. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Readout({
  tone,
  icon,
  label,
  figure,
  of,
  note,
  meter,
  onPress,
  hint,
}: {
  tone: string;
  icon: IconName;
  label: string;
  figure: number;
  of?: string;
  note?: string;
  meter?: number;
  onPress: () => void;
  hint: string;
}) {
  return (
    <button
      type="button"
      className={`sk-ro tone-${tone}`}
      onClick={onPress}
      title={hint}
    >
      <span className="sk-ro-top">
        <span>
          <Icon name={icon} />
          {label}
        </span>
        <Icon name="chevron" className="sk-ro-chev" />
      </span>
      <b className="sk-figure">
        {figure.toLocaleString()}
        {of ? <small>{of}</small> : null}
      </b>
      {meter !== undefined ? (
        <span className="sk-meter" aria-hidden="true">
          <i style={{ width: `${Math.round(meter * 100)}%` }} />
        </span>
      ) : (
        <span className="sk-ro-note">{note}</span>
      )}
    </button>
  );
}

/** The day as a strip from 6 AM to midnight: what's past, where now is, and today's events. */
function DayRibbon({ events, now }: { events: CalEvent[]; now: Date }) {
  const timed = events
    .filter((e) => !e.allDay && e.start.length > 10)
    .sort((a, b) => a.start.localeCompare(b.start));
  const allDay = events.filter((e) => e.allDay || e.start.length <= 10);
  const next = timed.find((e) => eventStart(e) > now);
  const mins = next
    ? Math.round((eventStart(next).getTime() - now.getTime()) / 60000)
    : 0;
  const lastEnd = timed.length
    ? timed
        .map(eventEnd)
        .sort((a, b) => a.getTime() - b.getTime())
        .at(-1)!
    : null;
  const headline = next
    ? `Next: ${next.title} ${mins <= 60 ? `in ${mins} min` : `at ${time(eventStart(next))}`}`
    : "Nothing else on the calendar today";
  const side = [
    timed.length ? plural(timed.length, "event", "events") : "No timed events",
    lastEnd && lastEnd > now ? `free after ${time(lastEnd)}` : null,
    allDay.length ? `all day: ${allDay.map((e) => e.title).join(", ")}` : null,
  ].filter(Boolean);
  const nowPct = pct(now);
  const sun = sunTimes(now);
  const riseAt = Math.min(
    100,
    Math.max(0, ((towsonHours(sun.rise) - DAY_START) / DAY_HOURS) * 100),
  );
  const setAt = Math.min(
    100,
    Math.max(0, ((towsonHours(sun.set) - DAY_START) / DAY_HOURS) * 100),
  );
  return (
    <section
      className="sk-ribbon is-compact"
      aria-label="Today's timeline"
      title={side.join(" · ")}
    >
      <div className="sk-rib-top">
        <span className="sk-hl">{headline}</span>
        <span className="sk-sec">{side.join(" · ")}</span>
      </div>
      <div className="sk-track">
        <div
          className="sk-track-day"
          style={{
            left: `${riseAt}%`,
            width: `${Math.max(0, setAt - riseAt)}%`,
          }}
          aria-hidden="true"
        />
        <div className="sk-track-line" />
        <div className="sk-track-past" style={{ width: `${nowPct}%` }} />
        {timed.map((e) => (
          <div
            key={e.id}
            className={`sk-ev${eventEnd(e) < now ? " is-past" : ""}`}
            style={
              {
                left: `${pct(eventStart(e))}%`,
                "--sk-ev": e.color || "var(--sk-sched)",
              } as React.CSSProperties
            }
            title={`${time(eventStart(e))} ${e.title}`}
          >
            <i />
            <span>
              <time>{time(eventStart(e)).replace(/:00(?= )/, "")}</time>
              <span className="sk-ev-name">{e.title}</span>
            </span>
          </div>
        ))}
        <div
          className={`sk-now${nowPct < 8 ? " is-start" : nowPct > 92 ? " is-end" : ""}`}
          style={{ left: `${nowPct}%` }}
        >
          <span>Now {time(now)}</span>
        </div>
      </div>
      <div
        className="sk-sky"
        aria-label={`Towson sunrise ${towsonTime(sun.rise)}, sunset ${towsonTime(sun.set)}`}
      >
        <span
          className="sk-sun"
          style={{ left: `${riseAt}%` }}
          title="Sunrise in Towson, MD"
        >
          <Icon name="sun" />
          <small>{towsonTime(sun.rise)}</small>
        </span>
        <span
          className="sk-moon"
          style={{ left: `${setAt}%` }}
          title="Sunset in Towson, MD"
        >
          <Icon name="moon" />
          <small>{towsonTime(sun.set)}</small>
        </span>
      </div>
      <div className="sk-hours sk-cap" aria-hidden="true">
        <span>6 AM</span>
        <span>9</span>
        <span>Noon</span>
        <span>3 PM</span>
        <span>6</span>
        <span>9</span>
        <span>12 AM</span>
      </div>
    </section>
  );
}

/**
 * Home's top: the day as a Large Title with a one-sentence status, the one prominent action
 * (Update Today), four readout stickers that jump to where each number lives, and the day ribbon.
 */
export function HomeTop({
  snapshots,
  bills,
  stats,
  ledger,
  schedule,
  openTotal,
  openSites,
  unfinished,
  openFocus,
  enter,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  stats: CompletionStats;
  ledger: CompletionLedger;
  schedule: ScheduleSnapshot | null;
  openTotal: number;
  openSites: number;
  unfinished: number;
  openFocus: () => void;
  enter: (id: SpaceId) => void;
}) {
  const now = useNow();
  const brief = useBrief(snapshots, bills);
  const needs = brief.reduce((n, s) => n + s.rows.length, 0);
  const tt = snapshots.ticktick;
  const day = useTickTickDay(ledger);
  const openHabits = Number(tt?.metrics?.habits) || 0;
  const habitsLogged = day.habitsDone + day.skippedHabits;
  const habitsTotal = habitsLogged + openHabits;
  const overdue = Number(tt?.metrics?.overdue) || 0;
  const events = (schedule?.events || []).filter(
    (e) => (e.myStatus === "owner" || e.myStatus === "yes") && onDay(e, now),
  );
  const next = events
    .filter((e) => !e.allDay && e.start.length > 10 && eventStart(e) > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const date = now.toLocaleDateString([], { month: "long", day: "numeric" });
  const status = [
    needs
      ? `${plural(needs, "thing needs", "things need")} you.`
      : "Nothing needs a reply from you right now.",
    next ? `Next up: ${next.title} at ${time(eventStart(next))}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <header className="sk-top">
        <div>
          <p className="sk-greet">{greeting(now)} Randy</p>
          <h1 className="sk-large">
            <span>{weekday}</span>, {date}
          </h1>
          <p className="sk-status">{status}</p>
        </div>
        <DayRibbon events={events} now={now} />
        <button
          type="button"
          className="sk-btn is-prominent"
          onClick={openFocus}
          title="Today: what you said you'd do today"
        >
          <Icon name="sparkles" />
          Update Today
          {unfinished ? (
            <span className="sk-btn-count">{unfinished}</span>
          ) : null}
        </button>
      </header>

      <section className="sk-readouts" aria-label="Today at a glance">
        <Readout
          tone="needs"
          icon="bell"
          label="Needs You"
          figure={needs}
          note={briefParts(brief).slice(0, 2).join(" · ") || "All clear"}
          onPress={() => reveal("brief")}
          hint="Mail, role replies, sales and money waiting on you — opens the Daily Brief"
        />
        <Readout
          tone="done"
          icon="checks"
          label="Done Today"
          figure={stats.today}
          note={`${stats.last7} in 7 days · about ${Math.round(stats.last7 / 7)} a day`}
          onPress={() => reveal("review")}
          hint="Real completions recorded today, across every site — opens Review"
        />
        <Readout
          tone="open"
          icon="todo"
          label="Open"
          figure={openTotal}
          note={[
            `across ${plural(openSites, "site", "sites")}`,
            overdue ? `${overdue} overdue` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onPress={() => reveal("sites")}
          hint={`Open to-dos across every site (each card's number)${overdue ? `; ${overdue} of them overdue in TickTick` : ""} — opens the site rows`}
        />
        <Readout
          tone="habit"
          icon="repeat"
          label="Habits"
          figure={habitsLogged}
          of={`of ${habitsTotal}`}
          meter={habitsTotal ? habitsLogged / habitsTotal : 0}
          onPress={() => enter("ticktick")}
          hint={`TickTick habits today: ${day.habitsDone} done · ${day.skippedHabits} skipped · ${openHabits} still open — opens TickTick`}
        />
      </section>
    </>
  );
}
