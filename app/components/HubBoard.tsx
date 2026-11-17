"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SourceId, SourceSnapshot, TaskItem } from "../../lib/types";
import type { CompletionLedger } from "../../lib/completions";
import { addDays, eventStart, onDay, type BillDue, type CalEvent, type ScheduleSnapshot } from "../../lib/schedule";
import { isOverdue } from "../../lib/billEdits";
import { describe, useWeather } from "../../lib/weather";
import { sunTimes, towsonTime } from "../../lib/sun";
import { loadCachedMoney, parseMoney } from "../../lib/money";
import { readSaved, writeSaved } from "../../lib/storage";
import { countdowns, useEventMarks } from "../../lib/events";
import { useDayKey } from "../../lib/dayKey";
import { useBrief } from "./DailyBrief";
import { useTickTickDay } from "./TickTickRings";
import { useFocusProgress, type LinkItem } from "./FocusCards";
import type { Entry } from "./FocusSection";
import { PackagesPanel } from "./PackagesPanel";

/**
 * Today › Dashboard: the always-on second screen. A living wall, not a list: a sky that follows the
 * time of day around a 24-hour dial, today's hours as a timeline with a moving now-line, rings for the
 * day's habits / tasks / water, money as bars, focus as progress bars. Panel titles open the owning tab.
 */

type List = readonly [Entry[], (next: Entry[]) => void];
type Focus = { now: List; weeks: List; ongoing: List };
type Tab = "calendar" | "money" | "focus" | "brief" | "rhythm" | "goals";

