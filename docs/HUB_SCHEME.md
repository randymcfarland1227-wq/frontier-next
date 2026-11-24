# Life Hub — how it works today (scheme for Codex)

Written 2026-11-23 from `main` @ d9bc3d0 so another agent (Codex) can make changes without re-discovering
the app. Read `AGENTS.md` first for the hard rules (branch + PR, checks, money logic). `LIFE_HUB.md` is the
older change log; this file is the current map.

---

## 1. The big picture

```
 ┌──────────── Sources (11 "sites") ─────────────┐        ┌──── Planning layer (Life Hub's own) ────┐
 │ ticktick  radall  gmail  outlook  resale       │        │ Goals (Why)  ← Goals hub / Flow          │
 │ role  candle  income  move  repair  self       │        │ Ongoing goals  (direction cards)         │
 │  (lib/sources.ts, lib/adapters/*)              │        │ Short-term focus cards (projects)        │
 └───────────────┬───────────────────────────────┘        │   └ sub-lists (tasks/pay/buy/notes/habits)│
                 │ snapshots (tasks, featured, metrics)    │ Site lists  (task groups inside a site)  │
                 ▼                                         │ Doing Now: On deck → Action list (+mixes)│
        ┌─────────────────────┐   links (pin keys)        └──────────────┬──────────────────────────┘
        │  Task pool per site │◄─────────────────────────────────────────┘
        └─────────┬───────────┘
                  │ complete / star / move / hide
                  ▼
   Completion ledger (lib/completions.ts) ──► Balance (lib/energy.ts, focusAreas.ts) ──► Daily Brief
                  │
                  ▼
   Cloud backup: browser localStorage = working copy, Worker KV `/api/state` = merged copy (lib/syncState.ts)
```

- **Frontend**: React + Vite, GitHub Pages (`vite.github.config.ts`, `.github` deploy). Entry `app/life-hub.tsx`,
  shell `app/sticker/StickerShell.tsx`.
- **Worker** `frontier-work-room` (`worker/index.ts`, `wrangler.jsonc`, deploy `npm run deploy`): holds synced
  state, secrets (TickTick token, mail key), the debts file (KV `debt-file`), files, carrier tracking.
- **Apps Scripts** (`apps-script/`): push Google Sheet / Calendar / Gmail data into the Worker (e.g.
  `LifeHubSchedule.gs` every 10 min → `/api/schedule/snapshot`).
- **Pinned key**: every task anywhere is addressed as `source:id` (a "pin key"). Links between layers store
  pin keys, never copies — checking a linked row checks it on its home site.

## 2. Pages and tabs

Top pages (`StickerShell.tsx` `PAGES`): **Home**, **Money**, **Logs** (nutrition/movement, Marvel, music),
**Why** (summary, Flow, goals + attached work).

Home's **Today** tabs (`app/components/HomeView.tsx` `TODAY_TABS`):
| Tab | What it is | Main code |
|---|---|---|
| Daily Brief | What needs you today (see §7) | `lib/dailyBrief.ts`, `DailyBrief.tsx` |
| Daily Rhythm | Day-scoped routine cards (reset each day) | `FocusSection.tsx` |
| Short-term focus | Project cards: Right now / Next few weeks | `FocusSection.tsx`, `FocusCards.tsx` |
| Goals | Ongoing goals + Goals hub goals, grouped by type | `GoalsView.tsx`, `lib/goals.ts`, `lib/goalTypes.ts` |
| Calendar | Google Calendar + bill dues | `CalendarView.tsx`, `lib/schedule.ts` |
| Grounding | Alignment boxes/affirmations (from TickTick Grounding reminders) | `DailyGrounding.tsx`, `lib/alignment.ts` |
| Money | Money boards inside Today | `MoneyBoards.tsx` |
| Sites | One tab per source with its task pool | `app/sticker/Sites.tsx` |
| Worksheet | Scratch rich-text docs | `Worksheet.tsx`, `lib/worksheets.ts` |

Plus **Doing Now** (priority workstation, `PriorityBoard.tsx` / `PriorityPanel.tsx`) and the Home top strip
(`HomeTop.tsx`: Short-term Focus count, etc.).

## 3. The four levels of "work" — goal → focus → list → task

### 3a. Goals (long term, "Why")
- **Source of truth is outside Life Hub**: the Goals hub (live via its Apps Script, fallback
  `public/data/goals.json`). `lib/goals.ts` **never writes goals** — only `GoalLink`s that attach existing work
  (TickTick, Self, captures) to a goal (`role: drives | supports | blocks`).
