"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../sticker/Icon";
import { dayKey, eventStart, fromDayKey } from "../../lib/schedule";
import type { Entry, SubList } from "./FocusSection";

/** Something on the calendar a focus can count down to: a Google event or a plan/event added on Life Hub. */
export type LinkItem = { id: string; title: string; start: string; allDay?: boolean };

type CardList = readonly [Entry[], (next: Entry[]) => void];

const DAY = 86400000;
const midnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysBetween = (a: Date, b: Date) =>
  Math.round((midnight(b) - midnight(a)) / DAY);
const shortDate = (d: Date) =>
  d.toLocaleDateString([], { month: "short", day: "numeric" });
const uid = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/** When it was added: the saved day, else the timestamp every id starts with. */
function addedOf(i: Entry): Date | null {
  if (i.added) return fromDayKey(i.added);
  const n = Number(i.id);
  if (n > 1e12) return new Date(n);
  return i.since ? fromDayKey(i.since) : null;
}

/** The date it's counting to: the linked calendar item (live, so it follows if the event moves), else a typed date. */
function targetOf(i: Entry, events: LinkItem[]) {
  const ev = i.eventId ? events.find((e) => e.id === i.eventId) : undefined;
  if (ev) return { date: eventStart(ev), title: ev.title };
  if (i.date) return { date: fromDayKey(i.date), title: i.eventTitle };
  return null;
}

function progressOf(i: Entry) {
  const all = (i.lists || []).flatMap((l) => l.tasks);
  if (!all.length)
    return { pct: i.done ? 100 : null, done: 0, total: 0 } as const;
  const done = all.filter((t) => t.done).length;
  return { pct: Math.round((done / all.length) * 100), done, total: all.length };
}

