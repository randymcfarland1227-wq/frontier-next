"use client";

/**
 * Outstanding (was "What I owe"), from Randy's 2026-10-22 drawings: every MD ticket in ONE box —
 * collapsed by source (count · sum · sum with the MVA flag fee), each source opens to its tickets
 * (flag · date · amount · amount with flag · plan sign) — out-of-state tickets the same way below it,
 * then part 2 in three columns: Pay laters · Taxes / Legal · Projects / Required.
 */

import { FinanceLabel } from "./FinanceDrawer";
import { useState, type ReactNode } from "react";
import { Icon } from "../sticker/Icon";
import { Dialog } from "../sticker/Dialog";
import { MoneyExtras, useExtrasBadge } from "./MoneyExtras";
import { findingOf, loadFindings, setFinding, useFindings } from "../../lib/finFindings";
import {
  amountOf,
  parseSheetDate,
  type Cell,
  type MoneyModel,
  type Table,
} from "../../lib/money";
import { fromDayKey, money, type BillDue } from "../../lib/schedule";
import {
  isSettled,
  type DebtFile,
  type DebtItem,
  type DebtMarks,
  RENEWAL_STEP,
} from "../../lib/debtFile";
import { isLedgerPaid } from "../../lib/moneyLedger";
import { readSaved, writeSaved } from "../../lib/storage";
import {
  isOwedDone,
  setOwedDone,
  useOwedDone,
  type OwedDone,
} from "../../lib/owedComplete";

type CellView = (c: Cell | undefined, placeholder?: string) => ReactNode;

/** MVA administrative flag fee per flagged ticket (the 10/15 MVA letter: 13 × $30). */
export const FLAG_FEE = 30;
const OPEN_KEY = "lifehub-outstanding-open";

const usd = (n?: number | null) =>
  n === undefined || n === null ? "?" : money(n);
const md = (k?: string) =>
  k
    ? fromDayKey(k.slice(0, 10)).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year:
          k.slice(0, 4) === String(new Date().getFullYear())
            ? undefined
            : "2-digit",
      })
    : "—";
const daysUntil = (d: string) =>
  Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86400000);
/** A sum with an unknown amount in it: "$310 + ?", or just "? + $30" when the known part is only fees. */
const unk = (n: number, unknown: boolean) =>
  !unknown ? usd(n) : n ? `${usd(n)} + ?` : "?";
const counts = (i: DebtItem, marks: DebtMarks) =>
  !i.unverified && !isSettled(marks[i.id]);
export const isFlagged = (i: DebtItem) =>
  Boolean(i.ticket?.flagged) && !/^not /i.test(i.ticket?.flagged || "");

type Source = {
  id: string;
  label: string;
  items: DebtItem[];
  how?: string;
  plan?: "yes" | "ask";
};

const MD_SOURCES: Array<[string, string]> = [
  ["city", "Baltimore City"],
  ["county", "Baltimore County"],
  ["safezones", "Work zone · SafeZones"],
  ["ccu", "Work zone · CCU"],
  ["mdta", "MDTA (toll flag)"],
  [RENEWAL_STEP, "Registration renewal fee"],
];
const OOS_SOURCES: Array<[string, string]> = [
  ["dc-", "Washington, DC"],
  ["ny-", "New York · New Jersey"],
  ["de-", "Delaware"],
];

export function mdSources(file: DebtFile): Source[] {
  const md = file.items.filter((i) => i.group === "md");
  const steps = file.registration?.steps || [];
  const out: Source[] = MD_SOURCES.map(([id, label]) => {
    const st = steps.find((s) => s.id === id);
    return {
      id,
      label,
      items: md.filter((i) => i.step === id),
      how: st?.where,
      plan:
        st?.plan?.state === "yes" || st?.plan?.state === "ask"
          ? st.plan.state
          : undefined,
    };
  });
  const rest = md.filter((i) => !MD_SOURCES.some(([id]) => id === i.step));
  if (rest.length) out.push({ id: "other", label: "Other MD", items: rest });
  const wv = file.items.filter((i) => i.group === "wv");
  if (wv.length)
    out.push({
      id: "wv",
      label: "Old WV plate (2025)",
      items: wv,
      how: "Not flagged in MD — check whether these were paid.",
    });
  return out.filter((s) => s.items.length);
}

