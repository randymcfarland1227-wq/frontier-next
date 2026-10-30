"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  FeaturedItem,
  SourceDefinition,
  SourceId,
  SourceSnapshot,
  SpaceId,
  TaskItem,
} from "../../lib/types";
import { sourceById, isMusicTask, MUSIC_HUB_URL } from "../../lib/sources";
import { isConnectorSource } from "../../lib/connectors";
import { shownMetric } from "../../lib/actionable";
import { metricValue } from "../../lib/protocol";
import { openTaskPanel, pinKey, usePriorityPins } from "../../lib/priorityPins";
import { byLevel, useFeaturedLevels } from "../../lib/featuredLevels";
import { readSaved, writeSaved, STORAGE_KEYS } from "../../lib/storage";
import { tagTone } from "../../lib/tagTone";
import { setTaskTag, TAG_SUGGESTIONS, TAGGABLE } from "../../lib/taskTags";
import { setSelfHome } from "../../lib/adapters/self";
import { moveItem, removeItem } from "../../lib/siteMoves";
import { setRoleActive, shelfOf } from "../../lib/roleShelves";
import { DayMenu, shortDue } from "../components/DayMenu";
import { useRowGesture } from "../components/RowMenu";
import { SiteIcon } from "../components/SiteIcon";
import { Circle, FoldGroup, ListHead, Section, type Tone } from "./kit";
import { Icon, type IconName } from "./Icon";

/** The three site rows. Their fold keys (`section:row-…`) are the ones the classic rows saved. */
export const SITE_ROWS: {
  ids: SourceId[];
  title: string;
  tone: Tone;
  icon: IconName;
}[] = [
  {
    ids: ["ticktick", "radall", "self", "gmail", "outlook", "repair"],
    title: "Daily Ops",
    tone: "ops",
    icon: "grid",
  },
  {
    ids: ["role", "move"],
    title: "Role · Move",
    tone: "role",
    icon: "briefcase",
  },
  {
    ids: ["income", "resale", "candle"],
    title: "Ventures",
    tone: "vent",
    icon: "rocket",
  },
];

/** Rows per list before "N more". */
const PREVIEW = 6;
const STAR_PREVIEW = 4;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function isHabit(task: TaskItem) {
  return task.kind === "habit" || task.id.startsWith("habit-");
}

function todayKey() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Right-hand value: "2 days late" / "Today" / "Nov 2" / "Done". */
function whenOf(task: TaskItem): { text: string; late: boolean } {
  if (task.status === "done") return { text: "Done", late: false };
  if (!task.due) return { text: "", late: false };
  const due = task.due.slice(0, 10);
  const today = todayKey();
  if (due === today) return { text: "Today", late: false };
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (due < today) {
    const [ty, tm, td] = today.split("-").map(Number);
    const days = Math.round(
      (new Date(ty, tm - 1, td).getTime() - date.getTime()) / 86400000,
    );
    return { text: `${plural(days, "day")} late`, late: true };
  }
  return {
    text: date.toLocaleDateString([], { month: "short", day: "numeric" }),
    late: false,
  };
}

const isLate = (task: TaskItem) =>
  task.status !== "done" &&
  Boolean(task.due) &&
  task.due!.slice(0, 10) < todayKey();