- **Active vs passive** (`lib/goalModes.ts`): from Flow — a goal with "drive" routines = Active, only
  upkeep/enable = Passive. Randy's one-tap override is synced as `goalModes`.
- **Momentum**: `goalMomentum()` in `lib/goals.ts` from linked completions.

### 3b. Ongoing goals (directions, Life Hub's own)
- `lib/ongoingGoals.ts`, key `lifehub-focus-ongoing`. Made from Self's capture box ("sourcing income" for Move OS).
- Same `Entry` shape as focus cards with `ongoing: true`; `inFocus: true` also shows it in Short-term focus
  (same record, edits mirror). `goalType` groups it on the Goals tab.
- Can link TickTick habits/recurring tasks (`lib/goalLinks.ts`) → "done today / x of last 7 days".

### 3c. Short-term focus cards (= "projects")
- Stored as `Entry[]` in `lifehub-focus-now2` (Right now) and `lifehub-focus-weeks2` (Next few weeks).
  Type `Entry` is in `app/components/FocusSection.tsx` (~line 91). Synced per card via `lib/focusSync.ts`
  (`"<list key>::<card id>"`, newest wins, tombstone on delete).
- A card has: `title`, `note` (scope), `why`, `site` (colours it), `since`/`date` countdown, `priority`
  (`lib/focusPriority.ts`, red/yellow/green), `refs` (links/files → `lib/focusRefs.ts`, files in Worker
  `/api/files`), `section` (Home focus section), and **`lists: SubList[]`**.
- **SubList kinds** (`SubListKind`): `tasks` (default, counts toward %), `pay`, `buy`, `notes` (bullets, no %),
  `habits` (shows today's TickTick habit state via `habitId`).
- **SubTask** can be plain text, or a link: `pin` (a site task — stays on its site, checking here checks
  there), `fin` (read-only Finance row), `fills` (research that fills a Finance amount), `after` (locked until
  another step is done), `due`, `note`.
- Card can also link `siteLists` (whole site lists) and `siteTasks` (single site tasks) and `fin` lists.
- "Project" = a focus card: `lib/selfProjects.ts addSelfProject()` writes into `lifehub-focus-now2`;
  `lib/projectContinuation.ts` archives a finished project and appends its successor (`continuedFrom/As`),
  keeping unfinished links.
- Which cards a site task is linked into: `lib/focusLinks.ts` (shows "◎ Financial Auditing" on site rows).

### 3d. Site lists (middle rung inside one site)
- `lib/siteLists.ts`: a list groups tasks from **one** site. Its tasks leave the site pool and the list appears
  in that site as one row ("Storefront · 3 left"). A goal/focus card can link a list; then it stays in the
  pool too. Synced map id → list, `gone: true` tombstone.

### 3e. Tasks — single vs list vs project (as Randy uses the words)
| Word | Where it lives | Notes |
|---|---|---|
| **Single task** | A row in a site's pool (`source:id`) or a Self task | Can be pinned to Doing Now, starred, coloured, tagged, moved, hidden |
| **List** | Site list (§3d) *or* a SubList on a focus card | Site list = grouping inside one site; SubList = steps of a project |
| **Project** | Short-term focus card (§3c) | Has lists, refs, why, countdown, priority |
| **Linked subtask** | `lib/linkedSubtasks.ts` | A task linked under another task: stays on its site on a "Linked to a task" shelf and leaves all counts — only the parent counts |

Per-task metadata (all cloud-synced, newest change wins):
- Bucket + goal rule: `lib/taskRules.ts` (keyed by source + task name, so recurring copies land the same; source-wide fallback rule).
- Type tag ("Items to buy", "Subscriptions"…): `lib/taskTags.ts`.
- Red/yellow/green + Critical: `lib/featuredLevels.ts`.
- Life Hub star (for TickTick, Radall, Gmail): `lib/hubStars.ts`.
- Remove / move to another site: `lib/siteMoves.ts` (`hidden` map; move turns non-Self items into Self tasks homed elsewhere).
- Captures (ideas/research/voice memos — **not** tasks until promoted): `lib/captures.ts`, `CapturesPanel.tsx`.
- Maybe-plans (not yet committed): `lib/plans.ts`.

## 4. Doing Now (priority workstation)
- `lib/priorityPins.ts`: one map `source:id → { lane, order, at, note?, before? }`.
  Lanes kept from old names: `'now'` = **On deck** (grouped by site), `'next'` = **Action list** (ordered).
- Each pin can carry a plan note and a **"Before this"** list (blockers).
- **Mixes**: named groups on the Action list (`createMix`, `addToMix`, `leaveMix`, `endMix`).
  `autoShipMix()` auto-groups every "Ship …" row into the mix **"Items to ship"** (`auto:'ship'`);
  "Remove from this list" sets `ownRow` so it stays single.
- Focus-card lists/tasks can be sent here: `lib/focusPins.ts` ids `flist:<code>:<card>:<list>` and
  `ftask:<code>:<card>:<list>:<task>` (card stays the only record). Brief rows with no site item pin as
  `self:brief:<id>`.
- Self project rows and the shared project pop-out offer **Add to On Deck**. Finance-only, linked-only
  and empty active projects use the same `self:fcard:<code>:<id>` identity; no Self task is copied.
  From On Deck the existing menu moves the project to Action List. A project opens its full editor;
  it has no bulk-Done circle in Doing Now/Daily Brief/Today's List. Take off Doing Now only unpins it.
- `openTaskPanel(pinKey)` from any card opens the item's panel in Doing Now.

## 5. TickTick (tasks + habits)
- Token lives only on the Worker. Client calls: `lib/ticktickComplete.ts` → `/api/ticktick/complete`,
  `/wontdo`, `/habit-checkin`, `/habit-skip`, `/habit-count`, `/open`; `/api/ticktick/done` = completed list.
- `lib/ticktickLive.ts`: TickTick card = TickTick's Today view (open tasks due ≤ today + habits due today not
  checked in; reminders/reference notes left out).
