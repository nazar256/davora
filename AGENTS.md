# Davora Agent Guide

This file contains durable repository rules and architectural knowledge. Do not use it to track active tasks, phase progress, validation results, current commits, deployments, or next actions.

## Where state belongs

- Active long-running goal plans and resumable progress: ignored `.tmp/plans/` files named by the user or current goal.
- Machine-readable project/deployment state: `.agent/project-state.json`.
- Product task state: `docs/TASKS.md` and the approved tracker workflow.
- Engineering progress and historical decisions: `docs/PROGRESS.md` and `docs/HANDOVER.md`.
- Test/deployment evidence: `docs/TESTING.md`.
- UX evidence: `docs/UX_REVIEW.md`.
- Backlog/release history: `docs/BACKLOG_BURN.md`.
- Architecture and dependency rules: `docs/ARCHITECTURE.md`.
- Stable behavior invariants: `docs/BEHAVIOR_CONTRACT.md`.
- UI acceptance rules: `docs/UI_QUALITY_GATE.md`.

After compaction, read this guide and the active goal/session source. Do not infer current progress from this file.

## Product architecture

- Davora is an npm workspace containing a React/Vite PWA, a Cloudflare Worker/Node local server, and a shared TypeScript package.
- The browser talks only to Davora's normalized Worker API. It must never call WebDAV directly or store raw Nextcloud app passwords.
- The Worker owns account validation, browser ownership, account-bound sessions, sandbox-path enforcement, and Nextcloud credentials.
- Browser persistence may contain non-secret account metadata, browser-ownership material, opaque sessions, and account-namespaced cache data.
- Deployed account material is encrypted and persisted through the existing Worker account-store abstraction; local development uses the documented local encrypted store.
- Backend state must remain minimal. Any new backend persistence requires a documented concrete runtime failure, rejection of safer stateless/browser-local alternatives, explicit retention/cleanup semantics, and security review.
- Explicit offline mode is a network gate, not merely a UI flag: it restores before startup effects, permits zero backend requests, aborts active work, closes streaming surfaces, and exposes only readable local content plus required ancestors.
- Kept-offline data is distinct from evictable cache accounting and normal cache clearing. A retained record always holds the file's true original bytes: cache/preview refresh writes for member paths must persist original material, never derived preview output.
- Large media streams through short-lived path/account-bound Worker URLs with range support; browser credentials and reusable sessions do not belong in media URLs.

## Change design rules

- Prefer explicit behavior, naming, wiring, and fallbacks over clever indirection.
- Preserve no-op behavior when an optional capability or setting is disabled.
- Organize new/refactored code by vertical feature ownership. Keep models pure, effects behind explicit ports, views declarative, and adapters at platform boundaries.
- Cross-feature code may use only public feature APIs or explicit app-coordination events.
- Keep workflow lifecycle state feature-owned. A global surface/navigation mechanism may route ordered dismissal but must not become a global workflow store.
- Use structurally typed adapters checked at the composition root; do not reverse dependency direction by importing feature internals into platform modules.
- Runtime-validate external and persisted data before it becomes trusted application state.
- Make invalid workflow states difficult to represent with discriminated unions, exhaustive transitions, and normalized/branded internal identifiers where appropriate.
- Every request, timer, listener, object URL, render task/worker, media element, IndexedDB transaction, popup, and wake lock needs an explicit, tested owner and termination path.
- Do not introduce new frameworks or global stores for rearrangement alone. Require evidence that the existing platform or local reducers/controllers cannot express a concrete safe design.
- Consult the higher-reasoning architect subagent before consequential architecture, dependency-direction, state-ownership, or milestone-direction choices. Synthesize decisions and perform writes in the main thread.

## Behavior and security preservation

- Treat `docs/BEHAVIOR_CONTRACT.md` as the stable regression inventory. Add missing characterization before moving the owning slice.
- Preserve account/browser isolation, URL and Back behavior, cache/offline semantics, mutation safeguards, transfer terminality, preview/media behavior, PWA/theme behavior, accessibility, and Worker trust boundaries.
- A refactor does not silently improve ambiguous product behavior. For a clear defect: gather context, understand, reproduce, add a regression test, fix the cause, validate the test, then validate real behavior.
- Secrets must never appear in logs, documentation, screenshots, test output, URLs other than designed short-lived tokens, or browser persistence.
- Treat `.env` as sensitive. Use it only through repository commands that require configured real-backend validation; never print or snapshot its values.
- Real-backend validation must remain constrained to `.davora-agent-test`.
- Mock-only reset behavior must remain unreachable in production configuration.
- Use Linear only through the repository's authenticated `mcpproxy` CLI transport and only when tracker work is explicitly in scope.

## Workspace and release hygiene

- Preserve pre-existing tracked and untracked user changes. Never reset, restore, stage, stash, clean, or broadly format them implicitly.
- Inspect status before edits and keep new work distinguishable from the starting baseline.
- Put every temporary/generated/session artifact under ignored `./.tmp/` in the repository.
- Never use `rm` or `rmdir`; move retired files to `.tmp/trashbin/<date_hour>`.
- Do not create ad-hoc scripts in the project root or tracked source directories. Prefer repository tooling; when a custom script is necessary, keep it in `.tmp` and prefer Go.
- Do not commit, push, change tracker state, or contact external systems unless the user or active workflow explicitly authorizes that action. Exception: production deploy (`npm run deploy`) is pre-authorized once the work is complete and all relevant validation gates pass — deploy when confident in completion without asking.
- Before any authorized release, audit the complete diff, untracked files, staged scope, secrets, generated artifacts, and required evidence.

## Testing and evidence

- Follow TDD when applicable: characterize or reproduce first, then change implementation, then run focused and broader gates.
- Prefer fast focused automated tests. Slower comprehensive automation is acceptable when it adds meaningful coverage.
- Optimize agent input/output cost rather than wall-clock time: use RTK dedicated filters, compact failure-only output, machine-readable summaries, and ignored `.tmp` reports.
- Do not stream successful per-test logs when pass/fail/count/timing is sufficient.
- Prefer model/property/contract tests, deterministic fakes, browser state/geometry assertions, and screenshot/hash comparison over manual quick checks.
- Reserve manual browser inspection for visual qualities that cannot be asserted reliably; UI quality claims still require browser-rendered evidence under `docs/UI_QUALITY_GATE.md`.
- Diagnostic inbox reports are handled end-to-end: after a report's fix is deployed and verified, always delete it via `npm run diagnostics:inbox -- clear --report <uuid>` so the inbox only ever contains unhandled reports.
- Screenshot capture writes `docs/screenshots`; isolate it when the active workflow requires preserving an existing dirty evidence baseline.
- The system browser is normally `/usr/bin/chromium-browser`. Browser suites may require permission to bind localhost ports and launch Chromium.
- Regular Playwright and screenshot suites share local ports and must run sequentially. PWA and ordinary dev servers also have documented port conflicts in their configs.
- Never weaken, skip, or delete a test merely to make a refactor pass. Remove old coverage only after equivalent or stronger evidence is mapped and green.
- Completed work contains no TODOs, stubs, placeholders, unexplained disabled tests, dual implementations, or compatibility shims without an owner and removal condition.

## Documentation policy

- Keep this file concise, durable, and free of chronological ticket/deployment logs.
- Update it only when a long-lived repository rule, architectural boundary, or stable workflow changes.
- Put transient execution facts in the active goal/session file and supported project-state/history documents instead.