/** The middle of the footer: days until the linked date, or days since it was added. */
function whenOf(i: Entry, events: LinkItem[]) {
  const target = targetOf(i, events);
  if (target) {
    const n = daysBetween(new Date(), target.date);
    return {
      big: n === 0 ? "Today" : n === 1 ? "Tomorrow" : String(Math.abs(n)),
      cap: n > 1 ? "days till" : n < 0 ? (n === -1 ? "day ago" : "days ago") : "",
      date: shortDate(target.date),
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
      linked: false,
    };
  }
  return { big: "—", cap: "", date: "", linked: false };
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
  open,
}: {
  item: Entry;
  events: LinkItem[];
  open: () => void;
}) {
  const p = progressOf(item);
  const w = whenOf(item, events);
  const lists = (item.lists || []).slice(0, 3);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  return (
    <div
      className={`sk-fcard${item.done ? " is-done" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      aria-label={`${item.title} — open details`}
    >
      <h4 className="sk-fcard-t">{item.title}</h4>
      {item.note ? <p className="sk-fcard-scope">{item.note}</p> : null}
      {item.why ? (
        <p className="sk-fcard-why">
          <b>Why</b> {item.why}
        </p>
      ) : null}
      {lists.length ? (
        <div
          className="sk-fcard-lists"
          style={{ "--cols": lists.length } as React.CSSProperties}
        >
          {lists.map((l) => (
            <div key={l.id}>
              <b>{l.name}</b>
              <ul>
                {l.tasks
                  .filter((t) => !t.done)
                  .slice(0, 3)
                  .map((t) => (
                    <li key={t.id}>{t.text}</li>
                  ))}
                {l.tasks.every((t) => t.done) && l.tasks.length ? (
                  <li className="is-all">All done</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sk-fcard-foot">
        <span className="sk-fcard-pct">
          <Ring pct={p.pct} />
          <small>{p.total ? `${p.done}/${p.total}` : "done"}</small>
        </span>
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

/** The pop-out: the whole item, with room to layer sub-task lists under it. */
function Detail({
  item,
  events,
  update,
  remove,
  close,
}: {
  item: Entry;
  events: LinkItem[];
  update: (patch: Partial<Entry>) => void;
  remove: () => void;
  close: () => void;
}) {
  const [listName, setListName] = useState("");
  const [taskText, setTaskText] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) =>
      e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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

  const upcoming = events
    .filter((e) => {
      const n = daysBetween(new Date(), eventStart(e));
      return (n >= -1 && n <= 180) || e.id === item.eventId;
    })
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const target = targetOf(item, events);
  const w = whenOf(item, events);
  const p = progressOf(item);
  const added = addedOf(item);

  const host =
    document.querySelector(".sk-app") ||
    document.querySelector(".frontier-shell") ||
    document.body;
  return createPortal(
    <div
      className="sk-dialog-back sk-fdetail-back"
      role="presentation"
      onClick={close}
    >
      <div
        className="sk-dialog sk-fdetail"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sk-dialog-head">
          <input
            className="sk-fd-title"
            value={item.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={120}
            aria-label="Focus"
          />
          <button
            ref={closeRef}
            type="button"
            className="sk-btn is-small is-icon"
            onClick={close}
            aria-label="Close"
            title="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="sk-fd-stats">
          <span className="sk-fcard-pct">
            <Ring pct={p.pct} />
            <small>{p.total ? `${p.done} of ${p.total} sub-tasks` : "no sub-tasks yet"}</small>
          </span>
          <span className="sk-fcard-when">
            <b>{w.big}</b>
            {w.cap ? <small>{w.cap}</small> : null}
          </span>
          <span className="sk-fcard-date">
            {w.linked ? <Icon name="calendar" size={12} /> : null}
            {w.date}
          </span>
        </div>

        <label className="sk-fd-field">
          <span className="sk-cap">Scope — what it is</span>
          <textarea
            value={item.note || ""}
            onChange={(e) => update({ note: e.target.value || undefined })}
            rows={2}
            placeholder="e.g. People at our home for Savannah’s baby shower"
            maxLength={400}
          />
        </label>
        <label className="sk-fd-field">
          <span className="sk-cap">Why</span>
          <textarea
            value={item.why || ""}
            onChange={(e) => update({ why: e.target.value || undefined })}
            rows={2}
            placeholder="e.g. So we can do his dog DNA test"
            maxLength={400}
          />
        </label>

        <div className="sk-fd-field">
          <span className="sk-cap">Date (optional)</span>
          <div className="sk-fd-date">
            <select
              value={item.eventId || ""}
              aria-label="Link a calendar item"
              onChange={(e) => {
                const ev = events.find((x) => x.id === e.target.value);
                if (!ev)
                  update({
                    eventId: undefined,
                    eventTitle: undefined,
                  });
                else
                  update({
                    eventId: ev.id,
                    eventTitle: ev.title,
                    date: dayKey(eventStart(ev)),
                  });
              }}
            >
              <option value="">Not linked to a calendar item</option>
              {upcoming.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {shortDate(eventStart(e))}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Or pick a date"
              value={target ? dayKey(target.date) : ""}
              disabled={Boolean(item.eventId && target)}
              onChange={(e) =>
                update({
                  date: e.target.value || undefined,
                  eventId: undefined,
                  eventTitle: undefined,
                })
              }
            />
            {target ? (
              <button
                type="button"
                className="sk-btn is-small"
                onClick={() =>
                  update({
                    date: undefined,
                    eventId: undefined,
                    eventTitle: undefined,
                  })
                }
              >
                Unlink
              </button>
            ) : null}
          </div>
          {!target && added ? (
            <p className="sk-fd-hint">
              No date, so this counts days since it was added ({shortDate(added)}).
            </p>
          ) : null}
        </div>

        <div className="sk-fd-lists">
          {lists.map((l) => (
            <section key={l.id} className="sk-fd-list">
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
                  <li key={t.id} className={t.done ? "is-done" : ""}>
                    <button
                      type="button"
                      className={`sk-circle${t.done ? " is-on" : ""}`}
                      aria-pressed={t.done}
                      aria-label={`Mark ${t.text} ${t.done ? "not done" : "done"}`}
                      onClick={() =>
                        patchList(l.id, {
                          tasks: l.tasks.map((x) =>
                            x.id === t.id ? { ...x, done: !x.done } : x,
                          ),
                        })
                      }
                    >
                      <Icon name="check" size={12} />
                    </button>
                    <span>{t.text}</span>
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
                  placeholder="Add a sub-task"
                  aria-label={`Add a sub-task to ${l.name}`}
                  maxLength={160}
                />
                <button
                  type="submit"
                  className="sk-btn is-small"
                  disabled={!(taskText[l.id] || "").trim()}
                >
                  <Icon name="plus" size={14} />
                  Add
                </button>
              </form>
            </section>
          ))}
          <form className="sk-fd-newlist" onSubmit={addList}>
            <input
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="New list — e.g. Clean, Decorate, Source"
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

        <footer className="sk-fd-foot">
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
      </div>
    </div>,
    host,
  );
}

/** Short-term focus as cards: the square shows focus, scope, why and the lists; tap it for the full pop-out. */
export function FocusCards({
  list: [items, save],
  events,
  label,
  empty,
}: {
  list: CardList;
  events: LinkItem[];
  label: string;
  empty?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const update = (id: string, patch: Partial<Entry>) =>
    save(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const id = `${Date.now()}`;
    save([...items, { id, title: title.trim(), added: dayKey(new Date()) }]);
    setTitle("");
    setOpenId(id);
  };
  const ordered = [
    ...items.filter((i) => !i.done),
    ...items.filter((i) => i.done),
  ];
  const openItem = items.find((i) => i.id === openId);
  return (
    <>
      {ordered.length ? (
        <div className="sk-fcards">
          {ordered.map((i) => (
            <Card
              key={i.id}
              item={i}
              events={events}
              open={() => setOpenId(i.id)}
            />
          ))}
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
      </form>
      {openItem ? (
        <Detail
          item={openItem}
          events={events}
          update={(patch) => update(openItem.id, patch)}
          remove={() => save(items.filter((x) => x.id !== openItem.id))}
          close={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