- `lib/ticktickDone.ts`: counts work finished inside TickTick from its own completed list + habit check-ins
  (postponed never counts; once per day; quick re-ticks = one catch-up).
- `lib/tickTickToday.ts`: today's items by title pattern (used by Daily Rhythm/Grounding rows), with
  skipped/won't-do marked (`off`).
- Habits show on focus cards via `habits` SubLists and on ongoing goals via `lib/goalLinks.ts`;
  `habitDueOn()` in `lib/energy.ts` knows the schedule.
- Flow ↔ TickTick catalog: `/api/flow/ticktick/catalog` and `/apply`, review UI `FlowSyncReview.tsx`,
  `lib/flowMigration.ts` (review-first, never creates/removes completions).
- Write-back UI: `TickTickWriteBack.tsx`.

## 6. Connecting to the sites
- Each source has an adapter in `lib/adapters/<id>.ts` turning its data into a snapshot (tasks, featured,
  metrics). Static connector JSON in `public/data/` (`lib/connectors.ts`); live feeds through the Worker:
  Gmail (`/api/gmail/snapshot`, `/unstar`), Radall/Money (`/api/radall/snapshot`, `/api/money/snapshot`,
  `/api/money/edit`), Role Hub (`/api/role/snapshot`, `/complete`), schedule, packages (`/api/packages/mail`,
  `/api/track`), debts (`/api/debts`).
- Embedded sites talk over **postMessage** (`lib/protocol.ts`; inbound/outbound spec in `LIFE_HUB.md`
  "postMessage protocol").
- Completing on Life Hub: writes the ledger, then calls the source where supported (TickTick, Role, Gmail
  unstar); other sites stay read-only and Life Hub remembers "done" locally (`restoreReopenedSnapshots`).
- **Undo on Life Hub** keeps an explicit undo marker and can restore the saved task locally once.
  Refresh projection only reopens rows the source still supplies; a missing source row is not recreated.
  Restored rows also restore their applicable open counts. A fresh source open/blocked report after Undo,
  followed by a newer done report, counts as a new completion even without a completion timestamp.
  The acknowledgement is a registered device cache; the existing completion/undo merge remains unchanged.
  Undo does not reverse an action already sent to another site; TickTick retains its separate rules.
- **Project bill links** missing from current dues stay unverified and carry forward until payment is
  confirmed by the exact active Radall due-key completion. Missing data alone never means paid.
- **Self** is Life Hub's own site (`lib/adapters/self.ts`): Self tasks, voice memos inbox, projects.
- Site pool UI: `app/sticker/Sites.tsx` (preview 6 rows, 4 stars); counts `lib/actionable.ts`.

## 7. Daily Brief
- `lib/dailyBrief.ts` (pure, so a routine report reads the same list) — `buildBrief()` sections:
  Money overdue/due today · Tasks due today & overdue · Mail needing you · Roles replies & next steps ·
  Sold & selling to do.
