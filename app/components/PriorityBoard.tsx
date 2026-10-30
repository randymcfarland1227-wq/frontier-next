"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { tagTone } from "../../lib/tagTone";
import type { FeaturedItem, SourceId, SourceSnapshot } from "../../lib/types";
import { SOURCE_IDS, sourceById } from "../../lib/sources";
import {
  DECK,
  PLAN,
  OPEN_TASK_EVENT,
  arrangeDeck,
  deckSlotKey,
  openBefore,
  pinKey,
  placePin,
  setDeckSlot,
  unpin,
  usePriorityPins,
  type Lane,
} from "../../lib/priorityPins";
import {
  byLevel,
  criticalKeys,
  useFeaturedLevels,
} from "../../lib/featuredLevels";
import { SiteIcon } from "./SiteIcon";
import { PriorityPanel, type PriorityItem } from "./PriorityPanel";
import { DayMenu } from "./DayMenu";
import { MenuRow } from "./RowMenu";
import { countdown, fromDayKey, money, type BillDue } from "../../lib/schedule";
import { Circle, Dot, ListHead, Tag } from "../sticker/kit";
import { Icon } from "../sticker/Icon";

/** Self's stand-in detail for starred items with no note — not worth a subtext line. */
const FILLER_DETAIL = "Captured in Self inbox";

/** Every open task and featured item across the hub, by pin key — plus bills that are still owed. */
function buildCatalog(
  snapshots: Record<SourceId, SourceSnapshot>,
  bills: BillDue[] = [],
) {
  const catalog = new Map<string, PriorityItem>();
  // Bills pin as Finances items; checking one off marks that due date paid.
  for (const b of bills) {
    const key = pinKey("radall", b.key);
    const day = fromDayKey(b.due).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    catalog.set(key, {
      id: b.key,
      title: `Pay ${b.bill.name}`,
      detail: [
        money(b.bill.amount),
        `due ${day}`,
        countdown(b.days),
        b.editNote || "",
      ]
        .filter(Boolean)
        .join(" · "),
      meta: "Bill",
      originUrl: b.bill.payUrl,
      completable: true,
      tag: "Bills",
      source: "radall",
      key,
    });
  }
  for (const id of SOURCE_IDS) {
    const snap = snapshots[id];
    if (!snap) continue;
    for (const featured of snap.featured || []) {
      const key = pinKey(id, featured.id);
      catalog.set(key, {
        ...featured,
        detail: featured.detail === FILLER_DETAIL ? "" : featured.detail,
        source: id,
        key,
      });
    }
    for (const task of snap.tasks || []) {
      if (task.status === "done") continue;
      const key = pinKey(id, task.id);
      if (catalog.has(key)) continue;
      catalog.set(key, {
        id: task.id,
        title: task.title,
        detail: task.detail || "",
        meta: task.starred ? "Starred" : task.status || "Task",
        originUrl: task.originUrl,
        completable: true,
        tag: task.tag,
        steps: task.steps,
        source: id,
        key,
      });
    }
  }
  return catalog;
}

const DRAG_TYPE = "text/lifehub-pin";

