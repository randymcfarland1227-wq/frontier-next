# Ship checklist (every change)
1. `npm run check` passes (types, lint baseline 3/3, saved keys filed, class names, tests).
2. Look at it in: single view · split view · phone width (≈390px) · day mode · night mode. No sideways page scroll; nothing cut off; long panes scroll inside their cap.
3. If it touched size: measure `getBoundingClientRect` heights before/after (site row ≈40, All row ≈41, On Deck row ≈34, focus card ≈88) and keep them.
4. If it saves anything: it is filed in `lib/dataRegistry.ts` and, if `cloud`, merged in `lib/syncState.ts`.
5. If it writes outside the browser (TickTick, sheet, Gmail, Worker): say so in the PR and test with one harmless item.
6. Restore any test data you created; close browser tabs.
7. Weekly: `/impeccable audit` and `/impeccable critique` on Today (single + split); save the notes with `/impeccable init`.
