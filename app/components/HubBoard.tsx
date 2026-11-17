"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { SourceId, SourceSnapshot } from "../../lib/types";
import { addDays, eventStart, onDay, type BillDue, type CalEvent, type ScheduleSnapshot } from "../../lib/schedule";
import { isOverdue } from "../../lib/billEdits";
import { describe, useWeather } from "../../lib/weather";
import { sunTimes, towsonTime } from "../../lib/sun";
import { useBrief } from "./DailyBrief";
import type { Entry } from "./FocusSection";

/**
 * Today › Dashboard: the always-on second screen. A glanceable wall — clock, date, weather, light,
 * today's calendar and the week ahead, what needs you, bills coming up, focus and habits.
 * Read-only on purpose: taps open the tab that owns the thing.
 */

type Focus = { now: readonly [Entry[], unknown]; weeks: readonly [Entry[], unknown]; ongoing: readonly [Entry[], unknown] };

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
const ampm = (d: Date) => (d.getHours() < 12 ? "AM" : "PM");
const hm = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
const money = (n?: number) => (typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n % 1 ? 2 : 0 })}` : "");
const going = (e: CalEvent) => e.myStatus === "owner" || e.myStatus === "yes";
const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
};
const greet = (h: number) => (h < 5 ? "Goodnight" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Goodnight");

function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function Panel({ title, meta, onOpen, className = "", children }: { title: string; meta?: ReactNode; onOpen?: () => void; className?: string; children: ReactNode }) {
  return (
    <section className={`hb-panel ${className}`}>
      <header className="hb-head">
        {onOpen ? (
          <button type="button" className="hb-title" onClick={onOpen} title={`Open ${title}`}>
            {title} <span aria-hidden="true">›</span>
          </button>
        ) : (
          <h3 className="hb-title">{title}</h3>
        )}
        {meta ? <span className="hb-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Weather() {
  const { reading, state, retry } = useWeather();
  // Always-on screen: refresh the reading every 30 minutes.
  useEffect(() => {
    const t = window.setInterval(retry, 30 * 60 * 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!reading) {
    return (
      <button type="button" className="hb-wx is-off" onClick={retry}>
        {state === "denied" ? "Allow location for weather" : state === "loading" ? "Weather…" : "Weather unavailable · retry"}
      </button>
    );
  }
  const d = describe(reading.code, reading.day);
  return (
    <button type="button" className="hb-wx" onClick={retry} title="Tap to refresh the weather">
      <span className="hb-wx-icon" aria-hidden="true">{d.icon}</span>
      <span className="hb-wx-temp">{reading.temp}°</span>
      <span className="hb-wx-sub">
        <b>{d.label}</b>
        <small>H {reading.high}° · L {reading.low}°</small>
      </span>
    </button>
  );
}

export function HubBoard({
  snapshots,
  bills,
  schedule,
  focus,
  rings,
  openTab,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  schedule: ScheduleSnapshot | null;
  focus: Focus;
  rings: ReactNode;
  openTab: (t: "calendar" | "money" | "focus" | "brief" | "rhythm") => void;
}) {
  const now = useNow(1000);
  const sun = sunTimes(now);
  const brief = useBrief(snapshots, bills);
  const events = (schedule?.events || []).filter((e) => e.myStatus !== "no");

  // Today: timed events in order; all-day ones on top.
  const today = events.filter((e) => onDay(e, now)).sort((a, b) => +eventStart(a) - +eventStart(b));
  const allDay = today.filter((e) => e.allDay);
  const timed = today.filter((e) => !e.allDay);
  const endOf = (e: CalEvent) => new Date(e.end);
  const current = timed.find((e) => going(e) && eventStart(e) <= now && endOf(e) > now);
  const next = timed.find((e) => going(e) && eventStart(e) > now);

  // Next 6 days, grouped.
  const week = Array.from({ length: 6 }, (_, i) => {
    const day = addDays(now, i + 1);
    return { day, items: events.filter((e) => onDay(e, day)).sort((a, b) => +eventStart(a) - +eventStart(b)) };
  });

  // Bills: anything overdue, then the next 10 days.
  const due = bills
    .filter((b) => !b.skipped && b.bill.kind !== "plan" && (isOverdue(b) || (b.days >= 0 && b.days <= 10)))
    .sort((a, b) => a.due.localeCompare(b.due));
  const dueTotal = due.reduce((s, b) => s + (b.bill.amount || 0), 0);

  const needs = brief.filter((s) => s.rows.length && s.id !== "money");
  const focusNow = [...focus.now[0], ...focus.weeks[0], ...focus.ongoing[0].filter((i) => i.inFocus)].filter((i) => !i.done);

  const dayLeft = sun.set.getTime() - now.getTime();
  const lightNote =
    now < sun.rise ? `Sunrise ${until(sun.rise.getTime() - now.getTime())}` : dayLeft > 0 ? `${until(dayLeft).replace("in ", "")} of daylight left` : "Sun's down";

  const fullscreen = () => {
    const el = document.getElementById("sk-board");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div id="sk-board" className="hb">
      {/* Clock column */}
      <section className="hb-panel hb-clock">
        <div className="hb-greet">{greet(now.getHours())}, Randy</div>
        <div className="hb-time">
          {clock(now)}
          <span className="hb-ampm">{ampm(now)}</span>
          <span className="hb-sec">{String(now.getSeconds()).padStart(2, "0")}</span>
        </div>
        <div className="hb-date">
          <b>{now.toLocaleDateString([], { weekday: "long" })}</b>
          {now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}
        </div>
        <Weather />
        <div className="hb-sun">
          <span>☀︎ {towsonTime(sun.rise)}</span>
          <span className="hb-sun-bar" aria-hidden="true">
            <i
              style={{
                width: `${Math.min(100, Math.max(0, ((now.getTime() - sun.rise.getTime()) / (sun.set.getTime() - sun.rise.getTime())) * 100))}%`,
              }}
            />
          </span>
          <span>☾ {towsonTime(sun.set)}</span>
        </div>
        <div className="hb-sun-note">{lightNote}</div>
        <button type="button" className="hb-fs" onClick={fullscreen} title="Fill the whole screen (Esc to leave)">
          ⤢ Full screen
        </button>
      </section>

      {/* Today's calendar */}
      <Panel title="Today" meta={`${timed.filter(going).length} on the calendar`} onOpen={() => openTab("calendar")} className="hb-today">
        {current || next ? (
          <div className={`hb-next${current ? " is-now" : ""}`}>
            <small>{current ? "Happening now" : "Up next"}</small>
            <b>{(current || next)!.title}</b>
            <span>
              {current
                ? `until ${hm(endOf(current))}`
                : `${hm(eventStart(next!))} · ${until(eventStart(next!).getTime() - now.getTime())}`}
              {(current || next)!.location ? ` · ${(current || next)!.location}` : ""}
            </span>
          </div>
        ) : (
          <div className="hb-next is-free">
            <small>Up next</small>
            <b>Nothing else on the calendar today</b>
          </div>
        )}
        {allDay.length ? (
          <div className="hb-allday">
            {allDay.map((e) => (
              <span key={e.id} style={e.color ? { borderColor: e.color } : undefined}>{e.title}</span>
            ))}
          </div>
        ) : null}
        <ol className="hb-agenda">
          {timed.map((e) => {
            const past = endOf(e) <= now;
            return (
              <li key={e.id} className={`${past ? "is-past" : ""}${e === current ? " is-now" : ""}${going(e) ? "" : " is-maybe"}`}>
                <time>{hm(eventStart(e))}</time>
                <i style={e.color ? { background: e.color } : undefined} aria-hidden="true" />
                <span>
                  {e.title}
                  {going(e) ? null : <em> · {e.myStatus === "maybe" ? "maybe" : "invited"}</em>}
                </span>
              </li>
            );
          })}
          {!timed.length ? <li className="hb-empty">A clear day.</li> : null}
        </ol>
      </Panel>

      {/* Week ahead */}
      <Panel title="This week" onOpen={() => openTab("calendar")} className="hb-week">
        <div className="hb-days">
          {week.map(({ day, items }) => (
            <div key={day.toDateString()} className={`hb-day${items.length ? "" : " is-free"}`}>
              <div className="hb-day-h">
                <b>{day.toLocaleDateString([], { weekday: "short" })}</b>
                <span>{day.getDate()}</span>
              </div>
              {items.slice(0, 4).map((e) => (
                <div key={e.id} className={`hb-day-ev${going(e) ? "" : " is-maybe"}`}>
                  <time>{e.allDay ? "All day" : hm(eventStart(e))}</time> {e.title}
                </div>
              ))}
              {items.length > 4 ? <div className="hb-day-more">+{items.length - 4} more</div> : null}
              {!items.length ? <div className="hb-day-more">Free</div> : null}
            </div>
          ))}
        </div>
      </Panel>

      {/* Needs you */}
      <Panel title="Needs you" meta={needs.reduce((s, x) => s + x.rows.length, 0) || "All clear"} onOpen={() => openTab("brief")} className="hb-needs">
        {needs.length ? (
          needs.map((s) => (
            <div key={s.id} className="hb-group">
              <div className="hb-group-h">
                {s.label} <span>{s.rows.length}</span>
              </div>
              <ul>
                {s.rows.slice(0, 4).map((r) => (
                  <li key={r.id} className={r.tone === "late" ? "is-late" : r.tone === "today" ? "is-today" : ""}>
                    <span>{r.title}</span>
                    {r.note ? <small>{r.note}</small> : null}
                  </li>
                ))}
                {s.rows.length > 4 ? <li className="hb-more">+{s.rows.length - 4} more</li> : null}
              </ul>
            </div>
          ))
        ) : (
          <p className="hb-empty">Nothing waiting on you.</p>
        )}
      </Panel>

      {/* Bills */}
      <Panel title="Bills" meta={due.length ? `${money(dueTotal)} · next 10 days` : undefined} onOpen={() => openTab("money")} className="hb-bills">
        <ul className="hb-billlist">
          {due.slice(0, 8).map((b) => (
            <li key={b.key} className={isOverdue(b) ? "is-late" : b.days === 0 ? "is-today" : ""}>
              <span className="hb-when">
                {isOverdue(b) ? `${-b.days}d late` : b.days === 0 ? "Today" : b.days === 1 ? "Tomorrow" : new Date(`${b.due}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <span className="hb-name">{b.bill.name}</span>
              <b>{money(b.bill.amount)}</b>
            </li>
          ))}
          {due.length > 8 ? <li className="hb-more">+{due.length - 8} more</li> : null}
          {!due.length ? <li className="hb-empty">Nothing due in the next 10 days.</li> : null}
        </ul>
      </Panel>

      {/* Focus + habits */}
      <Panel title="Focus" meta={focusNow.length ? `${focusNow.length} open` : undefined} onOpen={() => openTab("focus")} className="hb-focus">
        <ul className="hb-focuslist">
          {focusNow.slice(0, 6).map((f) => (
            <li key={f.id}>{f.title}</li>
          ))}
          {!focusNow.length ? <li className="hb-empty">Nothing in focus.</li> : null}
        </ul>
      </Panel>
      <Panel title="Habits & tasks" onOpen={() => openTab("rhythm")} className="hb-rings">
        {rings}
      </Panel>
    </div>
  );
}