/** "Sat, Oct 10" / "Today" / "Tomorrow" for a Priority day. */
function dueChip(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round(
    (date.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0)
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} (past)`;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Doing now", in two stages. **On deck**: everything pinned, starred-and-pinned or Critical,
 * grouped by site so you can see what's waiting where. **Action list**: what you've decided to do,
 * in the order you'll do it (drag or ▲▼ to reorder). Click any item for its side panel — the full
 * note from its site, your plan, and anything in the way / that has to happen first.
 */
export function PriorityBoard({
  snapshots,
  enter,
  onComplete,
  bills,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SourceId) => void;
  onComplete?: (source: SourceId, item: FeaturedItem) => void;
  /** Bills still owed — pinnable like tasks */
  bills?: BillDue[];
}) {
  const { lanes, pins } = usePriorityPins();
  const { levels, levelOf, cycle, setLevel, isCritical, toggleCritical } =
    useFeaturedLevels();
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) =>
      setOpenKey(String((e as CustomEvent).detail || "") || null);
    window.addEventListener(OPEN_TASK_EVENT, open);
    return () => window.removeEventListener(OPEN_TASK_EVENT, open);
  }, []);
  // Row whose 📅 day line is open
  const [dayFor, setDayFor] = useState<string | null>(null);

  const catalog = useMemo(
    () => buildCatalog(snapshots, bills),
    [snapshots, bills],
  );
  const criticals = useMemo(
    () => criticalKeys(levels).map(([s, id]) => pinKey(s, id)),
    [levels],
  );

  // Action list: your order. Items that aren't open anywhere any more drop out.
  const plan = useMemo(
    () =>
      pins
        .filter((k) => lanes[k]?.lane === PLAN)
        .map((k) => catalog.get(k))
        .filter((i): i is PriorityItem => Boolean(i)),
    [pins, lanes, catalog],
  );

  // On deck: one group per site; critical first, then red/yellow/green, then pin order.
  // Moved this visit but not locked: forgotten on refresh (back to auto sort).
  const [movedSlots, setMovedSlots] = useState<Record<string, number>>({});
  const autoGroups = useMemo(() => {
    const inPlan = new Set(plan.map((i) => i.key));
    const keys = [
      ...criticals.filter((k) => !pins.includes(k)),
      ...pins.filter((k) => lanes[k]?.lane !== PLAN),
    ];
    const bySite = new Map<SourceId, PriorityItem[]>();
    for (const key of keys) {
      const item = catalog.get(key);
      if (!item || inPlan.has(key)) continue;
      const list = bySite.get(item.source) || [];
      if (!list.some((i) => i.key === key)) list.push(item);
      bySite.set(item.source, list);
    }
    return [...bySite.entries()]
      .map(([source, items]) => ({
        source,
        items: byLevel(
          items,
          (i) => levelOf(i.source, i.id),
          (i) => isCritical(i.source, i.id),
        ),
        critical: items.some((i) => isCritical(i.source, i.id)),
      }))
      .sort(
        (a, b) =>
          Number(b.critical) - Number(a.critical) ||
          b.items.length - a.items.length,
      );
  }, [pins, lanes, plan, criticals, catalog, levelOf, isCritical]);
  const lockedSlots = useMemo(() => {
    const out: Record<string, { pos: number; at: string }> = {};
    for (const g of autoGroups) {
      const e = lanes[deckSlotKey(g.source)];
      if (e && !e.lane && e.order > 0)
        out[g.source] = { pos: e.order, at: e.at };
    }
    return out;
  }, [autoGroups, lanes]);
  const groups = useMemo(() => {
    const order = arrangeDeck(
      autoGroups.map((g) => g.source),
      lockedSlots,
      movedSlots,
    );
    return order.map((id) => autoGroups.find((g) => g.source === id)!);
  }, [autoGroups, lockedSlots, movedSlots]);
  const setPosition = (source: SourceId, pos: number) => {
    if (lockedSlots[source]) setDeckSlot(source, pos);
    else setMovedSlots((m) => ({ ...m, [source]: pos }));
  };
  const toggleLock = (source: SourceId, pos: number) => {
    if (lockedSlots[source]) {
      setDeckSlot(source, null);
      setMovedSlots((m) => ({ ...m, [source]: pos }));
    } else setDeckSlot(source, pos);
  };

  const deckCount = groups.reduce((n, g) => n + g.items.length, 0);
  const placed = new Set([
    ...plan.map((i) => i.key),
    ...groups.flatMap((g) => g.items.map((i) => i.key)),
  ]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? [...catalog.values()]
        .filter(
          (i) =>
            !placed.has(i.key) &&
            (i.title.toLowerCase().includes(q) ||
              sourceById[i.source].shortName.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : [];

  const finish = (item: PriorityItem) => {
    onComplete?.(item.source, item);
    unpin(item.key);
    if (isCritical(item.source, item.id)) toggleCritical(item.source, item.id);
  };
  const remove = (item: PriorityItem) => {
    unpin(item.key);
    if (isCritical(item.source, item.id)) toggleCritical(item.source, item.id);
  };
  const move = (item: PriorityItem, lane: Lane) => placePin(item.key, lane);
  const onDrop = (lane: Lane, before?: string) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData(DRAG_TYPE) || dragging;
    if (key && key !== before) placePin(key, lane, before);
    setDragging(null);
    setOver(null);
  };
  const dragProps = (item: PriorityItem, lane: Lane) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, item.key);
      e.dataTransfer.effectAllowed = "move" as const;
      setDragging(item.key);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      setOver(item.key);
    },
    onDrop: onDrop(lane, item.key),
  });

  const levelClass = (item: PriorityItem) =>
    `${dragging === item.key ? " is-dragging" : ""}${over === item.key ? " is-over" : ""}${isCritical(item.source, item.id) ? " is-critical" : ""}`;

  /** Title + one secondary line: level, site, type, waiting, steps and plan note — then the day or Critical on the right. */
  const rowBody = (item: PriorityItem, showSite: boolean) => {
    const entry = lanes[item.key];
    const blocked = openBefore(entry);
    const critical = isCritical(item.source, item.id);
    const level = levelOf(item.source, item.id);
    const subTotal = entry?.subs?.length || 0;
    const day = entry?.due ? dueChip(entry.due) : "";
    const hasSub = Boolean(
      level || showSite || item.tag || blocked || entry?.note || subTotal,
    );
    return (
      <>
        <button
          type="button"
          className="sk-rmain"
          onClick={() => setOpenKey(item.key)}
          title={[item.title, item.detail, entry?.note]
            .filter(Boolean)
            .join(" — ")}
        >
          <span className="sk-rt">{item.title}</span>
          {hasSub ? (
            <span className="sk-rs sk-facts">
              {level ? <Dot tone={level} hint={`Level: ${level}`} /> : null}
              {showSite ? (
                <span>{sourceById[item.source].shortName}</span>
              ) : null}
              {item.tag ? (
                <span
                  className={`sk-tag kind-${tagTone(item.tag)}`}
                  title={item.tag}
                >
                  {item.tag}
                </span>
              ) : null}
              {blocked ? (
                <span
                  className="sk-fact is-wait"
                  title={`Waiting on ${blocked} thing${blocked === 1 ? "" : "s"} first`}
                >
                  <Icon name="clock" size={12} />
                  Waiting · {blocked}
                </span>
              ) : null}
              {subTotal ? (
                <span className="sk-fact" title="Subtasks done">
                  <Icon name="steps" size={12} />
                  {entry!.subs!.filter((x) => x.done).length}/{subTotal}
                </span>
              ) : null}
              {entry?.note ? (
                <span
                  className="sk-fact"
                  title={entry.note}
                  aria-label="Has a plan note"
                >
                  <Icon name="pencil" size={12} />
                  Note
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
        <span className="sk-rv">
          {critical ? (
            <Tag tone="alert">Critical</Tag>
          ) : day ? (
            <Tag
              tone={
                day === "Today"
                  ? "needs"
                  : day.endsWith("(past)")
                    ? "alert"
                    : undefined
              }
            >
              {day}
            </Tag>
          ) : null}
        </span>
        <Icon name="chevron" className="sk-rchev" size={14} />
      </>
    );
  };

  const check = (item: PriorityItem) =>
    onComplete ? (
      <Circle onDone={() => finish(item)} label={`Done: ${item.title}`} />
    ) : (
      <span />
    );

  const openItem = openKey ? catalog.get(openKey) : undefined;
  const openLane: Lane | null = openKey
    ? ((lanes[openKey]?.lane as Lane | null) ??
      (criticals.includes(openKey) ? DECK : null))
    : null;

  return (
    <div className="sk-group tone-open sk-doing" aria-label="Doing now">
      <div className="sk-gbody">
        <div className="sk-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pull in a task from any site"
            aria-label="Find a task to add to Doing now"
          />
          {matches.length ? (
            <div className="sk-pop" role="listbox">
              {matches.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="sk-row"
                  onClick={() => {
                    placePin(m.key, DECK);
                    setQuery("");
                  }}
                >
                  <span className="sk-rlead">
                    <SiteIcon source={m.source} className="sk-siteicon" />
                  </span>
                  <span className="sk-rmain">
                    <span className="sk-rt">{m.title}</span>
                    <span className="sk-rs">
                      {sourceById[m.source].shortName}
                      {m.tag ? ` · ${m.tag}` : ""}
                    </span>
                  </span>
                  <span className="sk-link">
                    <Icon name="plus" size={14} />
                    Add
                  </span>
                  <span />
                </button>
              ))}
            </div>
          ) : q ? (
            <div className="sk-pop">
              <p className="sk-empty">No open task matches “{query.trim()}”.</p>
            </div>
          ) : null}
        </div>

        <div className="sk-doing-cols">
          <div
            className={`sk-col sk-plan${dragging && !plan.some((i) => i.key === dragging) ? " is-target" : ""}`}
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={onDrop(PLAN)}
          >
            <ListHead
              title="Action List"
              meta={
                plan.length
                  ? `${plan.length} in the order you'll do them`
                  : "In the order you’ll do it"
              }
            />
            {plan.length ? (
              <ol className="sk-list">
                {plan.map((item, i) => (
                  <MenuRow
                    as="li"
                    key={item.key}
                    title={item.title}
                    items={[
                      {
                        label: lanes[item.key]?.due
                          ? "Change day…"
                          : "Give it a day…",
                        onSelect: () => setDayFor(item.key),
                      },
                      {
                        label: "Back on deck",
                        onSelect: () => move(item, DECK),
                      },
                      {
                        label: "Take off the plan",
                        onSelect: () => remove(item),
                        danger: true,
                      },
                    ]}
                    className={`sk-row is-numbered${levelClass(item)}`}
                    dragProps={dragProps(item, PLAN)}
                  >
                    <span className="sk-num" aria-label={`Step ${i + 1}`}>
                      {i + 1}
                    </span>
                    <span className="sk-rlead">{check(item)}</span>
                    {rowBody(item, true)}
                    {dayFor === item.key ? (
                      <DayMenu
                        itemKey={item.key}
                        title={item.title}
                        onClose={() => setDayFor(null)}
                      />
                    ) : null}
                  </MenuRow>
                ))}
              </ol>
            ) : (
              <p className="sk-empty">
                Nothing on your list yet. Press and hold (or right-click) a task
                in On Deck and choose Add to action list, or drag it here.
              </p>
            )}
          </div>

          <div className="sk-col sk-deck">
            <ListHead
              title="On Deck"
              meta={
                deckCount
                  ? `${deckCount} waiting · press and hold a task for + List`
                  : undefined
              }
            />
            {groups.length ? (
              // Site columns that grow with the number of sites: 2 → 2 across, 3+ → 3 across.
              <div
                className="sk-deck-grid"
                style={
                  {
                    "--cols": Math.min(groups.length, 3),
                  } as React.CSSProperties
                }
              >
                {groups.map((group, gi) => {
                  const def = sourceById[group.source];
                  const isLocked = Boolean(lockedSlots[group.source]);
                  return (
                    <section
                      key={group.source}
                      className="sk-site"
                      data-site={group.source}
                      aria-label={def.name}
                    >
                      <div className="sk-srch">
                        <SiteIcon
                          source={group.source}
                          className="sk-siteicon"
                        />
                        <button
                          type="button"
                          className="sk-hl sk-srch-name"
                          onClick={() => enter(group.source)}
                          title={`Open ${def.name} page · ${group.items.length} on deck`}
                        >
                          {def.shortName}
                        </button>
                        <span className="sk-count">{group.items.length}</span>
                        <select
                          className="sk-pos"
                          value={gi + 1}
                          onChange={(e) =>
                            setPosition(group.source, Number(e.target.value))
                          }
                          aria-label={`Position of ${def.name}`}
                          title={
                            isLocked
                              ? "Position (locked)"
                              : "Position — lock it to keep it after a refresh"
                          }
                        >
                          {groups.map((_, i) => (
                            <option key={i} value={i + 1}>
                              {i + 1}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="sk-lock"
                          aria-pressed={isLocked}
                          onClick={() => toggleLock(group.source, gi + 1)}
                          aria-label={`${isLocked ? "Unlock" : "Lock"} ${def.name} at position ${gi + 1}`}
                          title={
                            isLocked
                              ? "Locked here — click to go back to auto sort"
                              : "Lock it at this position"
                          }
                        >
                          <Icon name={isLocked ? "lock" : "unlock"} size={14} />
                        </button>
                      </div>
                      <ul className="sk-list">
                        {group.items.map((item) => (
                          <MenuRow
                            as="li"
                            key={item.key}
                            title={item.title}
                            items={[
                              {
                                label: "Add to action list",
                                onSelect: () => move(item, PLAN),
                              },
                              {
                                label: lanes[item.key]?.due
                                  ? "Change day…"
                                  : "Give it a day…",
                                onSelect: () => setDayFor(item.key),
                              },
                              {
                                label: "Take off the plan",
                                onSelect: () => remove(item),
                                danger: true,
                              },
                            ]}
                            className={`sk-row${levelClass(item)}`}
                            dragProps={dragProps(item, DECK)}
                          >
                            <span className="sk-rlead">{check(item)}</span>
                            {rowBody(item, false)}
                            {dayFor === item.key ? (
                              <DayMenu
                                itemKey={item.key}
                                title={item.title}
                                onClose={() => setDayFor(null)}
                              />
                            ) : null}
                          </MenuRow>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="sk-empty">
                Nothing waiting. Pin items from any card, or search above.
              </p>
            )}
          </div>
        </div>
      </div>

      {openItem ? (
        <PriorityPanel
          item={openItem}
          entry={lanes[openItem.key]}
          lane={openLane}
          level={levelOf(openItem.source, openItem.id)}
          critical={isCritical(openItem.source, openItem.id)}
          onCycleLevel={() => cycle(openItem.source, openItem.id)}
          onSetLevel={(l) => setLevel(openItem.source, openItem.id, l)}
          onToggleCritical={() => toggleCritical(openItem.source, openItem.id)}
          onMove={(lane) => move(openItem, lane)}
          onDone={
            onComplete
              ? () => {
                  finish(openItem);
                  setOpenKey(null);
                }
              : undefined
          }
          onRemove={() => {
            remove(openItem);
            setOpenKey(null);
          }}
          enter={(id) => {
            setOpenKey(null);
            enter(id);
          }}
          close={() => setOpenKey(null)}
        />
      ) : null}
    </div>
  );
}