export function oosSources(file: DebtFile): Source[] {
  const oos = file.items.filter((i) => i.group === "oos");
  return OOS_SOURCES.map(([p, label]) => ({
    id: p,
    label,
    items: oos.filter((i) => i.id.startsWith(p)),
  })).filter((s) => s.items.length);
}

/** On top of the ticket: for a flagged MD ticket the city/county flag fee + the $30 MVA flag fee. */
const extraOf = (i: DebtItem, kind: "md" | "oos") =>
  kind === "md"
    ? isFlagged(i)
      ? FLAG_FEE + (i.ticket?.flagFee || 0)
      : 0
    : i.maybe || 0;
/** "$40 ticket + $25 city flag fee + $30 MVA flag fee" for a flagged ticket's hover. */
const flagBreakdown = (i: DebtItem) =>
  [
    `${usd(i.amount)} ticket`,
    i.ticket?.flagFee
      ? `${usd(i.ticket.flagFee)} ${/county/i.test(i.ticket.who) ? "county" : "city"} flag fee`
      : "",
    `${usd(FLAG_FEE)} MVA flag fee`,
  ]
    .filter(Boolean)
    .join(" + ");

/** What clearing the MD registration costs: every flagged ticket + its fees, and what still has to be paid before it flags. */
export function registrationCost(file: DebtFile, marks: DebtMarks) {
  const md = file.items.filter((i) => i.group === "md" && counts(i, marks));
  const flags = md.filter(isFlagged);
  const tickets = flags.reduce((s, i) => s + (i.amount || 0), 0);
  const local = flags.reduce((s, i) => s + (i.ticket?.flagFee || 0), 0);
  const mva = flags.length * FLAG_FEE;
  const soon = md
    .filter((i) => !isFlagged(i) && i.blocksRegistration)
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  return {
    n: flags.length,
    tickets,
    local,
    mva,
    total: tickets + local + mva,
    unknown: flags.some((i) => i.amount === null),
    soon,
    soonSum: soon.reduce((s, i) => s + (i.amount || 0), 0),
  };
}
function sums(items: DebtItem[], marks: DebtMarks, kind: "md" | "oos") {
  const live = items.filter((i) => counts(i, marks));
  // Hand-typed fees (registration renewal) count in the money, not as tickets.
  const tickets = live.filter((i) => !i.id.startsWith("own:")).length;
  const sum = live.reduce((s, i) => s + (i.amount || 0), 0);
  const extra = live.reduce((s, i) => s + extraOf(i, kind), 0);
  return {
    n: tickets,
    sum,
    withExtra: sum + extra,
    unknown: live.some((i) => i.amount === null),
  };
}

/** Totals the header dashboard shows. */
export function ticketTotals(file: DebtFile | null, marks: DebtMarks) {
  if (!file) return { md: 0, mdFlag: 0, oos: 0, oosFee: 0 };
  const m = sums(
    [...file.items.filter((i) => i.group === "md" || i.group === "wv")],
    marks,
    "md",
  );
  const o = sums(
    file.items.filter((i) => i.group === "oos"),
    marks,
    "oos",
  );
  return { md: m.sum, mdFlag: m.withExtra, oos: o.sum, oosFee: o.withExtra };
}

