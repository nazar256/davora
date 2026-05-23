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
- (pending) Packet 11 / Item 38
- (pending) Packet 11 / Item 37
- (pending) Packet 12 / Item 39
- (pending) Packet 12 / Item 40
- (pending) Packet 12 / Item 41
- (pending) Packet 12 / Item 44
- (pending) Packet 13 / Item 42
- (pending) Packet 13 / Item 43
- (pending) Packet 13 / Item 45