- `briefBuckets()` regroups into the UI buckets: **Do today** (ship, pay, reply, do; overdue grouped),
  **This week** (next 7 days, other mail grouped), **Focus next steps** (next open task per focus card).
- Do today hides ship rows already on the Action list (`withoutActionListRows`).
- `useBriefPush()` / `briefPayload()` push it to the Worker `/api/brief` (for routines / other devices).

## 8. Balance (is life in balance?)
- `lib/focusAreas.ts`: maps completions to life buckets (focus areas) via source rules + task rules.
- `lib/energy.ts`: per bucket per day — **Progress** (Charge / In-Line / On-Fire, done ÷ pace goal from what
  was available) and **Focus** (Under / Balanced / Over vs fair share). Aim: all In-Line + Balanced.
  `bucketSuggestions()` proposes what to do next.

## 9. Money (biggest area)
- `MoneyPage.tsx` (4.3k lines), `MoneyBoards.tsx`, `lib/money.ts`. Data from Randy's Google Sheet via the
  Worker. Debts/collections/pay-laters = KV `debt-file` (`lib/debtFile.ts`, `DebtFile.tsx`). Bills edits
  `lib/billEdits.ts`, balancing sheet `lib/balancePicks.ts`, card payoff `lib/cardProjection.ts`, assets
  `lib/assets.ts`. Read the money section of `AGENTS.md` before touching any of it.

## 10. Storage + sync rules (break these and data is lost)
- Every saved key must be registered in `lib/dataRegistry.ts` as `cloud` / `device` / `cache`;
  `scripts/check-saved-keys.mjs` fails the build otherwise.
- Cloud merge is in `lib/syncState.ts` (shared by Worker and browser): merges only combine, newest change per
  key wins, deletes leave tombstones (`gone`, `entry: null`). Never "replace" synced state.
- Seeded records are stamped with the epoch so a seed never beats a real edit.
- Cross-component refresh is by window events (e.g. `FOCUS_LIST_EVENT`, `lifehub:unpay-bill`,
  `lifehub:open-project`) — fire the event after writing a list so mounted views re-read.

## 11. Where to change X
| Change | Start here |
|---|---|
| What a focus card/project holds | `Entry`, `SubList`, `SubTask` in `FocusSection.tsx`; rendering in `FocusCards.tsx` |
| How tasks/lists/projects link | `lib/siteLists.ts`, `lib/linkedSubtasks.ts`, `lib/focusLinks.ts`, `lib/focusPins.ts` |
| Goals tab / goal grouping | `GoalsView.tsx`, `lib/goals.ts`, `lib/goalTypes.ts`, `lib/goalModes.ts`, `lib/ongoingGoals.ts` |
| Doing Now / Action list / mixes | `lib/priorityPins.ts`, `PriorityBoard.tsx`, `PriorityPanel.tsx` |
| Daily Brief rows/sections | `lib/dailyBrief.ts`, `DailyBrief.tsx` |
| TickTick habits/tasks behaviour | `lib/ticktick*.ts`, `lib/tickTickToday.ts`, `lib/goalLinks.ts`, Worker `/api/ticktick/*` |
| A site's rows | `lib/adapters/<site>.ts`, `app/sticker/Sites.tsx` |
| Today tabs order/names | `TODAY_TABS` in `HomeView.tsx` |
| New saved data | add key to `lib/dataRegistry.ts`; if cloud, add merge in `lib/syncState.ts` |
| Worker route | `worker/index.ts`, then `npm run deploy` |

## 12. Known overlaps / rough edges (good candidates for the redesign)
- "Goal" means three things: Goals-hub goals (read-only), ongoing goals (Life Hub cards) and Flow goals
  (active/passive). They're joined only by links and `inFocus`, not one model.
- "List" means two things: site lists (inside one site) and SubLists on a focus card.
- Short-term focus, ongoing goals and Daily Rhythm all reuse the same `Entry` record with flags
  (`ongoing`, `inFocus`, `section`) — easy to show one card in two places by accident.
- Doing Now (On deck/Action list) is a fourth way to group work, separate from site lists and focus cards.
- Undo Paid only covers this month's view; MDTA flag row stray "· ?" (`splitFinText`) unfixed.
- Big files to split before large changes: `MoneyPage.tsx`, `FocusCards.tsx`, `MoneyBoards.tsx`,
  `Sites.tsx`, `worker/index.ts`.