/** "● live · 9:12 PM" when fresh, otherwise "synced Sep 25, 4:22 AM". */
function syncText(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (Date.now() - d.getTime() < 20 * 60 * 1000) return `● live · ${time}`;
  return `synced ${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function MusicLink() {
  return (
    <a
      className="sk-ricon"
      href={MUSIC_HUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Open Music Hub"
      aria-label="Open Music Hub"
    >
      <Icon name="music" size={14} />
    </a>
  );
}

/** One open task: circle = done, title opens the task panel, right-click / long-press opens the day menu. */
function TaskRow({
  sourceId,
  task,
  starred,
  showHabit,
  due,
  menuOpen,
  setMenu,
  onComplete,
  onStar,
}: {
  sourceId: SourceId;
  task: TaskItem;
  starred: boolean;
  showHabit: boolean;
  due?: string;
  menuOpen: boolean;
  setMenu: (id: string | null) => void;
  onComplete?: (task: TaskItem) => void;
  onStar?: (task: TaskItem) => void;
}) {
  const key = pinKey(sourceId, task.id);
  // Self keeps a star button; everywhere else right-click / long-press opens the star + day menu.
  const dayMenus = sourceId !== "self";
  const bind = useRowGesture(() =>
    dayMenus && onStar ? setMenu(task.id) : undefined,
  );
  const when = whenOf(task);
  const habit = showHabit && isHabit(task);
  // Side-by-side columns are narrow: the due text joins the subtitle instead of the right edge.
  const narrow = !showHabit;
  const facts = starred || habit || task.tag || due || (narrow && when.text);
  return (
    <div
      className={`sk-row${task.status === "done" ? " is-done" : ""}`}
      {...bind}
    >
      <span className="sk-rlead">
        {onComplete && task.status !== "done" ? (
          <Circle
            onDone={() => onComplete(task)}
            label={`Done: ${task.title}`}
          />
        ) : null}
      </span>
      <button
        type="button"
        className="sk-rmain"
        onClick={() => openTaskPanel(key)}
        title={[
          task.title,
          when.text,
          task.detail,
          "Open details, subtasks and plan",
        ]
          .filter(Boolean)
          .join(" — ")}
      >
        <span className="sk-rt">{task.title}</span>
        {facts ? (
          <span className="sk-rs sk-facts">
            {starred ? (
              <span
                className="sk-fact sk-starred"
                title="Starred"
                aria-label="Starred"
              >
                <Icon name="star" size={12} />
              </span>
            ) : null}
            {narrow && when.text ? (
              <span className={when.late ? "sk-fact is-wait" : "sk-fact"}>
                {when.text}
              </span>
            ) : null}
            {habit ? <span className="sk-fact">Habit</span> : null}
            {task.tag ? (
              <span className={`sk-tag kind-${tagTone(task.tag)}`}>
                {task.tag}
              </span>
            ) : null}
            {due ? (
              <span className="sk-fact" title="Day you gave it">
                <Icon name="calendar" size={12} />
                {shortDue(due)}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <span className={`sk-rv sk-rvs${when.late && !narrow ? " is-late" : ""}`}>
        {isMusicTask(task.title) ? <MusicLink /> : null}
        {onStar && !dayMenus ? (
          <button
            type="button"
            className="sk-ricon"
            aria-pressed={Boolean(task.starred)}
            onClick={() => onStar(task)}
            aria-label={`Star: ${task.title}`}
            title="Toggle star"
          >
            <Icon name="star" size={14} />
          </button>
        ) : null}
        {narrow ? null : when.text}
      </span>
      <Icon name="chevron" className="sk-rchev" size={14} />
      {menuOpen && onStar ? (
        <DayMenu
          itemKey={key}
          title={task.title}
          toggle={{
            label: task.starred ? "★ Starred" : "☆ Star",
            on: Boolean(task.starred),
            onClick: () => onStar(task),
          }}
          tag={
            TAGGABLE.includes(sourceId)
              ? {
                  value: task.tag || "",
                  suggestions: TAG_SUGGESTIONS[sourceId] || [],
                  onChange: (t) => setTaskTag(sourceId, task.id, t),
                }
              : undefined
          }
          backToSelf={
            task.id.startsWith("self:")
              ? () => setSelfHome(task.id.slice(5), undefined)
              : undefined
          }
          move={
            sourceId !== "self"
              ? { from: sourceId, onMove: (to) => moveItem(sourceId, task, to) }
              : undefined
          }
          onRemove={
            sourceId !== "self"
              ? () => removeItem(sourceId, task.id)
              : undefined
          }
          shelf={
            shelfOf(task.id)
              ? {
                  label: shelfOf(task.id)!.one,
                  onClick: () => setRoleActive(task.id, false),
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** A site's open tasks (TickTick: Tasks | Habits side by side). Same rules as the classic TaskList card view. */
function SiteTasks({
  sourceId,
  snapshot,
  onComplete,
  onStar,
  split,
  exclude,
  starred,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  onComplete?: (task: TaskItem) => void;
  onStar?: (task: TaskItem) => void;
  split?: boolean;
  exclude?: Set<string>;
  starred?: Set<string>;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { lanes } = usePriorityPins();

  const openTasks = snapshot.tasks.filter(
    (t) => t.status !== "done" && !exclude?.has(t.id),
  );
  const starFirst = (list: TaskItem[]) =>
    starred?.size
      ? [
          ...list.filter((t) => starred.has(t.id)),
          ...list.filter((t) => !starred.has(t.id)),
        ]
      : list;
  const habits = starFirst(openTasks.filter(isHabit));
  const tasks = starFirst(openTasks.filter((t) => !isHabit(t)));
  const allOpen = snapshot.tasks.filter((t) => t.status !== "done");
  const taskTotal = allOpen.filter((t) => !isHabit(t)).length;
  const habitTotal = allOpen.filter(isHabit).length;
  const starredNote = (shown: number, total: number) =>
    total > shown ? ` · ${total - shown} in Starred above` : "";
  const done = snapshot.tasks.filter((t) => t.status === "done");

  const visible = useMemo(
    () =>
      showAll
        ? [...tasks, ...habits, ...done]
        : [...tasks, ...habits].slice(0, PREVIEW),
    [showAll, tasks, habits, done],
  );
  const habitHidden = Math.max(
    0,
    habits.length - (showAll ? habits.length : Math.min(habits.length, 8)),
  );
  const moreCount = split
    ? Math.max(0, tasks.length - PREVIEW, habits.length - PREVIEW)
    : Math.max(Math.max(0, openTasks.length - PREVIEW), habitHidden);

  const row = (task: TaskItem) => {
    const key = pinKey(sourceId, task.id);
    return (
      <TaskRow
        key={task.id}
        sourceId={sourceId}
        task={task}
        starred={Boolean(starred?.has(task.id))}
        showHabit={!split}
        due={lanes[key]?.lane ? lanes[key]?.due : undefined}
        menuOpen={menuFor === task.id}
        setMenu={setMenuFor}
        onComplete={onComplete}
        onStar={onStar}
      />
    );
  };

  const more =
    moreCount > 0 ? (
      <button
        type="button"
        className="sk-link sk-more"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll ? "Show less" : `${moreCount} more`}
        <Icon name={showAll ? "chevronDown" : "chevron"} />
      </button>
    ) : null;

  if (split) {
    return (
      <>
        <div
          className="sk-cols sk-src-split"
          style={{ "--cols": 2 } as CSSProperties}
        >
          <div className="sk-col">
            <ListHead
              title="Tasks"
              meta={`${taskTotal}${starredNote(tasks.length, taskTotal)}`}
            />
            {tasks.length ? (
              (showAll ? tasks : tasks.slice(0, PREVIEW)).map(row)
            ) : (
              <p className="sk-empty">
                {taskTotal ? "All in Starred above." : "No tasks due."}
              </p>
            )}
          </div>
          <div className="sk-col">
            <ListHead
              title="Habits"
              meta={`${habitTotal}${starredNote(habits.length, habitTotal)}`}
            />
            {habits.length ? (
              (showAll ? habits : habits.slice(0, PREVIEW)).map(row)
            ) : (
              <p className="sk-empty">
                {habitTotal ? "All in Starred above." : "No habits left today."}
              </p>
            )}
          </div>
        </div>
        {more}
      </>
    );
  }
  return (
    <>
      {visible.length ? (
        visible.map(row)
      ) : // Everything open is already in Starred above — say nothing rather than "nothing open".
      exclude?.size && allOpen.length ? null : (
        <p className="sk-empty">Nothing open right now.</p>
      )}
      {more}
    </>
  );
}

/** A starred item: circle = done, level dot cycles, right-click / long-press opens pin + day menu. */
function StarredRow({
  sourceId,
  item,
  compactMeta,
  onComplete,
}: {
  sourceId: SourceId;
  item: FeaturedItem;
  compactMeta: boolean;
  onComplete?: (item: FeaturedItem) => void;
}) {
  const [menu, setMenu] = useState(false);
  const { levelOf, cycle, isCritical, toggleCritical } = useFeaturedLevels();
  const { addPin, removePin, isPinned, lanes } = usePriorityPins();
  const bind = useRowGesture(() => setMenu(true));
  const key = pinKey(sourceId, item.id);
  const pinned = isPinned(sourceId, item.id);
  const critical = isCritical(sourceId, item.id);
  const level = levelOf(sourceId, item.id);
  const due = lanes[key]?.lane ? lanes[key]?.due : undefined;
  const meta = item.meta
    ? compactMeta
      ? item.meta.replace(/^From /, "")
      : item.meta
    : "";
  return (
    <div className={`sk-row${critical ? " is-critical" : ""}`} {...bind}>
      <span className="sk-rlead">
        {onComplete ? (
          <Circle
            onDone={() => onComplete(item)}
            label={`Done: ${item.title}`}
          />
        ) : null}
      </span>
      <button
        type="button"
        className="sk-rmain"
        onClick={() => openTaskPanel(key)}
        title={[
          item.title,
          item.detail,
          item.meta,
          "Open details, subtasks and plan",
        ]
          .filter(Boolean)
          .join(" — ")}
      >
        <span className="sk-rt">{item.title}</span>
        {item.tag || due || meta || pinned ? (
          <span className="sk-rs sk-facts">
            {pinned ? (
              <span className="sk-fact" title="On your Priority list">
                <Icon name="pin" size={12} />
                Pinned
              </span>
            ) : null}
            {item.tag ? (
              <span className={`sk-tag kind-${tagTone(item.tag)}`}>
                {item.tag}
              </span>
            ) : null}
            {due ? (
              <span className="sk-fact" title="Day you gave it">
                <Icon name="calendar" size={12} />
                {shortDue(due)}
              </span>
            ) : null}
            {meta ? <span>{meta}</span> : null}
          </span>
        ) : null}
      </button>
      <span className="sk-rv sk-rvs">
        {isMusicTask(item.title) ? <MusicLink /> : null}
        {critical ? (
          <button
            type="button"
            className="sk-tag tone-alert sk-tagbtn"
            onClick={() => toggleCritical(sourceId, item.id)}
            title="Critical — tap to clear"
            aria-label={`Clear Critical: ${item.title}`}
          >
            Critical
          </button>
        ) : null}
        <button
          type="button"
          className="sk-ricon"
          onClick={() => cycle(sourceId, item.id)}
          aria-label={`Level ${level || "not set"} — change: ${item.title}`}
          title={`Level: ${level || "not set"} · tap to change`}
        >
          <span className={`sk-dot ${level ? `tone-${level}` : "is-none"}`} />
        </button>
      </span>
      <Icon name="chevron" className="sk-rchev" size={14} />
      {menu ? (
        <DayMenu
          itemKey={key}
          title={item.title}
          toggle={{
            label: pinned ? "◎ Pinned" : "◎ Pin to Priority",
            on: pinned,
            onClick: () =>
              pinned ? removePin(sourceId, item.id) : addPin(sourceId, item.id),
          }}
          tag={
            TAGGABLE.includes(sourceId)
              ? {
                  value: item.tag || "",
                  suggestions: TAG_SUGGESTIONS[sourceId] || [],
                  onChange: (t) => setTaskTag(sourceId, item.id, t),
                }
              : undefined
          }
          backToSelf={
            item.id.startsWith("self:")
              ? () => setSelfHome(item.id.slice(5), undefined)
              : undefined
          }
          critical={{
            on: critical,
            onClick: () => toggleCritical(sourceId, item.id),
          }}
          move={
            sourceId !== "self"
              ? { from: sourceId, onMove: (to) => moveItem(sourceId, item, to) }
              : undefined
          }
          onRemove={
            sourceId !== "self"
              ? () => removeItem(sourceId, item.id)
              : undefined
          }
          shelf={
            shelfOf(item.id)
              ? {
                  label: shelfOf(item.id)!.one,
                  onClick: () => setRoleActive(item.id, false),
                }
              : undefined
          }
          onClose={() => setMenu(false)}
        />
      ) : null}
    </div>
  );
}

/** The site's starred list: folds to its heading (remembered per site), critical then red / yellow / green first. */
function SiteStarred({
  sourceId,
  snapshot,
  onComplete,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  onComplete?: (item: FeaturedItem) => void;
}) {
  const copy = sourceById[sourceId];
  const { levelOf, isCritical } = useFeaturedLevels();
  const sorted = byLevel(
    snapshot.featured,
    (f) => levelOf(sourceId, f.id),
    (f) => isCritical(sourceId, f.id),
  );
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? sorted : sorted.slice(0, STAR_PREVIEW);
  const [folded, setFolded] = useState(() =>
    readSaved<string[]>(STORAGE_KEYS.collapsedFeatured, []).includes(sourceId),
  );
  const toggleFolded = () => {
    const next = !folded;
    const saved = readSaved<string[]>(
      STORAGE_KEYS.collapsedFeatured,
      [],
    ).filter((id) => id !== sourceId);
    writeSaved(
      STORAGE_KEYS.collapsedFeatured,
      next ? [...saved, sourceId] : saved,
    );
    setFolded(next);
  };
  return (
    <div className="sk-src-starred">
      <button
        type="button"
        className={`sk-listh sk-starh${folded ? "" : " is-open"}`}
        aria-expanded={!folded}
        onClick={toggleFolded}
        title={folded ? "Show starred items" : "Collapse starred items"}
      >
        <span className="sk-hl">
          <Icon name="star" size={14} />
          {copy.feature}
        </span>
        <span className="sk-sec">{snapshot.featured.length}</span>
        <Icon name="chevronDown" className="sk-fchev" size={14} />
      </button>
      {folded ? null : items.length ? (
        items.map((item) => (
          <StarredRow
            key={item.id}
            sourceId={sourceId}
            item={item}
            compactMeta
            onComplete={onComplete}
          />
        ))
      ) : (
        <p className="sk-empty">
          {copy.placeholder || snapshot.refreshedAt
            ? copy.empty
            : "Connecting to the source…"}
        </p>
      )}
      {!folded && snapshot.featured.length > STAR_PREVIEW ? (
        <button
          type="button"
          className="sk-link sk-more"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? "Show fewer"
            : `${snapshot.featured.length - STAR_PREVIEW} more starred`}
          <Icon name={showAll ? "chevronDown" : "chevron"} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Lists kept apart from a site's open tasks (Role Hub: Certs to get, Portfolio to add; Resale:
 * Decisions to make, Waiting on offers). Active moves a Role one into the open tasks.
 */
function SiteShelves({ snapshot }: { snapshot: SourceSnapshot }) {
  const shelves = (snapshot.shelves || []).filter((s) => s.items.length);
  if (!shelves.length) return null;
  return (
    <>
      {shelves.map((s) => (
        <details key={s.id} className="sk-shelf">
          <summary className="sk-listh">
            <span className="sk-hl">{s.label}</span>
            <span className="sk-sec">{s.items.length}</span>
            <Icon name="chevronDown" className="sk-fchev" size={14} />
          </summary>
          <ul className="sk-list">
            {s.items.map((t) => {
              const hint = [t.title, t.detail].filter(Boolean).join(" — ");
              return (
                <li key={t.id} className="sk-row">
                  <span className="sk-rlead" />
                  <span className="sk-rmain">
                    {t.originUrl ? (
                      <a
                        className="sk-rt sk-shelf-link"
                        href={t.originUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={hint}
                      >
                        {t.title}
                      </a>
                    ) : (
                      <span className="sk-rt" title={hint}>
                        {t.title}
                      </span>
                    )}
                  </span>
                  <span className="sk-rv">
                    {shelfOf(t.id) ? (
                      <button
                        type="button"
                        className="sk-btn is-small"
                        onClick={() => setRoleActive(t.id, true)}
                        title="Start working on it — moves it to the open tasks"
                        aria-label={`Make ${t.title} active`}
                      >
                        Active
                      </button>
                    ) : null}
                  </span>
                  <span />
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </>
  );
}

/** One site inside a Sites group: icon + name (open its page), open count, ↗ site, fold; then its lists. */
function SiteBlock({
  source,
  snapshot,
  onEnter,
  onOpen,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  extra,
}: {
  source: SourceDefinition;
  snapshot: SourceSnapshot;
  onEnter: () => void;
  onOpen: () => void;
  onCompleteFeatured?: (item: FeaturedItem) => void;
  onCompleteTask?: (task: TaskItem) => void;
  onStarTask?: (task: TaskItem) => void;
  extra?: ReactNode;
}) {
  const showSync =
    isConnectorSource(source.id) && Boolean(snapshot.refreshedAt);
  // TickTick: starred items sit at the top of their own Tasks / Habits column; only starred items
  // that aren't among the open tasks stay in the starred list above.
  const inline = source.id === "ticktick";
  const featuredAbove = inline
    ? snapshot.featured.filter(
        (f) =>
          !snapshot.tasks.some((t) => t.id === f.id && t.status !== "done"),
      )
    : snapshot.featured;
  const [collapsed, setCollapsed] = useState(() =>
    readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).includes(source.id),
  );
  const toggleCollapsed = () => {
    const next = !collapsed;
    const saved = readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).filter(
      (id) => id !== source.id,
    );
    writeSaved(
      STORAGE_KEYS.collapsedCards,
      next ? [...saved, source.id] : saved,
    );
    setCollapsed(next);
  };
  const links = source.relatedLinks || [];

  const { lanes } = usePriorityPins();
  const { base, deduct, value } = shownMetric(source.id, snapshot, lanes);
  const mainLabel = deduct
    ? `${base.label} · ${deduct} in Doing now`
    : base.label;
  const consumed = new Set(base.consumes || [base.key]);
  // Only stats that have a value — a row of "— applied today" placeholders is noise.
  const stats = source.metrics
    .filter(
      (m) =>
        !consumed.has(m.key) &&
        !["—", "0"].includes(String(metricValue(snapshot.metrics, m.key))),
    )
    .slice(0, source.id === "role" || source.id === "resale" ? 4 : 2);
  const sub = [
    ...stats.map(
      (m) => `${metricValue(snapshot.metrics, m.key)} ${m.label.toLowerCase()}`,
    ),
    source.label,
    showSync ? syncText(snapshot.refreshedAt) : "",
  ].filter(Boolean);

  return (
    <section
      className={`sk-src${source.placeholder ? " is-placeholder" : ""}`}
      data-site={source.id}
      aria-label={source.name}
    >
      <div className="sk-srch">
        <button
          type="button"
          className="sk-ricon"
          onClick={onEnter}
          title={`Open ${source.name} page`}
          aria-label={`Open ${source.name} page`}
        >
          <SiteIcon source={source.id} className="sk-siteicon" />
        </button>
        <button
          type="button"
          className="sk-hl sk-srch-name"
          onClick={onEnter}
          title={source.action}
        >
          {source.name}
        </button>
        <span
          className={`sk-count${value ? "" : " is-zero"}`}
          title={`${Number.isFinite(value) ? value : "—"} ${mainLabel.toLowerCase()}`}
        >
          {Number.isFinite(value) ? value.toLocaleString() : "—"}
        </span>
        {source.url ? (
          <button
            type="button"
            className="sk-ricon"
            onClick={onOpen}
            title={`Open ${source.shortName} site`}
            aria-label={`Open ${source.shortName} site`}
          >
            <Icon name="external" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className={`sk-ricon sk-srcfold${collapsed ? "" : " is-open"}`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${source.name}`}
          title={collapsed ? "Expand" : "Collapse to header"}
          onClick={toggleCollapsed}
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </div>
      {sub.length || links.length ? (
        <p className="sk-sec sk-srcsub">
          {sub.join(" · ")}
          {links.map((link) => (
            <a
              key={link.url}
              className="sk-link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ))}
        </p>
      ) : null}
      {collapsed ? null : (
        <div className="sk-srcbody">
          {/* Self's body is the Self tool itself; other sites' extras (Radall's money due) go below the tasks */}
          {source.id === "self" ? extra : null}
          {extra && source.id === "self" ? null : (
            <>
              {featuredAbove.length ? (
                <SiteStarred
                  sourceId={source.id}
                  snapshot={{ ...snapshot, featured: featuredAbove }}
                  onComplete={onCompleteFeatured}
                />
              ) : null}
              <SiteTasks
                sourceId={source.id}
                snapshot={snapshot}
                exclude={
                  inline
                    ? undefined
                    : new Set(snapshot.featured.map((f) => f.id))
                }
                starred={
                  inline
                    ? new Set(snapshot.featured.map((f) => f.id))
                    : undefined
                }
                onComplete={onCompleteTask}
                onStar={onStarTask}
                split={inline}
              />
            </>
          )}
          {source.id === "self" ? null : extra}
          <SiteShelves snapshot={snapshot} />
        </div>
      )}
    </section>
  );
}

const openOf = (snapshot: SourceSnapshot) =>
  snapshot.tasks.filter(isLate).length;

/** "14 to do · 2 overdue · TickTick 7, Radall 3" — the folded group still says where the work is. */
function rowMeta(
  ids: SourceId[],
  counts: Record<string, number>,
  snapshots: Record<SourceId, SourceSnapshot>,
) {
  const total = ids.reduce((sum, id) => sum + counts[id], 0);
  const late = ids.reduce((sum, id) => sum + openOf(snapshots[id]), 0);
  const bySite = ids
    .filter((id) => counts[id])
    .map((id) => `${sourceById[id].shortName} ${counts[id]}`);
  return [`${total} to do`, late ? `${late} overdue` : "", bySite.join(", ")]
    .filter(Boolean)
    .join(" · ");
}

export function SitesSection({
  snapshots,
  enter,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  extra,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  /** Per-site panels: Self's Captures tool, Radall's money due */
  extra?: Partial<Record<SourceId, ReactNode>>;
}) {
  const { lanes } = usePriorityPins();
  const all = SITE_ROWS.flatMap((r) => r.ids);
  const counts = Object.fromEntries(
    all.map((id) => [id, shownMetric(id, snapshots[id], lanes).value || 0]),
  ) as Record<string, number>;
  const total = all.reduce((sum, id) => sum + counts[id], 0);
  const sites = all.filter((id) => counts[id]).length;
  const late = all.reduce((sum, id) => sum + openOf(snapshots[id]), 0);
  const summary = [
    `${total} open across ${plural(sites, "site")}`,
    late ? `${late} overdue` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const block = (id: SourceId) => (
    <SiteBlock
      key={id}
      source={sourceById[id]}
      snapshot={snapshots[id]}
      onEnter={() => enter(id)}
      onOpen={() => openSource(id)}
      onCompleteFeatured={(item) => onCompleteFeatured(id, item)}
      onCompleteTask={(task) => onCompleteTask(id, task)}
      onStarTask={(task) => onStarTask(id, task)}
      extra={extra?.[id]}
    />
  );

  const [ops, role, vent] = SITE_ROWS;
  return (
    <Section id="sites" title="Sites" summary={summary}>
      <FoldGroup
        id={`row-${ops.ids.join("-")}`}
        tone={ops.tone}
        icon={ops.icon}
        title={ops.title}
        meta={rowMeta(ops.ids, counts, snapshots)}
      >
        {/* TickTick (wide, tasks | habits) over Radall; Self over Gmail; Outlook over Repair. */}
        <div className="sk-ops-grid">
          <div className="sk-col">
            {block("ticktick")}
            {block("radall")}
          </div>
          <div className="sk-col">
            {block("self")}
            {block("gmail")}
          </div>
          <div className="sk-col">
            {block("outlook")}
            {block("repair")}
          </div>
        </div>
      </FoldGroup>
      {[role, vent].map((r) => (
        <FoldGroup
          key={r.title}
          id={`row-${r.ids.join("-")}`}
          tone={r.tone}
          icon={r.icon}
          title={r.title}
          meta={rowMeta(r.ids, counts, snapshots)}
        >
          <div
            className="sk-cols"
            style={{ "--cols": r.ids.length } as CSSProperties}
          >
            {r.ids.map((id) => (
              <div key={id} className="sk-col">
                {block(id)}
              </div>
            ))}
          </div>
        </FoldGroup>
      ))}
    </Section>
  );
}
