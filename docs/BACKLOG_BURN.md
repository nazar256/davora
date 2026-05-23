# Backlog Burn Plan

This document is the execution tracker for closing the currently recorded open backlog in this repo.

## Scope (Source of Truth)
- In scope: `docs/TASKS.md` items **35–45** (currently marked `PENDING`).
- Out of scope: new work not already recorded in `docs/TASKS.md` (record it first, then decide whether it belongs in a future packet).

## Working Rules (Must Follow)
- Work is **sequential by default**; parallelize only when definitely harmless.
- Each stable working state is committed to git.
- UI/UX claims require browser-rendered evidence (see `docs/UI_QUALITY_GATE.md`).

## Definition of Done (Per Backlog Item)
Mark an item `DONE` in `docs/TASKS.md` only when all of these are true:
1. Implementation is complete and merged into a stable working state on `main`.
2. Validation is green:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e` when UI behavior changes (plus screenshots refresh if applicable).
3. Docs are updated truthfully:
   - `docs/TASKS.md` status + short evidence note.
   - `docs/PROGRESS.md` dated entry for the work.
   - `docs/HANDOVER.md` updated only if operator workflow or constraints changed.
4. A milestone commit exists for the completed work.
5. Production deploy is completed via `npm run deploy` for that milestone.

## Packet Execution Order (Current Plan)

### Packet 11
- Item 35: root folder chosen per account during the connection flow.
- Item 38: downloads/non-viewable file downloads work on Chrome Android.
- Item 37: background transfer status UI (fixed space, multi-task, overflow, progress).

### Packet 12
- Item 39: audio player remembers position (best effort).
- Item 40: uploading multiple files and directories.
- Item 41: downloading multiple files/directories (directories may zip client-side).
- Item 44: remove the app name from the in-app chrome to free space.

### Packet 13
- Item 42: clarify/revisit the server-side secret requirement (ADR + docs decision).
- Item 43: one more OSS/publish readiness review round.
- Item 45: team visual/manual test-review loops (documented and repeatable).

## Milestone Log
Append one line per milestone commit + deploy.
- 2026-05-23 Packet 11 / Item 35: commit `0f02a2c` deployed. Worker version `f46cb900-1501-4026-87ea-7a77a4133dbb` at `https://davora.xyofn8h7t.workers.dev`; Pages deploy `https://38a5c5aa.davora.pages.dev`.
- 2026-05-23 Packet 11 / Item 38: commit `f938a46` deployed. Worker version `cec47b53-d34f-4db2-971c-831ef83affc0` at `https://davora.xyofn8h7t.workers.dev`; Pages deploy `https://000c3ab4.davora.pages.dev`.
- 2026-05-23 Packet 11 / Item 37: commit `48901e5` deployed. Worker version `c50da9bb-1b48-4984-9375-3c205ee94663` at `https://davora.xyofn8h7t.workers.dev`; Pages deploy `https://a9f2b738.davora.pages.dev`.
- 2026-05-23 Packet 12 / Item 39: stable product commit `edff0d0` was included in successful deploy of current HEAD `bf63583`. Worker version `f07e6c6c-df42-42ca-bbfe-b6f2c47e8af6` at `https://davora.xyofn8h7t.workers.dev`; Pages deploy `https://55ec9dfd.davora.pages.dev`.
- (pending) Packet 12 / Item 40
- (pending) Packet 12 / Item 41
- 2026-05-23 Packet 12 / Item 44: stable product commit `edff0d0` was included in successful deploy of current HEAD `bf63583`. Worker version `f07e6c6c-df42-42ca-bbfe-b6f2c47e8af6` at `https://davora.xyofn8h7t.workers.dev`; Pages deploy `https://55ec9dfd.davora.pages.dev`.
- (pending) Packet 13 / Item 42
- (pending) Packet 13 / Item 43
- (pending) Packet 13 / Item 45
