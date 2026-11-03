# Life Hub design scale (read before changing any layout)

One set of rules so sections stop drifting. The code is in the last block of `app/sticker/sticker.css` ("Design scale").

## 1. Three densities (text + row size)
| Class | Use | Title / headline / body / label / secondary / caption |
|---|---|---|
| `.sk-d-comfy` (also `.sk-money-tab`) | full pages | 22 / 17 / 16 / 15 / 14 / 12 |
| `.sk-d-compact` (also `#sk-brief`, `#sk-focus`, `.sk-src`, `.sk-dense`) | panels: Today, Daily Rhythm, site cards, Doing Now, All | 16 / 13 / 12.5 / 12 / 11.5 / 10.5 |
| `.sk-d-tight` (the calendar lists in a narrow pane) | split panes, phones | — / 11 / 10.5 / 10.5 / 10 / 9 |

Compact rows: ~40px with a 2nd line, 3px vertical padding, 18px circles. **Never set `--sk-title…--sk-caption` in a new block; add the section to a density instead.**

## 2. One panel recipe
Glass lives in variables (`--gl-panel-*`, `--gl-group-*`, `--gl-row-*`, light + dark) and is applied once to `#sk-brief` and `#sk-focus` (panel → `.sk-group` → `.sk-row`). A new glass area joins the `:is(...)` list; it does not copy the rules. Never use `var(--sk-paper)` as a solid fill inside glass (it is translucent there).

## 3. Long panes
Anything that can run long sits in `<CapPane cap="page|split">` (app/sticker/CapPane.tsx): capped height, own scroll, "more below" fade, keyboard-focusable. Split panes cap at 72vh (360–760px), full-width panes at 86vh. Pop-outs are `.sk-dialog` (max 85vh, scrolls).

## 4. Layouts follow their own box
`CapPane` is a container named `today-pane`. Use `@container today-pane (max-width: …)` for anything inside Today, not `@media`. States: wide, narrow (≤900px of the pane's own width, measured before page zoom: Money shows headline + totals, month shows dots, calendar lists in tight type), tight (≤560px: brief notes hidden).

## 5. Shared parts (use these; don't re-write them)
- `Dialog` (app/sticker/Dialog.tsx): portal, Esc, backdrop, focus **once** on open (`data-autofocus`).
- `SegTabs`: every tab row. `SearchPick`: type-to-find pop-up. `CapPane`: long panes. `ListHead` (kit): foldable heading.

## 6. Names
New features use a prefix and never reuse a name that exists. Scenery = `sk-sky-*` (checked by `scripts/check-class-names.mjs`). Before inventing a class: `grep -rn "sk-<name>" app`.

## 7. Saved data
Every saved key is filed in `lib/dataRegistry.ts` as `cloud`, `device` or `cache` (checked by `scripts/check-saved-keys.mjs`). Cloud lists keep a change time and leave a delete marker (`lib/focusSync.ts`).

## 8. Before shipping
`npm run check`, then `docs/SHIP-CHECKLIST.md`.
