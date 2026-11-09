# AGENTS.md — Randy's Life Hub (repo `frontier-next`)

Read this whole file before you touch anything. Randy uses this site every day with his real money,
tasks and debts in it. A careless push breaks his live site and can write wrong data into his Google Sheet.

## What this is
- React + TypeScript + Vite single-page app, deployed to GitHub Pages.
- **Live:** https://randymcfarland1227-wq.github.io/frontier-next/
- **A push to `main` IS a live deploy, with writes ON** (the site edits his Radall Google Sheet and his
  Cloudflare cloud backup). There is no staging.
- `CLAUDE.md` describes the older `frontier` repo; the rules there still apply, but its URLs are old.
  `LIFE_HUB.md` explains how the pieces work (newest notes at the bottom).

## Hard rules (do not break these)
1. **Work on a branch and open a PR. Never push to `main`.** Randy (or his Claude chat) merges.
2. **Never touch his data.** Don't edit, clear or "clean up" localStorage, the Worker backup
   (`/api/state`, `/api/debts`), the Radall sheet (id `19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk`),
   TickTick or Move OS. Don't mark anything paid, done, hidden or deleted for him.
3. **Never read, print or handle his backup / sync key.**
4. **Don't deploy anything else:** no `wrangler` / `npm run deploy` (Worker), no `clasp` (Apps Script
   in `apps-script/`). If a change needs those, stop and say so in the PR.
5. **Don't rewrite or reformat big files.** `app/components/MoneyPage.tsx` is very large; make small,
   targeted edits. No mass renames, no prettier runs over the repo, no dependency upgrades.
6. **Merges only combine.** `lib/syncState.ts` runs on both the Worker and the browser; never add code
   that overwrites the backup. Only real completions count (`isRealCompletion`).
7. **Every new localStorage key must be listed in `lib/dataRegistry.ts`** (with `backup: 'cloud' |
   'device' | 'cache'`), or `npm run check` fails.
8. Ask (in the PR description) before changing product decisions: wording Randy chose, area ids in
   `public/data/focus-areas.json` (ids never change), money rules, what counts as overdue/paid.

## Before you open the PR (all must pass)
```
npm ci
npm run check        # tsc + lint baseline (3 errors / 3 warnings already known — don't add any) + saved-keys + class names + tests
npm run build:pages
```
Say in the PR exactly what you changed, what you tested, and what you could NOT test.

## Money logic that is easy to get wrong
- **Subscriptions:** a sub's sheet row holds its LAST charge date. This month's charge is a projected
  copy (`projected: true` in `lib/money.ts`). A sub row dated in an earlier month is history, not
  overdue (`moneyDues`). Paying a sub crosses out its sheet row (`crossOffEdit`).
- **Hub subscriptions** (`lib/lifeSubs.ts`): charges dated before the sub was added don't count.
- **Taxes / Legal** (`app/components/OutstandingView.tsx` `outstandingParts`): private debt file
  liability items + hand-added `own:` items from `lib/finFindings.ts` (e.g. the two Monongalia County
  tax tickets, which step up each month via `schedule`). Totals skip `unverified` items — keep it that way.
- **Sheet writes** go through the Mail Sync Apps Script (`apps-script/LifeHubMoney.gs`, ops like
  `addRows`). Don't change cell positions or sheet block names; the sheet layout is fragile.
- **Site tab tasks** come from each site's snapshot (`lifehub-source-snapshots`). Hiding a task on Life
  Hub (`lib/siteMoves.ts` `removeItem`) never changes the source site.

## Randy's style rules
- Plain words, no jargon. No walls of identical boxes. Item text first; tools go in right-click /
  long-press menus. Money "at a glance" bar is never sticky. No pure white backgrounds.
- No half-finished features: if you can't finish something, leave it out and say so.
