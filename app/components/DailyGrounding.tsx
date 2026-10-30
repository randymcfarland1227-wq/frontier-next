"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Goal, GoalsData } from "../../lib/goals";
import type { SourceSnapshot, SpaceId } from "../../lib/types";
import type { CompletionLedger } from "../../lib/completions";
import { tickTickToday, type TodayTask } from "../../lib/tickTickToday";
import { ALIGNMENT, type AlignmentItem } from "../../lib/alignment";
import { localDayKey, useDayKey } from "../../lib/dayKey";
import { LOCAL_WRITE_EVENT, readSaved, writeSaved } from "../../lib/storage";
import {
  modeOf,
  routinesFor,
  setGoalMode,
  useGoalModes,
  type GoalModes,
} from "../../lib/goalModes";
import { Dot, Group, Row, Tag } from "../sticker/kit";
import { Icon } from "../sticker/Icon";

const AFFIRMATIONS_KEY = "lifehub-grounding-affirmations";
const dayKey = localDayKey;
type Affirmations = { day: string; entries: Record<string, string> };
const emptyAffirmations: Affirmations = { day: "", entries: {} };

/** Affirmations are daily reflections, separate from the task completion ledger. */
function useAffirmations() {
  const day = useDayKey();
  const [saved, setSaved] = useState(() =>
    readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations),
  );
  useEffect(() => {
    const refresh = () => {
      setSaved(readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations));
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(LOCAL_WRITE_EVENT, refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LOCAL_WRITE_EVENT, refresh);
    };
  }, []);
  const submit = (id: string, text: string): boolean => {
    const affirmation = text.trim();
    if (!affirmation) return false;
    const currentDay = dayKey();
    if (day !== currentDay) return false;
    const current = readSaved<Affirmations>(
      AFFIRMATIONS_KEY,
      emptyAffirmations,
    );
    const next = {
      day,
      entries: {
        ...(current?.day === day ? current.entries : {}),
        [id]: affirmation,
      },
    };
    try {
      window.localStorage.setItem(AFFIRMATIONS_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    setSaved(next);
    window.dispatchEvent(
      new CustomEvent(LOCAL_WRITE_EVENT, { detail: AFFIRMATIONS_KEY }),
    );
    return true;
  };
  return {
    day,
    entries: saved?.day === day ? saved.entries || {} : {},
    submit,
  };
}

/** The affirmation for one reminder: trace it in your own words over the faint guide, press Enter. Required daily to count as reviewed. */
function AffirmationForm({
  guide,
  reviewed,
  submit,
}: {
  guide: AlignmentItem;
  reviewed?: string;
  submit: (id: string, text: string) => boolean;
}) {
  const [draft, setDraft] = useState(reviewed || "");
  const [error, setError] = useState("");
  return (
    <form
      className="sk-aff-form"
      aria-label={`${guide.title} affirmation`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) {
          setError("Write an affirmation in your own words first.");
          return;
        }
        if (submit(guide.id, draft)) {
          setDraft(draft.trim());
          setError("");
        } else
          setError("Your affirmation couldn’t be saved. Please try again.");
      }}
    >
      <label className="sk-cap" htmlFor={`affirmation-${guide.id}`}>
        {reviewed ? (
          <>
            <Icon name="check" size={14} /> Affirmed today
          </>
        ) : (
          "In your own words"
        )}
      </label>
      <span className="sk-trace">
        {draft ? null : (
          <span className="sk-ghost" aria-hidden="true">
            {guide.ghost}
          </span>
        )}
        <textarea
          id={`affirmation-${guide.id}`}
          rows={3}
          value={draft}
          maxLength={1000}
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? `affirmation-error-${guide.id}` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </span>
      <button
        type="submit"
        className="sk-btn is-small"
        disabled={!draft.trim() || draft.trim() === reviewed}
      >
        {reviewed ? "Update" : "Affirm"}
      </button>
      {error ? (
        <p
          id={`affirmation-error-${guide.id}`}
          className="sk-aff-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Section head summary: how many reminders are affirmed today. */
export function GroundingSummary() {
  const { entries } = useAffirmations();
  const total = ALIGNMENT.length;
  const done = Object.values(entries).filter((v) => v?.trim()).length;
  return (
    <>
      {Math.min(done, total)} of {total} affirmed today
    </>
  );
}

type LinkedTask = TodayTask;
const linkedToday = (
  item: AlignmentItem,
  ticktick: SourceSnapshot | undefined,
  ledger: CompletionLedger | undefined,
  day: string,
) => tickTickToday(item.linked, ticktick, ledger, day);

/** "How to" under a reminder's title: hover (or focus / tap) lists today's linked tasks and whether each is done. */
function HowTo({ tasks }: { tasks: LinkedTask[] }) {
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="sk-how">
      <button type="button" className="sk-how-btn" aria-haspopup="true">
        <Icon name="steps" size={14} />
        How to
        {tasks.length ? (
          <small>
            {done}/{tasks.length}
          </small>
        ) : null}
      </button>
      <div className="sk-how-pop" role="tooltip">
        <p className="sk-cap">
          {tasks.length
            ? `Today · ${done} of ${tasks.length} done`
            : "Nothing linked to this today"}
        </p>
        <ul>
          {tasks.map((t) => (
            <li key={t.title} className={t.done ? "is-done" : ""}>
              <Icon name={t.done ? "check" : "minus"} size={14} />
              <span>{t.title}</span>
              <em>{t.done ? "done" : "not yet"}</em>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MODE_LABEL = {
  active: "Active",
  passive: "Passive",
  none: "No routine yet",
} as const;
const MODE_TONE = { active: "done", passive: "open", none: "paper" } as const;

/**
 * Daily grounding, top to bottom: Alignment (one card per reminder, each with its own affirmation)
 * → current goals by area (opens a sheet with each goal's why and practices) → what unlocks the move.
 */
export function DailyGrounding({
  move,
  goals,
  enter,
  ticktick,
  ledger,
}: {
  move?: SourceSnapshot;
  goals: GoalsData | null;
  enter: (space: SpaceId) => void;
  ticktick?: SourceSnapshot;
  ledger?: CompletionLedger;
}) {
  const { day, entries, submit } = useAffirmations();
  const modes = useGoalModes();
  const [selectedGoal, selectGoal] = useState<string | null>(null);
  const affirmed = ALIGNMENT.filter((g) => entries[g.id]?.trim()).length;
  const moveGoals = (move?.featured || []).filter(
    (f) => f.completable === false,
  );
  const currentGoals = (goals?.goals || []).filter(
    (g) => g.status === "active",
  );
  const counts = { active: 0, passive: 0, none: 0 };
  for (const g of currentGoals) counts[modeOf(g.id, modes).mode || "none"]++;
  const selected = currentGoals.find((g) => g.id === selectedGoal) || null;
  const [openCat, setOpenCat] = useState<string | null>(null);
  const openCategory = goals?.categories.find((c) => c.id === openCat) || null;
  const popGoals = currentGoals.filter((g) => g.categoryId === openCat);
  const openFlow = () => {
    writeSaved("lifehub-why-tab", "flow");
    enter("why");
  };
  useEffect(() => {
    if (!openCat) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenCat(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCat]);

  return (
    <>
      {/* 1 · Alignment */}
      <Group
        tone="ground"
        icon="sprout"
        title="Alignment"
        meta={
          <span
            className="sk-aff-meter"
            aria-live="polite"
            aria-label={`${affirmed} of ${ALIGNMENT.length} affirmed today`}
          >
            {ALIGNMENT.map((g) => (
              <i
                key={g.id}
                className={entries[g.id]?.trim() ? "is-done" : ""}
              />
            ))}
            Read each one, then put it in your own words
          </span>
        }
      >
        <div className="sk-aff">
          {ALIGNMENT.map((item) => (
            <article
              key={item.id}
              className={`sk-aff-card${entries[item.id]?.trim() ? " is-done" : ""}`}
              aria-label={item.title}
            >
              <h4 className="sk-hl">
                <span aria-hidden="true">{item.icon}</span> {item.title}
              </h4>
              <HowTo tasks={linkedToday(item, ticktick, ledger, day)} />
              <ul className="sk-aff-lines">
                {item.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {item.via ? (
                <span className="sk-aff-via">
                  {item.via.map((v) => (
                    <Tag key={v}>{v}</Tag>
                  ))}
                </span>
              ) : null}
              {item.link?.url ? (
                <a
                  className="sk-link"
                  href={item.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.link.label} ↗
                </a>
              ) : null}
              <AffirmationForm
                key={`${day}:${item.id}`}
                guide={item}
                reviewed={entries[item.id]}
                submit={submit}
              />
            </article>
          ))}
        </div>
      </Group>

      <div
        className="sk-cols sk-ground-cols"
        style={{ "--cols": 2 } as React.CSSProperties}
      >
        {/* 2 · Current goals */}
        <Group
          tone="ground"
          icon="target"
          title="Current goals"
          meta={`${counts.active} active · ${counts.passive} passive${counts.none ? ` · ${counts.none} no routine yet` : ""}`}
          actions={
            <button type="button" className="sk-link" onClick={openFlow}>
              Open Flow
              <Icon name="chevron" size={14} />
            </button>
          }
        >
          {goals === null ? (
            <p className="sk-empty">Loading goals…</p>
          ) : (
            <div className="sk-list">
              {goals.categories.map((c) => {
                const list = currentGoals.filter((g) => g.categoryId === c.id);
                if (!list.length) return null;
                return (
                  <Row
                    key={c.id}
                    lead={<span aria-hidden="true">{c.icon}</span>}
                    title={c.label}
                    value={`${list.length} goal${list.length === 1 ? "" : "s"}`}
                    hint="Each goal’s why and practices"
                    onOpen={() => {
                      setOpenCat(c.id);
                      selectGoal(null);
                    }}
                  />
                );
              })}
            </div>
          )}
        </Group>

        {/* 3 · Move */}
        <Group
          tone="ground"
          icon="truck"
          title="Move"
          meta="What unlocks the move"
          actions={
            <button
              type="button"
              className="sk-link"
              onClick={() => enter("move")}
            >
              Open Move OS
              <Icon name="chevron" size={14} />
            </button>
          }
        >
          {moveGoals.length ? (
            <div className="sk-list">
              {moveGoals.map((g) => (
                <Row
                  key={g.id}
                  lead={<Dot tone="ground" />}
                  title={g.title}
                  sub={g.detail}
                />
              ))}
            </div>
          ) : (
            <p className="sk-empty">
              Open Move OS once and its goals show here.
            </p>
          )}
        </Group>
      </div>

      {openCategory
        ? createPortal(
            <div
              className="sk-dialog-back"
              role="presentation"
              onClick={() => setOpenCat(null)}
            >
              <div
                className="sk-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={openCategory.label}
                onClick={(e) => e.stopPropagation()}
              >
                <header className="sk-dialog-head">
                  <span aria-hidden="true">{openCategory.icon}</span>
                  <h3 className="sk-title">{openCategory.label}</h3>
                  <button
                    type="button"
                    className="sk-btn is-icon is-small"
                    aria-label="Close"
                    onClick={() => setOpenCat(null)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </header>
                <div className="sk-list">
                  {popGoals.map((g) => {
                    const mode = modeOf(g.id, modes).mode || "none";
                    const open = selectedGoal === g.id;
                    return (
                      <div key={g.id}>
                        <Row
                          title={g.title}
                          value={
                            <Tag tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Tag>
                          }
                          highlight={open}
                          onOpen={() => selectGoal(open ? null : g.id)}
                        />
                        {open && selected ? (
                          <GoalDetail
                            goal={selected}
                            modes={modes}
                            close={() => selectGoal(null)}
                            openFlow={openFlow}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.querySelector(".sk-app") ||
              document.querySelector(".frontier-shell") ||
              document.body,
          )
        : null}
    </>
  );
}

const TIER_LABEL: Record<string, string> = {
  drive: "Drives it",
  enable: "Makes it easier",
  upkeep: "Keeps it up",
};

/** The opened goal, under its row: your why and how, active or passive, and the Flow routines behind it. */
function GoalDetail({
  goal,
  modes,
  close,
  openFlow,
}: {
  goal: Goal;
  modes: GoalModes;
  close: () => void;
  openFlow: () => void;
}) {
  const { mode, mine } = modeOf(goal.id, modes);
  const routines = routinesFor(goal.id);
  const tiers = ["drive", "enable", "upkeep"]
    .map((t) => ({ t, list: routines.filter((r) => r.tier === t) }))
    .filter((x) => x.list.length);
  return (
    <div className="sk-goal">
      <div className="sk-goal-head">
        <span
          className="sk-seg"
          role="group"
          aria-label={`${goal.title}: active or passive`}
        >
          {(["active", "passive"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setGoalMode(goal.id, m)}
            >
              {m === "active" ? "Active" : "Passive"}
            </button>
          ))}
        </span>
        <span className="sk-cap">
          {mine
            ? "Your call"
            : mode
              ? "From Flow"
              : "No routine yet — pick one"}
        </span>
        {mine ? (
          <button
            type="button"
            className="sk-link"
            onClick={() => setGoalMode(goal.id, null)}
          >
            Use Flow’s
          </button>
        ) : null}
        <button
          type="button"
          className="sk-link sk-goal-close"
          onClick={close}
          aria-label={`Close ${goal.title}`}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {goal.why ? <p className="sk-goal-why">{goal.why}</p> : null}
      {goal.how ? (
        <p className="sk-goal-how">
          <b>How:</b> {goal.how}
        </p>
      ) : null}
      {tiers.length ? (
        <dl className="sk-goal-tiers">
          {tiers.map(({ t, list }) => (
            <div key={t}>
              <dt className="sk-cap">{TIER_LABEL[t] || t}</dt>
              <dd>
                {list.map((r) => (
                  <Tag key={r.id} tone="habit" hint={r.when}>
                    {r.title}
                  </Tag>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="sk-goal-how">
          Nothing in Flow drives this yet.{" "}
          <button type="button" className="sk-link" onClick={openFlow}>
            Link a routine in Flow
          </button>
        </p>
      )}
    </div>
  );
}