function TicketBox({
  title,
  tone,
  kind,
  sources,
  marks,
  onOpen,
  head,
  foot,
}: {
  title: string;
  tone: string;
  kind: "md" | "oos";
  sources: Source[];
  marks: DebtMarks;
  onOpen: (id: string) => void;
  head?: ReactNode;
  foot?: ReactNode;
}) {
  const [open, setOpenState] = useState<Record<string, boolean>>(() =>
    readSaved(OPEN_KEY, {}),
  );
  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] };
    setOpenState(next);
    writeSaved(OPEN_KEY, next);
  };
  const all = sums(
    sources.flatMap((s) => s.items),
    marks,
    kind,
  );
  const extraLabel = kind === "md" ? "With flag" : "With fees";
  return (
    <section className={`sk-group tone-${tone} skm-sec ob-box`}>
      <header className="sk-ghead skm-head">
        <div className="skm-titles">
          <h2 className="sk-hl">{title}</h2>
          {head ? <p className="sk-sec">{head}</p> : null}
        </div>
        <div className="skm-fig">
          <b>{usd(all.withExtra)}</b>
          <span className="sk-cap">
            {all.n} tickets · {usd(all.sum)} before{" "}
            {kind === "md" ? "flag fees" : "fees"}
          </span>
        </div>
      </header>
      <div className="sk-gbody skm-body">
        <div className="ob-t" role="table" aria-label={title}>
          <div className="ob-r ob-h" role="row">
            <span>Source</span>
            <span className="num">Tickets</span>
            <span className="num">Sum</span>
            <span className="num">{extraLabel}</span>
          </div>
          {sources.map((s) => {
            const t = sums(s.items, marks, kind);
            const isOpen = Boolean(open[`${kind}:${s.id}`]);
            return (
              <div key={s.id} className={`ob-src${isOpen ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="ob-r ob-srow"
                  role="row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(`${kind}:${s.id}`)}
                >
                  <span className="ob-name">
                    <Icon name="chevron" className="ob-chev" />
                    {s.label}
                    {s.plan ? (
                      <em className={`dbt-plan is-${s.plan}`}>
                        {s.plan === "yes" ? "Plan ✓" : "Plan?"}
                      </em>
                    ) : null}
                  </span>
                  <span className="num">{t.n || "—"}</span>
                  <span className="num">{unk(t.sum, t.unknown)}</span>
                  <span className="num">
                    <b>{unk(t.withExtra, t.unknown)}</b>
                  </span>
                </button>
                {isOpen ? (
                  <div className="ob-tickets">
                    {s.how ? <p className="ob-how">{s.how}</p> : null}
                    {[...s.items]
                      .sort((a, b) =>
                        (a.ticket?.date || "").localeCompare(
                          b.ticket?.date || "",
                        ),
                      )
                      .map((i) => {
                        const settled = isSettled(marks[i.id]);
                        const extra = extraOf(i, kind);
                        return (
                          <button
                            key={i.id}
                            type="button"
                            className={`ob-r ob-tk${settled ? " is-settled" : ""}`}
                            onClick={() => onOpen(i.id)}
                            title={i.sub || i.name}
                          >
                            <span className="ob-name">
                              <i
                                className={`ob-flag${isFlagged(i) ? " is-on" : ""}`}
                                title={i.ticket?.flagged || "no flag"}
                              >
                                {isFlagged(i) ? "⚑" : ""}
                              </i>
                              <b className="ob-date">{md(i.ticket?.date)}</b>
                              <span className="ob-where">
                                {i.name
                                  .replace(/ — (\d+) in a (\d+)/, " · $1/$2")
                                  .replace(/ \((\w{3} \d+[^)]*)\)$/, "")}
                              </span>
                              {i.plan?.state === "yes" ||
                              i.plan?.state === "ask" ? (
                                <em className={`dbt-plan is-${i.plan.state}`}>
                                  {i.plan.state === "yes" ? "Plan ✓" : "Plan?"}
                                </em>
                              ) : null}
                              {marks[i.id] ? (
                                <em
                                  className={`dbt-mark is-${marks[i.id].status}`}
                                >
                                  {marks[i.id].status}
                                </em>
                              ) : null}
                            </span>
                            <span />
                            <span className="num">{usd(i.amount)}</span>
                            <span
                              className="num"
                              title={
                                kind === "md" && isFlagged(i)
                                  ? flagBreakdown(i)
                                  : undefined
                              }
                            >
                              {extra
                                ? `${i.amount === null ? "? + " : ""}${usd((i.amount || 0) + extra)}`
                                : usd(i.amount)}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="ob-r ob-foot" role="row">
            <span>Sum</span>
            <span className="num">{all.n}</span>
            <span className="num">{usd(all.sum)}</span>
            <span className="num">
              <b>{usd(all.withExtra)}</b>
            </span>
          </div>
        </div>
        {foot}
      </div>
    </section>
  );
}

/** Plain ledger under the MD box: what it costs to clear every flag, then what to pay before it flags. */
function RegClear({
  file,
  marks,
  onOpen,
}: {
  file: DebtFile;
  marks: DebtMarks;
  onOpen: (id: string) => void;
}) {
  const c = registrationCost(file, marks);
  if (!c.n && !c.soon.length) return null;
  const list = file.items.find((i) => i.ticket?.mvaList)?.ticket?.mvaList;
  return (
    <div className="ob-reg">
      <p className="ob-reg-h">
        To clear the registration · {c.n} flag{c.n === 1 ? "" : "s"}
        {list ? ` on the ${md(list)} MVA list` : ""}
      </p>
      <div className="ob-reg-l">
        <span>Tickets</span>
        <span className="num">{unk(c.tickets, c.unknown)}</span>
      </div>
      {c.local ? (
        <div className="ob-reg-l">
          <span>City / county flag fees</span>
          <span className="num">{usd(c.local)}</span>
        </div>
      ) : null}
      <div className="ob-reg-l">
        <span>
          MVA flag fees · {c.n} × {usd(FLAG_FEE)}
        </span>
        <span className="num">{usd(c.mva)}</span>
      </div>
      <div className="ob-reg-l ob-reg-t">
        <span>Total to clear</span>
        <span className="num">{unk(c.total, c.unknown)}</span>
      </div>
      {c.soon.length ? (
        <>
          <p className="ob-reg-h">
            Pay before they flag · {usd(c.soonSum)} (no flag fees if paid in time)
          </p>
          {c.soon.map((i) => (
            <button
              key={i.id}
              type="button"
              className="ob-reg-l ob-reg-soon"
              onClick={() => onOpen(i.id)}
            >
              <span>
                {i.due ? <b>by {md(i.due)}</b> : null} {i.sub || i.name}
              </span>
              <span className="num">{usd(i.amount)}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}

// ─────────────────────────── part 2 ───────────────────────────

export type OwedLine = {
  recurring?: boolean;
  key: string;
  name: string;
  amount?: number;
  cell?: Cell;
  date?: string;
  note?: string;
  itemId?: string;
  done?: boolean;
  unverified?: boolean;
  /** The old row-only key (marks saved before 2026-11-16); honored only when one line has it. */
  legacyKey?: string;
  /** Always the old row-only key, for links saved before the column was added */
  rowKey?: string;
  /** The sheet's own figure when an amount found on Life Hub (a letter) overrides it */
  sheetAmount?: number;
};
const rowsOf = (t?: Table | null) =>
  (t?.rows || []).filter((r) => r.some((c) => c.text.trim()));
const lineSum = (xs: OwedLine[]) =>
  xs
    .filter((x) => !x.done && !x.unverified)
    .reduce((s, x) => s + (x.amount || 0), 0);

export function outstandingParts(
  model: MoneyModel | null,
  file: DebtFile | null,
  marks: DebtMarks,
  monthDues: BillDue[],
  paidAt: Record<string, string>,
  owedDone: OwedDone = {},
) {
  const nc = (re: RegExp) =>
    model?.nonCredit.find((t) => re.test(t.title)) || null;
  const item = (i: DebtItem): OwedLine => ({
    key: i.id,
    name: i.name,
    amount: i.amount ?? undefined,
    itemId: i.id,
    note: i.status,
    date: i.due,
    done: isSettled(marks[i.id]),
    unverified: i.unverified,
  });
  const sheetLine = (
    r: Cell[],
    name: number,
    amt: number,
    note?: number,
    date?: number,
  ): OwedLine => withFound({
    // Tab + row + first column: the sheet keeps tables side by side, so row alone isn't unique.
    key: `${r[0].tab}:${r[0].r}:${r[0].c}`,
    legacyKey: `${r[0].tab}:${r[0].r}`,
    rowKey: `${r[0].tab}:${r[0].r}`,
    name: r[name]?.text.trim() || "",
    cell: r[amt],
    amount: amountOf(r[amt]?.text || ""),
    note: note !== undefined ? r[note]?.text : undefined,
    date:
      date !== undefined && r[date]?.text
        ? parseSheetDate(r[date].text)
        : undefined,
    done:
      r.some((c) => c.struck) ||
      (note !== undefined && /complete|paid/i.test(r[note]?.text || "")),
  });
  // An amount found on Life Hub (e.g. the letter's balance) wins over the sheet's figure; the sheet isn't touched.
  const found = loadFindings();
  function withFound(l: OwedLine): OwedLine {
    const f = findingOf(found, l.key);
    if (!f || f.amount === undefined || f.amount === null || f.amount === l.amount) return l;
    return { ...l, sheetAmount: l.amount, amount: f.amount, cell: undefined };
  }
  const plDues = monthDues
    .filter(
      (d) =>
        d.bill.kind === "paylater" && !isLedgerPaid(d, paidAt) && !d.skipped,
    )
    .sort((a, b) => a.due.localeCompare(b.due));

  const payLater: OwedLine[] = rowsOf(model?.paylaterSums).map((r) => {
    const prov = r[0].text.replace(/\s*sum$/i, "").trim();
    const next = plDues.find((d) =>
      `${d.bill.nameBeforeLabel ?? d.bill.name} ${d.bill.notes || ""}`
        .toLowerCase()
        .includes(prov.toLowerCase()),
    );
    return {
      ...sheetLine(r, 0, 1),
      name: prov,
      date: next?.due,
      note: next ? `next ${money(next.bill.amount)}` : undefined,
    };
  });
  // A cash advance paid on Life Hub (Ledger / Month view) is done here too, not only when struck in the sheet.
  const moneySlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
  const cashAdv: OwedLine[] = rowsOf(model?.cashAdvances).map((r) => {
    const l = sheetLine(r, 1, 2, undefined, 0);
    const id = `money:cash:${moneySlug(l.name)}:${l.date || moneySlug(r[0]?.text || "nodate")}`;
    return paidAt[id] ? { ...l, done: true } : l;
  });
  const liab = nc(/non.?car|liabilit/i);
  const advances: OwedLine[] = rowsOf(liab)
    .filter((r) => !/t-?mobile/i.test(r.map((c) => c.text).join(" ")))
    .map((r) => sheetLine(r, 0, 3, 1));

  const liabItems = (file?.items || []).filter((i) => i.group === "liability");
  const taxes: OwedLine[] = [
    ...liabItems.filter((i) => !i.project && !/t-?mobile/i.test(i.name)).map(item),
    ...rowsOf(nc(/regulat/i))
      .filter((r) => !/tax/i.test(r[0].text))
      .map((r) => sheetLine(r, 0, 3, 1)),
  ];
  const projects: OwedLine[] = [
    ...rowsOf(nc(/repair/i)).map((r) => sheetLine(r, 0, 3, 1)),
    ...liabItems.filter((i) => i.project).map(item),
    ...liabItems.filter((i) => /t-?mobile/i.test(i.name)).map(item),
    ...rowsOf(model?.outstanding)
      .filter((r) => !/ticket/i.test(r[0].text))
      .map((r) => sheetLine(r, 0, 1, 2)),
  ];
  // Marked complete on Life Hub (recurring pay-later plans only for this month).
  const legacyCount = new Map<string, number>();
  for (const x of [...payLater, ...cashAdv, ...advances, ...taxes, ...projects])
    if (x.legacyKey) legacyCount.set(x.legacyKey, (legacyCount.get(x.legacyKey) || 0) + 1);
  const mark = (xs: OwedLine[], recurring = false) =>
    xs.map((x) => {
      const legacy = x.legacyKey && legacyCount.get(x.legacyKey) === 1 && owedDone[x.key] === undefined ? x.legacyKey : undefined;
      return {
        ...x,
        recurring,
        legacyKey: legacy,
        done: x.done || isOwedDone(owedDone, x.key) || (legacy ? isOwedDone(owedDone, legacy) : false),
      };
    });
  return {
    payLater: mark(payLater, true),
    cashAdv: mark(cashAdv),
    advances: mark(advances),
    taxes: mark(taxes),
    projects: mark(projects),
    sum: lineSum,
  };
}

function OwedCol({
  tone,
  title,
  groups,
  cell,
  onOpen,
  paidAt = {},
}: {
  tone: string;
  title: string;
  groups: Array<[string, OwedLine[]]>;
  cell: CellView;
  onOpen: (id: string) => void;
  paidAt?: Record<string, string>;
}) {
  const total = groups.reduce((s, [, xs]) => s + lineSum(xs), 0);
  const [pop, setPop] = useState<OwedLine | null>(null);
  const line = (x: OwedLine) => (
    <div key={x.key} className={`ob-line${x.done ? " is-settled" : ""}`}>
      {x.itemId ? (
        <button
          type="button"
          className="ob-line-name"
          onClick={() => onOpen(x.itemId!)}
          title={x.note}
        >
          <FinanceLabel id={`debt:${x.itemId}`} name={x.name} />
        </button>
      ) : (
        <button type="button" className="ob-line-name" title={x.note || "Open: amount, payments, letters"} onClick={() => setPop(x)}>
          {x.name}
          <LineBadge fkey={x.key} paidAt={paidAt} />
        </button>
      )}
      <span className="num">{x.cell ? cell(x.cell, "—") : usd(x.amount)}</span>
      <small>
        {x.unverified
          ? "unverified · not counted"
          : x.date
            ? md(x.date)
            : x.done
              ? "done"
              : x.note && x.note.length < 22
                ? x.note
                : "—"}
      </small>
      {x.itemId ? (
        <span />
      ) : (
        <button
          type="button"
          className="sk-btn is-small ob-check"
          onClick={() => {
            setOwedDone(x.key, !x.done, x.recurring);
            if (x.done && x.legacyKey) setOwedDone(x.legacyKey, false);
          }}
          title={
            x.done
              ? "Put back on the list"
              : x.recurring
                ? "Paid for this month"
                : "Complete — takes it off the list"
          }
          aria-label={`${x.done ? "Reopen" : "Complete"} ${x.name}`}
        >
          {x.done ? "↩" : "✓"}
        </button>
      )}
    </div>
  );
  return (
    <section className={`sk-group tone-${tone} skm-sec ob-col`}>
      <header className="sk-ghead skm-head">
        <div className="skm-titles">
          <h2 className="sk-hl">{title}</h2>
        </div>
        <div className="skm-fig">
          <b>{usd(total)}</b>
        </div>
      </header>
      <div className="sk-gbody skm-body">
        {groups.map(([label, xs]) =>
          xs.length ? (
            <div key={label} className="ob-grp">
              {groups.length > 1 ? (
                <h5>
                  {label} <span>{usd(lineSum(xs))}</span>
                </h5>
              ) : null}
              {xs.filter((x) => !x.done || x.itemId).map((x) => line(x))}
              {xs.some((x) => x.done && !x.itemId) ? (
                <details className="ob-done">
                  <summary>
                    Done · {xs.filter((x) => x.done && !x.itemId).length}
                  </summary>
                  {xs.filter((x) => x.done && !x.itemId).map((x) => line(x))}
                </details>
              ) : null}
            </div>
          ) : null,
        )}
      </div>
      {pop ? <LinePop line={pop} paidAt={paidAt} close={() => setPop(null)} /> : null}
    </section>
  );
}

/** 📎 2 · next $75 11/30 — after a line's name when it has files or payments. */
function LineBadge({ fkey, paidAt }: { fkey: string; paidAt: Record<string, string> }) {
  const { files, next } = useExtrasBadge(fkey, paidAt);
  if (!files && !next) return null;
  return (
    <small className="ob-badge">
      {files ? `📎${files > 1 ? ` ${files}` : ""}` : ""}
      {files && next ? " · " : ""}
      {next ? `${usd(next.amount)} by ${md(next.due)}` : ""}
    </small>
  );
}

/** A Current liabilities line's own pop-out: amount (the sheet's or one found on a letter), payments, letters. */
function LinePop({ line, paidAt, close }: { line: OwedLine; paidAt: Record<string, string>; close: () => void }) {
  const store = useFindings();
  const f = findingOf(store, line.key);
  const sheet = line.sheetAmount ?? (f?.amount != null ? undefined : line.amount);
  const now = f?.amount != null ? f.amount : line.amount;
  const [amt, setAmt] = useState(f?.amount != null ? String(f.amount) : "");
  const saveAmt = () => {
    const n = Number(amt.replace(/[$,\s]/g, ""));
    setFinding(line.key, { label: line.name, amount: amt.trim() && Number.isFinite(n) ? n : undefined, checked: new Date().toLocaleDateString("en-CA") });
  };
  return (
    <Dialog label={line.name} onClose={close} className="sk-subpop ob-pop" backClassName="sk-subpop-back">
      <header className="sk-subpop-head">
        <Icon name="wallet" size={15} />
        <b className="sk-subpop-title">{line.name}</b>
        <button type="button" className="sk-btn is-small is-icon is-quiet" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="ob-pop-amt">
        <b>{usd(now)}</b>
        <small>
          {line.sheetAmount !== undefined || (f?.amount != null && sheet !== undefined)
            ? `owed · sheet says ${usd(line.sheetAmount ?? sheet)}`
            : "owed · from your sheet"}
          {line.note ? ` · ${line.note}` : ""}
        </small>
      </div>
      <div className="sk-subpop-row">
        <label className="sk-subpop-field">
          <span className="sk-cap">Amount on the letter (blank = use the sheet)</span>
          <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} onBlur={saveAmt} onKeyDown={(e) => e.key === "Enter" && saveAmt()} placeholder={line.sheetAmount !== undefined ? String(line.sheetAmount) : "Same as sheet"} aria-label="Amount found" />
        </label>
      </div>
      {f?.note ? <p className="sk-fd-hint">{f.note}</p> : null}
      <MoneyExtras fkey={line.key} label={line.name} paidAt={paidAt} />
    </Dialog>
  );
}

export function OutstandingView({
  file,
  marks,
  onOpen,
  onLetter,
  model,
  monthDues,
  paidAt,
  cell,
}: {
  file: DebtFile;
  marks: DebtMarks;
  onOpen: (id: string) => void;
  onLetter: (id: string) => void;
  model: MoneyModel | null;
  monthDues: BillDue[];
  paidAt: Record<string, string>;
  cell: CellView;
}) {
  const reg = file.registration;
  const days = reg ? daysUntil(reg.due) : 0;
  const owedDone = useOwedDone();
  const parts = outstandingParts(
    model,
    file,
    marks,
    monthDues,
    paidAt,
    owedDone,
  );
  return (
    <div className="mny-stack">
      <TicketBox
        title="MD tickets"
        tone="owed"
        kind="md"
        sources={mdSources(file)}
        marks={marks}
        onOpen={onOpen}
        head={
          reg
            ? `${reg.vehicle} · registration renews by ${md(reg.due)} (${days} days) — every flag must be cleared first. With flag = ticket + city/county flag fee + $${FLAG_FEE} MVA fee.`
            : undefined
        }
        foot={
          <>
          <RegClear file={file} marks={marks} onOpen={onOpen} />
          {file.letters.length ? (
            <div className="dbt-letters ob-letters">
              <small>Letters:</small>
              {[...file.letters]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="dbt-letter"
                    onClick={() => onLetter(l.id)}
                  >
                    <b>{md(l.date)}</b>{" "}
                    {l.from
                      .replace("MD Central Collection Unit", "CCU")
                      .replace("MVA Administrative Flag Unit", "MVA")}{" "}
                    <em>{usd(l.total)}</em>
                  </button>
                ))}
            </div>
          ) : null}
          </>
        }
      />
      <TicketBox
        title="Out-of-state tickets"
        tone="sub"
        kind="oos"
        sources={oosSources(file)}
        marks={marks}
        onOpen={onOpen}
        head="None block the MD registration. DC can boot a car with 2+ unpaid."
      />
      <div className="ob-cols">
        <OwedCol
          tone="due"
          title="Pay laters"
          cell={cell}
          onOpen={onOpen}
          paidAt={paidAt}
          groups={[["Pay later", parts.payLater]]}
        />
        <OwedCol
          tone="card"
          title="Cash advances"
          cell={cell}
          onOpen={onOpen}
          paidAt={paidAt}
          groups={[
            ["Cash advances", parts.cashAdv],
            ["Older advances", parts.advances],
          ]}
        />
        <OwedCol
          tone="plan"
          title="Taxes / Legal"
          cell={cell}
          onOpen={onOpen}
          paidAt={paidAt}
          groups={[["Taxes", parts.taxes]]}
        />
        <OwedCol
          tone="shop"
          title="Projects / Required"
          cell={cell}
          onOpen={onOpen}
          paidAt={paidAt}
          groups={[["Projects", parts.projects]]}
        />
      </div>
    </div>
  );
}
