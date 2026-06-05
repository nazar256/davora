# Agent Handoff

## Current Objective
- Improve Davora UX against the user's Nextcloud comparison feedback.
- Priority areas: mobile browse-first layout, action-first bottom sheets, focused/full-screen previews, compact preview/cache notices, and file details that do not consume prime preview space.
- Treat the user's newly added `.env` as sensitive. Do not print values. Use it only for real-backend validation when the UI pass is locally stable.

## Source Of Truth
- Design brief: `docs/FILE_MANAGER_REDESIGN_BRIEF.md`
- UI approval gate: `docs/UI_QUALITY_GATE.md`
- Current task backlog: `docs/TASKS.md`
- Progress log: `docs/PROGRESS.md`
- UX evidence/review: `docs/UX_REVIEW.md`
- Agent state JSON: `.agent/project-state.json`

## Current Work In Progress
- Changed `apps/web/src/styles.css` to reduce desktop rail weight, make preview stages use more viewport space, float preview notices, and improve mobile selected-item sheet behavior.
- Changed `apps/web/src/App.tsx` so preview mode is inferred from the selected file MIME type while content is loading.
- Changed `apps/web/tests/screenshots.spec.ts` so preview screenshots wait for actual PDF/image preview content or fallback before capture.
- Changed mock image data and viewer MIME ordering so `image/svg+xml` remains an image preview instead of being misclassified as text.
- Refreshed screenshot artifacts under `docs/screenshots/`.
- Latest screenshot review shows the focused image preview rendering large image content and the mobile selected-item sheet showing the complete action set without metadata overlap.

## Validation Already Run On 2026-06-05
- `npm run typecheck`: passed.
- `npm test`: passed.
- `npm run build`: passed.
- `PLAYWRIGHT_CHROME_EXECUTABLE=/usr/bin/chromium-browser npm run test:screenshots`: passed after using system Chromium.
- `npm run validate:real`: passed using the project-root `.env` credentials, constrained to `.davora-agent-test`.
- Headed Chromium launch: `chromium-browser http://127.0.0.1:4173/` opened in an existing browser session.
- Separate Chromium/CDP launch: `chromium-browser --user-data-dir=/tmp/davora-chrome-cdp --remote-debugging-port=9222 http://127.0.0.1:4173/` is running, and `curl http://127.0.0.1:9222/json/version` returned Chrome/CDP metadata.
- `npm run test:pwa` was not rerun because the active dev server occupies Worker port `8787`, which the PWA config also requires with `reuseExistingServer: false`.

## Browser/Runtime Notes
- Local dev server was started with `npm run dev` under approval and served:
  - Worker: `http://127.0.0.1:8787`
  - Web: `http://127.0.0.1:4173`
- Sandbox blocks binding local ports; use approved/escalated `npm run dev` for live browser work.
- System browser exists at `/usr/bin/chromium-browser`; `/usr/bin/google-chrome` is not present.
- Playwright's downloaded browser cache is missing, so use `PLAYWRIGHT_CHROME_EXECUTABLE=/usr/bin/chromium-browser` unless installing Playwright browsers.

## Required Next Steps
1. Continue manual/headed review with the user if they want to inspect the open browser.
2. Re-run screenshot capture after any further CSS/mock-data changes.
3. Update `docs/UX_REVIEW.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, and `.agent/project-state.json` whenever state changes materially.
4. Commit each stable working state.

## Guardrails
- Do not broaden product scope into OAuth, sharing, favorites, deleted files, generic WebDAV, or generalized bulk move/copy/delete.
- Preserve the security boundary: browser never stores raw Nextcloud app passwords and never talks WebDAV directly.
- Future backend state requires explicit documentation of the runtime failure and why browser-local/stateless alternatives are insufficient.
- UI quality claims require browser-rendered evidence, not only code inspection.