const H = 3600000;
const hm = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const going = (e: CalEvent) => e.myStatus === "owner" || e.myStatus === "yes";
const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;
const clamp = (n: number, a = 0, b = 100) => Math.min(b, Math.max(a, n));
const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
};
const greet = (h: number) => (h < 5 ? "Goodnight" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Goodnight");
const PALETTE = ["#7aa7ff", "#ff8fb1", "#7be0a6", "#f5b942", "#b48cff", "#5fd4e6"];
const colorOf = (e: CalEvent, i: number) => e.color || PALETTE[i % PALETTE.length];
const endH = (e: CalEvent) => {
  const d = new Date(e.end);
  return d.toDateString() !== eventStart(e).toDateString() ? 24 : hourOf(d);
};

function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/* ── drawing helpers ── */
const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(a), 150 + r * Math.sin(a)];
};
/** 24h dial: midnight at the bottom, noon at the top. */
const dialDeg = (h: number) => (h / 24) * 360 + 180;
const arc = (r: number, h0: number, h1: number) => {
  const a0 = dialDeg(h0);
  let a1 = dialDeg(h1);
  if (a1 <= a0) a1 += 360;
  if (a1 - a0 >= 359.9) a1 = a0 + 359.9;
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

function Ring({ pct, color, size = 92, stroke = 10, children }: { pct: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="hb-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="hb-ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamp(pct) / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="hb-ring-bar"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="hb-ring-in">{children}</div>
    </div>
  );
}

function Panel({ title, icon, accent, meta, onOpen, className = "", children }: { title: string; icon: string; accent: string; meta?: ReactNode; onOpen?: () => void; className?: string; children: ReactNode }) {
  return (
    <section className={`hb-panel ${className}`} style={{ "--acc": accent } as CSSProperties}>
      <header className="hb-head">
        <button type="button" className="hb-title" onClick={onOpen} title={`Open ${title}`}>
          <span className="hb-chip" aria-hidden="true">{icon}</span>
          {title}
        </button>
        {meta != null ? <span className="hb-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

/* ── Sky clock ── */
function SkyClock({ now, events }: { now: Date; events: CalEvent[] }) {
  const sun = sunTimes(now);
  const { reading, state, retry } = useWeather();
  useEffect(() => {
    const t = window.setInterval(retry, 30 * 60 * 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rise = hourOf(sun.rise);
  const set = hourOf(sun.set);
  const h = hourOf(now);
  const phase = h < rise - 1 || h > set + 1.2 ? "night" : h < rise + 1 ? "dawn" : h > set - 1 ? "dusk" : "day";
  const [nx, ny] = polar(128, dialDeg(h));
  const wx = reading ? describe(reading.code, reading.day) : null;
  const range = reading ? Math.max(1, reading.high - reading.low) : 1;
  const dayLeft = sun.set.getTime() - now.getTime();
  const lightNote =
    now < sun.rise
      ? `Sunrise in ${until(sun.rise.getTime() - now.getTime())}`
      : dayLeft > 0
        ? `${until(dayLeft)} of daylight left`
        : `Sunrise in ${until(sun.rise.getTime() + 24 * H - now.getTime())}`;
  const timed = events.filter((e) => !e.allDay);

  return (
    <section className="hb-panel hb-sky" data-phase={phase}>
      <div className="hb-stars" aria-hidden="true" />
      <div className="hb-sky-top">
        <span className="hb-greet">{greet(now.getHours())}, Randy</span>
        <span className="hb-phase">{phase === "night" ? "🌙 Night" : phase === "dawn" ? "🌅 Sunrise" : phase === "dusk" ? "🌇 Golden hour" : "☀️ Daytime"}</span>
      </div>
      <div className="hb-dial">
        <svg viewBox="0 0 300 300" aria-hidden="true">
          <circle cx="150" cy="150" r="128" className="hb-dial-night" />
          <path d={arc(128, rise, set)} className="hb-dial-day" />
          <path d={arc(128, 0, Math.max(0.05, h))} className="hb-dial-past" />
          {timed.map((e, i) => (
            <path key={e.id} d={arc(110, hourOf(eventStart(e)), Math.max(hourOf(eventStart(e)) + 0.25, endH(e)))} stroke={colorOf(e, i)} className="hb-dial-ev" />
          ))}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((t) => {
            const [x, y] = polar(146, dialDeg(t));
            const [x1, y1] = polar(139, dialDeg(t));
            const [lx, ly] = polar(94, dialDeg(t));
            return (
              <g key={t}>
                <line x1={x} y1={y} x2={x1} y2={y1} className="hb-dial-tick" />
                {t % 6 === 0 ? (
                  <text x={lx} y={ly} className="hb-dial-lbl">{t === 0 ? "12a" : t === 12 ? "12p" : t < 12 ? `${t}a` : `${t - 12}p`}</text>
                ) : null}
              </g>
            );
          })}
          <circle cx={nx} cy={ny} r="14" className="hb-dial-halo" />
          <circle cx={nx} cy={ny} r="7" className="hb-dial-now" />
        </svg>
        <div className="hb-dial-in">
          <div className="hb-time">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "")}
          </div>
          <div className="hb-ampm">
            {now.getHours() < 12 ? "AM" : "PM"} <span className="hb-sec">:{String(now.getSeconds()).padStart(2, "0")}</span>
          </div>
        </div>
      </div>
      <div className="hb-date">
        <b>{now.toLocaleDateString([], { weekday: "long" })}</b>
        <span>{now.toLocaleDateString([], { month: "long", day: "numeric" })}</span>
      </div>
      {reading && wx ? (
        <button type="button" className="hb-wx" onClick={retry} title="Tap to refresh the weather">
          <span className="hb-wx-icon" aria-hidden="true">{wx.icon}</span>
          <span className="hb-wx-temp">{reading.temp}°</span>
          <span className="hb-wx-sub">
            <b>{wx.label}</b>
            <span className="hb-wx-range">
              <small>{reading.low}°</small>
              <span className="hb-wx-bar">
                <i style={{ left: `${clamp(((reading.temp - reading.low) / range) * 100)}%` }} />
              </span>
              <small>{reading.high}°</small>
            </span>
          </span>
        </button>
      ) : (
        <button type="button" className="hb-wx is-off" onClick={retry}>
          ⛅ {state === "denied" ? "Allow location for weather" : state === "loading" ? "Getting the weather…" : "Weather unavailable · tap to retry"}
        </button>
      )}
      <div className="hb-sun">
        <span>🌅 {towsonTime(sun.rise)}</span>
        <span className="hb-sun-note">{lightNote}</span>
        <span>🌇 {towsonTime(sun.set)}</span>
      </div>
    </section>
  );
}

/* ── Pulse: habits / tasks / water (tap to log) ── */
function Pulse({ snapshots, ledger, onOpen, complete }: { snapshots: Record<SourceId, SourceSnapshot>; ledger: CompletionLedger; onOpen: () => void; complete: (t: TaskItem) => void }) {
  const day = useDayKey();
  const tt = useTickTickDay(ledger);
  const [show, setShow] = useState<"habits" | "tasks" | null>(null);
  const tasks = (snapshots.ticktick?.tasks || []) as TaskItem[];
  const isHabit = (t: TaskItem) => t.kind === "habit" || t.id.startsWith("habit-");
  const doneToday = new Set(Object.values(ledger.entries).filter((e) => e.source === "ticktick" && new Date(e.completedAt).toDateString() === new Date().toDateString()).map((e) => e.taskId));
  const habitsOpen = tasks.filter((t) => t.status !== "done" && isHabit(t) && !tt.offIds.has(t.id) && !doneToday.has(t.id));
  const tasksOpen = tasks.filter((t) => t.status !== "done" && !isHabit(t) && !doneToday.has(t.id));
  const hTotal = tt.habitsDone + tt.skippedHabits + habitsOpen.length;
  const tTotal = tt.tasksDone + tt.wontDoTasks + tasksOpen.length;
  const hPct = hTotal ? (tt.habitsDone / hTotal) * 100 : 0;
  const tPct = tTotal ? (tt.tasksDone / tTotal) * 100 : 0;
  const [water, setWaterState] = useState(() => {
    const w = readSaved<{ day: string; v: number } | null>("lifehub-focus-water", null);
    return w && w.day === day ? Number(w.v) || 0 : 0;
  });
  const setWater = (v: number) => {
    setWaterState(v);
    writeSaved("lifehub-focus-water", { day, v });
  };
  const wPct = (water / 5) * 100;
  const score = Math.round((hPct + tPct + wPct) / 3);
  const list = show === "habits" ? habitsOpen : show === "tasks" ? tasksOpen : [];
  const toggle = (k: "habits" | "tasks") => setShow(show === k ? null : k);
  return (
    <Panel title="Today's pulse" icon="💓" accent="#7be0a6" meta={`${score}% of the day done`} onOpen={onOpen} className="hb-pulse">
      <div className="hb-rings3">
        <button type="button" className={`hb-ringbtn${show === "habits" ? " is-on" : ""}`} onClick={() => toggle("habits")} title="Show today's habits to check off">
          <Ring pct={hPct} color="#7be0a6">
            <b>{Math.round(hPct)}%</b>
          </Ring>
          <span>Habits ▾</span>
          <small>
            {tt.habitsDone} of {hTotal}
          </small>
        </button>
        <button type="button" className={`hb-ringbtn${show === "tasks" ? " is-on" : ""}`} onClick={() => toggle("tasks")} title="Show open tasks to check off">
          <Ring pct={tPct} color="#b48cff">
            <b>{Math.round(tPct)}%</b>
          </Ring>
          <span>Tasks ▾</span>
          <small>
            {tt.tasksDone} of {tTotal}
          </small>
        </button>
        <div className="hb-ringbtn">
          <Ring pct={wPct} color="#5fd4e6">
            <b>{water}/5</b>
          </Ring>
          <span>Water</span>
          <span className="hb-bottles" role="group" aria-label="Bottles of water today">
            {Array.from({ length: 5 }, (_, i) => (
              <button
                key={i}
                type="button"
                className={i < water ? "is-full" : ""}
                onClick={() => setWater(water === i + 1 ? i : i + 1)}
                aria-label={`${i + 1} bottle${i ? "s" : ""}`}
                title={`Log ${i + 1} of 5`}
              />
            ))}
          </span>
        </div>
      </div>
      {show ? (
        <ul className="hb-checks">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" className="hb-check" onClick={() => complete(t)} aria-label={`Check off ${t.title}`} title="Check off (logs it in TickTick)">
                ✓
              </button>
              <span>{t.title}</span>
            </li>
          ))}
          {!list.length ? <li className="hb-allclear">All {show} done 🎉</li> : null}
        </ul>
      ) : (
        <div className="hb-score" title={`${score}% of today's habits, tasks and water`}>
          <span style={{ width: `${score}%` }} />
        </div>
      )}
    </Panel>
  );
}

/* ── Sites: open tasks per site ── */
function Sites({ sites, open }: { sites: Array<{ id: string; name: string; count: number }>; open: (id: string) => void }) {
  const max = Math.max(1, ...sites.map((s) => s.count));
  const total = sites.reduce((s, x) => s + x.count, 0);
  return (
    <Panel title="Open by site" icon="🧭" accent="#7aa7ff" meta={`${total} open`} className="hb-sites">
      <ul className="hb-sitelist">
        {sites.map((s, i) => (
          <li key={s.id}>
            <button type="button" onClick={() => open(s.id)} title={`Open ${s.name}`} style={{ "--c": PALETTE[i % PALETTE.length] } as CSSProperties}>
              <span className="hb-site-n">{s.name}</span>
              <span className="hb-site-bar">
                <i style={{ width: `${(s.count / max) * 100}%` }} />
              </span>
              <b className="hb-site-c">{s.count}</b>
            </button>
          </li>
        ))}
        {!sites.length ? <li className="hb-allclear">Nothing open anywhere 🎉</li> : null}
      </ul>
    </Panel>
  );
}

/* ── Countdowns ── */
function holidays(now: Date) {
  const y = now.getFullYear();
  const thanks = (yr: number) => {
    const d = new Date(yr, 10, 1);
    const first = (11 - d.getDay()) % 7; // first Thursday offset
    return new Date(yr, 10, 1 + first + 21);
  };
  const out: Array<{ title: string; date: Date; icon: string }> = [];
  for (const yr of [y, y + 1]) {
    out.push({ title: "Thanksgiving", date: thanks(yr), icon: "🦃" });
    out.push({ title: "Christmas", date: new Date(yr, 11, 25), icon: "🎄" });
    out.push({ title: "New Year's Day", date: new Date(yr, 0, 1), icon: "🎆" });
  }
  return out;
}
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function Countdowns({ now, onOpen }: { now: Date; onOpen: () => void }) {
  const marks = useEventMarks();
  const today = dayStart(now).getTime();
  const mine = countdowns(marks).map((c) => ({ key: c.id, title: c.title, date: new Date(`${c.date}T00:00:00`), icon: "⏳", from: new Date(c.at).getTime() }));
  const hol = holidays(now)
    .filter((h) => !mine.some((m) => m.title.toLowerCase().includes(h.title.toLowerCase().split(" ")[0])))
    .map((h) => ({ key: h.title + h.date.getFullYear(), title: h.title, date: h.date, icon: h.icon, from: 0 }));
  const items = [...mine, ...hol]
    .map((x) => ({ ...x, days: Math.round((dayStart(x.date).getTime() - today) / (24 * H)) }))
    .filter((x) => x.days >= 0 && (x.from || x.days <= 75))
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);
  return (
    <Panel title="Countdown" icon="⏳" accent="#ff8fb1" meta="⏳ any calendar event to add it" onOpen={onOpen} className="hb-count">
      <ul className="hb-cdlist">
        {items.map((x) => {
          const span = x.from ? Math.max(1, dayStart(x.date).getTime() - x.from) : 60 * 24 * H;
          const pct = clamp(100 - ((dayStart(x.date).getTime() - today) / span) * 100);
          return (
            <li key={x.key} className={x.days <= 7 ? "is-near" : x.days <= 21 ? "is-mid" : ""}>
              <Ring pct={pct} color={x.days <= 7 ? "#ff8fb1" : x.days <= 21 ? "#f5b942" : "#7aa7ff"} size={56} stroke={6}>
                <b className="hb-cd-n">{x.days === 0 ? "🎉" : x.days}</b>
              </Ring>
              <div>
                <b>
                  {x.icon} {x.title}
                </b>
                <small>
                  {x.days === 0 ? "Today!" : x.days === 1 ? "Tomorrow" : `${x.days} days`} · {x.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </small>
              </div>
            </li>
          );
        })}
        {!items.length ? <li className="hb-allclear">Tap ⏳ on any calendar event to count down to it.</li> : null}
      </ul>
    </Panel>
  );
}


type Prog = { pct: number | null; done: number; total: number; added: Date | null; target: { date: Date } | null };
function ProgressList({ items, now, empty }: { items: Array<{ e: Entry; p: Prog }>; now: Date; empty: string }) {
  return (
    <ul className="hb-flist">
      {items.slice(0, 6).map(({ e, p }) => {
        const days = p.target ? Math.ceil((p.target.date.getTime() - now.getTime()) / (24 * H)) : null;
        const inFocus = p.added ? Math.max(0, Math.floor((now.getTime() - p.added.getTime()) / (24 * H))) : null;
        return (
          <li key={e.id}>
            <div className="hb-f-row">
              <b>{e.title}</b>
              <span className={`hb-f-pct${p.pct == null ? " is-none" : ""}`}>{p.pct == null ? "—" : `${p.pct}%`}</span>
            </div>
            <div className="hb-f-bar">
              <i style={{ width: `${p.pct ?? 0}%` }} />
            </div>
            <div className="hb-f-meta">
              <span>{p.total ? `${p.done} of ${p.total} steps` : "No steps yet"}</span>
              {days != null ? (
                <span className={days < 0 ? "is-late" : days <= 3 ? "is-soon" : ""}>{days < 0 ? `${-days}d past` : days === 0 ? "Today" : `${days}d left`}</span>
              ) : inFocus != null ? (
                <span>{inFocus}d in</span>
              ) : null}
            </div>
          </li>
        );
      })}
      {items.length > 6 ? <li className="hb-allclear">+{items.length - 6} more</li> : null}
      {!items.length ? <li className="hb-allclear">{empty}</li> : null}
    </ul>
  );
}

const NEED_LOOK: Record<string, { icon: string; color: string }> = {
  tasks: { icon: "✅", color: "#b48cff" },
  mail: { icon: "✉️", color: "#7aa7ff" },
  roles: { icon: "💼", color: "#5fd4e6" },
  sales: { icon: "🏷️", color: "#7be0a6" },
  money: { icon: "💳", color: "#ff6b6b" },
};

function useCash() {
  return useMemo(() => {
    try {
      const snap = loadCachedMoney();
      const text = snap ? parseMoney(snap).cashOnHand?.text : undefined;
      const n = text ? Number(text.replace(/[^0-9.-]/g, "")) : NaN;
      return { text: text || null, n: Number.isFinite(n) ? n : null };
    } catch {
      return { text: null, n: null };
    }
  }, []);
}

export function HubBoard({
  snapshots,
  bills,
  schedule,
  focus,
  ledger,
  events: linkEvents,
  openTab,
  sites,
  openSite,
  completeTask,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  bills: BillDue[];
  schedule: ScheduleSnapshot | null;
  focus: Focus;
  ledger: CompletionLedger;
  events: LinkItem[];
  openTab: (t: Tab) => void;
  sites: Array<{ id: string; name: string; count: number }>;
  openSite: (id: string) => void;
  completeTask: (t: TaskItem) => void;
}) {
  const now = useNow(1000);
  const brief = useBrief(snapshots, bills);
  const cash = useCash();
  const progress = useFocusProgress([focus.now, focus.weeks, focus.ongoing], bills, linkEvents, ledger, snapshots.ticktick);
  const all = (schedule?.events || []).filter((e) => e.myStatus !== "no");
  const today = all.filter((e) => onDay(e, now)).sort((a, b) => +eventStart(a) - +eventStart(b));

  // Week: today + 6, with a load meter.
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(now, i);
    const items = all.filter((e) => onDay(e, day)).sort((a, b) => +eventStart(a) - +eventStart(b));
    return { day, items, i };
  });
  const maxLoad = Math.max(3, ...week.map((d) => d.items.length));

  // Money: late, this week, next week.
  const live = bills.filter((b) => !b.skipped && b.bill.kind !== "plan");
  const late = live.filter(isOverdue);
  const wk = live.filter((b) => !isOverdue(b) && b.days >= 0 && b.days <= 7);
  const nx = live.filter((b) => !isOverdue(b) && b.days > 7 && b.days <= 14);
  const sum = (l: BillDue[]) => l.reduce((s, b) => s + (b.bill.amount || 0), 0);
  const lateSum = sum(late);
  const wkSum = sum(wk);
  const nxSum = sum(nx);
  const total = lateSum + wkSum + nxSum || 1;
  const need = lateSum + wkSum;
  const cover = cash.n != null && need ? clamp((cash.n / need) * 100) : null;
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const l = live.filter((b) => !isOverdue(b) && b.days === i);
    return { i, amt: sum(l), n: l.length };
  });
  const maxDay = Math.max(lateSum, ...days14.map((d) => d.amt), 1);
  const biggest = [...late, ...wk].sort((a, b) => (b.bill.amount || 0) - (a.bill.amount || 0)).slice(0, 5);
  const maxBill = Math.max(1, ...biggest.map((b) => b.bill.amount || 0));

  // Focus with % done.
  const focusItems = [...focus.now[0], ...focus.weeks[0], ...focus.ongoing[0].filter((i) => i.inFocus)]
    .filter((i) => !i.done)
    .map((e) => ({ e, p: progress(e) }));
  const goalItems = focus.ongoing[0].filter((i) => !i.done).map((e) => ({ e, p: progress(e) }));
  const goalAvg = goalItems.length ? Math.round(goalItems.reduce((s, x) => s + (x.p.pct ?? 0), 0) / goalItems.length) : 0;
  const focusAvg = focusItems.length ? Math.round(focusItems.reduce((s, x) => s + (x.p.pct ?? 0), 0) / focusItems.length) : 0;

  const needs = brief.filter((s) => s.rows.length && s.id !== "money");
  const needTotal = needs.reduce((s, x) => s + x.rows.length, 0);

  const fullscreen = () => {
    const el = document.getElementById("sk-board");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div id="sk-board" className="hb">
      <SkyClock now={now} events={today} />
      <Sites sites={sites} open={openSite} />
      <Countdowns now={now} onOpen={() => openTab("calendar")} />
      <Pulse snapshots={snapshots} ledger={ledger} onOpen={() => openTab("rhythm")} complete={completeTask} />

      <Panel title="Needs you" icon="🔔" accent="#ff8fb1" meta={needTotal || "All clear"} onOpen={() => openTab("brief")} className="hb-needs">
        {needs.length ? (
          <div className="hb-tiles">
            {needs.map((s) => {
              const look = NEED_LOOK[s.id] || NEED_LOOK.tasks;
              const lateN = s.rows.filter((r) => r.tone === "late").length;
              return (
                <div key={s.id} className="hb-tile" style={{ "--c": look.color } as CSSProperties}>
                  <div className="hb-tile-top">
                    <span aria-hidden="true">{look.icon}</span>
                    <b>{s.rows.length}</b>
                  </div>
                  <div className="hb-tile-lbl">{s.label}</div>
                  <div className="hb-tile-first">{s.rows[0].title}</div>
                  {lateN ? <div className="hb-tile-late">{lateN} late</div> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hb-allclear">🎉 Nothing waiting on you.</p>
        )}
      </Panel>

      <PackagesPanel Panel={Panel} />

      <Panel title="Money" icon="💰" accent="#f5b942" meta={cash.text ? `${cash.text} on hand` : undefined} onOpen={() => openTab("money")} className="hb-money">
        <div className="hb-money-top">
          <div>
            <small>Late + due in 7 days</small>
            <b>{usd(need)}</b>
            <span>{late.length + wk.length} bills</span>
          </div>
          {cover != null ? (
            <Ring pct={cover} color={cover >= 100 ? "#7be0a6" : cover >= 50 ? "#f5b942" : "#ff6b6b"} size={80} stroke={9}>
              <b className="hb-ring-sm">{Math.round(cover)}%</b>
              <small>covered</small>
            </Ring>
          ) : null}
        </div>
        <div className="hb-stack" title="Late · this week · next week">
          <span className="is-late" style={{ width: `${(lateSum / total) * 100}%` }} />
          <span className="is-week" style={{ width: `${(wkSum / total) * 100}%` }} />
          <span className="is-next" style={{ width: `${(nxSum / total) * 100}%` }} />
        </div>
        <div className="hb-legend">
          <span className="is-late">Late {usd(lateSum)}</span>
          <span className="is-week">This week {usd(wkSum)}</span>
          <span className="is-next">Next week {usd(nxSum)}</span>
        </div>
        <div className="hb-bars14" aria-label="Bills by day, next two weeks">
          <div className="hb-bar14 is-late" title={`Late · ${usd(lateSum)}`}>
            <span style={{ height: `${(lateSum / maxDay) * 100}%` }} />
            <small>Late</small>
          </div>
          {days14.map((d) => (
            <div key={d.i} className={`hb-bar14${d.i === 0 ? " is-today" : ""}`} title={d.amt ? `${usd(d.amt)} · ${d.n} due` : "Nothing due"}>
              <span style={{ height: `${(d.amt / maxDay) * 100}%` }} />
              <small>{d.i === 0 ? "T" : addDays(now, d.i).toLocaleDateString([], { weekday: "narrow" })}</small>
            </div>
          ))}
        </div>
        <ul className="hb-biggest">
          {biggest.map((b) => (
            <li key={b.key} className={isOverdue(b) ? "is-late" : ""}>
              <span className="hb-bn">{b.bill.name}</span>
              <span className="hb-bb">
                <i style={{ width: `${((b.bill.amount || 0) / maxBill) * 100}%` }} />
              </span>
              <b>{usd(b.bill.amount || 0)}</b>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Short-term focus" icon="🎯" accent="#b48cff" meta={focusItems.length ? `${focusItems.length} open · ${focusAvg}% avg` : undefined} onOpen={() => openTab("focus")} className="hb-focus">
        <ProgressList items={focusItems} now={now} empty="Nothing in focus." />
      </Panel>

      <Panel title="Goals" icon="🏔️" accent="#7be0a6" meta={goalItems.length ? `${goalItems.length} ongoing · ${goalAvg}% avg` : undefined} onOpen={() => openTab("goals")} className="hb-goals">
        <ProgressList items={goalItems} now={now} empty="No ongoing goals yet." />
      </Panel>

      <Panel title="Next 7 days" icon="🗓️" accent="#5fd4e6" meta={`${week.reduce((s, d) => s + d.items.length, 0)} events`} onOpen={() => openTab("calendar")} className="hb-week">
        <div className="hb-days">
          {week.map(({ day, items, i }) => (
            <div key={i} className={`hb-day${i === 0 ? " is-today" : ""}${items.length ? "" : " is-free"}`}>
              <div className="hb-day-h">
                <small>{i === 0 ? "Today" : day.toLocaleDateString([], { weekday: "short" })}</small>
                <b>{day.getDate()}</b>
              </div>
              <div className="hb-load" title={`${items.length} events`}>
                <i style={{ width: `${(items.length / maxLoad) * 100}%` }} />
              </div>
              {items.slice(0, 3).map((e, k) => (
                <div key={e.id} className={`hb-day-ev${going(e) ? "" : " is-maybe"}`} style={{ "--c": colorOf(e, k) } as CSSProperties}>
                  <time>{e.allDay ? "All day" : hm(eventStart(e))}</time>
                  <span>{e.title}</span>
                </div>
              ))}
              {items.length > 3 ? <div className="hb-day-more">+{items.length - 3} more</div> : null}
              {!items.length ? <div className="hb-day-free">Free ✨</div> : null}
            </div>
          ))}
        </div>
      </Panel>

      <button type="button" className="hb-fs" onClick={fullscreen} title="Fill the whole screen (Esc to leave)">
        ⤢ Full screen
      </button>
    </div>
  );
}
