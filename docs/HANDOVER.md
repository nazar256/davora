# Handover

## Source of truth and live input
- Active source of truth: current user mission plus this repo’s updated docs/state files.
- Live Nextcloud username used for validation: `ynvio`.
- Live Nextcloud base URL used for validation: `https://nextcloud.ownhost.top` unless overridden explicitly by env.
- Safe validation root is hard-pinned to `.davora-agent-test`.

## What v1 now delivers
- In-app Nextcloud account onboarding using base URL, username, app password, and optional label.
- Multiple connected accounts in one browser session with explicit active-account switching.
- Account-bound Worker sessions with encrypted worker-side account persistence in both local dev (`.tmp/local-dev/worker-state.json`) and deployed Cloudflare runtime (`DAVORA_ACCOUNT_STORE` Durable Object), plus reconnect-required handling only when persisted account state is truly unavailable.
- Browser-side file operations for the active account: create folder, upload (including drag-and-drop into the folder view), move/rename, copy, delete with explicit contextual confirmation dialogs.
- Browser-side file opening for the active account: text, markdown render + raw fallback, image/audio/video from original file content, PDF embed with open/download fallback, direct-download fallback for unsupported file types, muted inline autoplay for video preview so autoplay remains browser-compatible, and gallery-style next/previous overlays with one-ahead media prefetch.
- Browse-first workspace with a lighter persistent shell: minimal online/offline status and a `Profile & settings` entry point, with account switching/details hidden behind that one-click surface instead of repeating the selector on every page.
- Opened-file cache with separate metadata/blob tracking, configurable byte limit, deterministic LRU eviction, offline reopen after reload, account-aware namespacing, a slider + manual MB cache-limit control, and a separate max-cacheable-file-size control that defaults to 15 MB.
- File sizes default to human-readable units and can be switched between Human readable / KB / MB / GB from the main workspace header.
- Honest offline behavior: cached reads available, mutations disabled, explicit stale/permission/error/loading states.
- Installed-PWA offline relaunch now reuses the cached shell and account-scoped folder caches even without a live token, so the standalone app remains usable when the server is down.
- Optional unlock-code gate now appears after account connection but before account session creation.

## Operator notes
- Start from `README.md` for local setup, env examples, mode selection, validation commands, the dedicated `rtk npm run test:pwa` preview-build PWA verification path, the paired default `rtk npm run dev` Chrome/DevTools verification requirement when installability feedback is under review, and the checked-in screenshot walkthrough.
- Deploy/operator workflow now lives in `docs/DEPLOYMENT.md`, including the canonical root commands `npm run deploy:web`, `npm run deploy:worker`, `npm run deploy`, the default Pages Worker origin `https://davora.xyofn8h7t.workers.dev` used when `VITE_API_BASE_URL` is unset, the default Pages project name `davora`, the `SESSION_SECRET` preflight/provisioning guard, Worker observability enablement plus the `wrangler tail davora` log path, and the exact `cd apps/worker && wrangler dev` smoke path (with Wrangler installed/on `PATH`).
- The explicit redesign source of truth is `docs/FILE_MANAGER_REDESIGN_BRIEF.md`. The approval and QA process source of truth is `docs/UI_QUALITY_GATE.md`.
- Stable UI evidence lives in `docs/screenshots/` and is refreshed by the full browser evidence path `rtk npm run test:e2e`. The current evidence set includes the new settings dialog plus browse preview, focused preview, mutation controls, unlock, error, reconnect, and mobile screenshots.
- UX judgments require browser-rendered evidence from the current build. Code-only review can assess implementation details, but it cannot sign off visual/interface claims without screenshots, Playwright/browser evidence, or a live browser/DevTools walkthrough.
- Real secrets should stay only in ignored environment files.
- The browser stores account metadata and session tokens, but not raw Nextcloud app passwords.
- Local `npm run dev` uses same-origin `/api` proxying through Vite by default, so browser login/bootstrap no longer depends on cross-origin CORS matching during normal local development.
- The checked-in `apps/worker/.dev.vars` file is intentionally mock-only so `cd apps/worker && wrangler dev` works for exact runtime smoke checks. Do not treat those values as deployment secrets.
- Connected account material now persists in two runtime-specific stores: local Node dev uses encrypted `.tmp/local-dev/worker-state.json`, while deployed Cloudflare runtime uses the `DAVORA_ACCOUNT_STORE` Durable Object with the same encrypted payload format. Reconnect-required should represent true account loss/removal or unusable persisted state, not ordinary isolate hops.
- Current `DAVORA_ACCOUNT_STORE` lifecycle/retention semantics are intentionally limited and should be described truthfully in future handoffs: connect, explicit account removal, and clear-all overwrite one encrypted `accounts` snapshot in a single named Durable Object; removal does not delete the object/key outright, there is no automatic expiry/TTL/pruning path today, and no app-level count/age retention bound exists beyond the single-snapshot design plus underlying Durable Object limits.
- Do not change the real validation root away from `.davora-agent-test`; the script rejects any other root.
- Use the cache clear button in the UI to reset opened-file cache state for the active account during testing.

## Handover guardrail for future agents
Before claiming another Davora UI/account pass is done, always:
1. Re-read `docs/FILE_MANAGER_REDESIGN_BRIEF.md`.
2. Re-read `docs/UI_QUALITY_GATE.md`.
3. Run the required validation commands.
4. Refresh screenshot evidence, including zero state, the settings dialog when Packet 2+ UI changes touch it, and mobile browse proof.
5. Update `README.md`, `docs/DEPLOYMENT.md`, `docs/UX_REVIEW.md`, `docs/TESTING.md`, and `docs/HANDOVER.md` if any approval story changed.
6. Ask an independent reviewer to verify the browser-rendered evidence and checklist, not just the code diff.

## Managed UX feedback backlog
- Packet 1 (completed and validated on 2026-05-21):
  - Item 5 — cache-first file opens while online when cached data exists, with background refresh, explicit stale/refresh notice, and a non-disruptive Apply refreshed version step.
  - Item 8 — cache-first folder loads while online when cached data exists, with background refresh and account-scoped cache isolation across account switching.
- Packet 2 (completed and validated on 2026-05-21):
  - Item 3 — account details/actions now live under `Profile & settings`, and the shell later removed the always-visible desktop account selector too so account/profile controls stay behind one click.
  - Item 4 — a `Profile & settings` modal now groups account actions/details and cache controls, with a cleaner mobile Done/Close header pattern; the shipped cache controls are the slider/manual cache-limit pair plus the separate max-cacheable-file-size setting.
  - Item 6 — file sizes are now human-readable by default and configurable as Human readable / KB / MB / GB from the main workspace header only.
- Packet 3 (completed and validated on 2026-05-21):
  - Item 2 — unsupported file types now download/open via the browser instead of opening a dead-end preview screen, with immediate status feedback, preflight failure handling, and a browser-native Worker download handoff, while supported previews remain unchanged for text/markdown/image/audio/video/PDF.
  - Item 7 — parent-folder navigation now uses explicit up-arrow semantics in both the primary browse header and the empty-state recovery action.
- Packet 4 (completed and validated on 2026-05-22):
  - Item 1 — Davora now ships an installable manifest/icon set, keeps first-run onboarding clear by showing the browser-native install opportunity only as a quiet contextual app-bar action once a workspace is active, suppresses the non-essential offline-ready toast, and still has dedicated preview-build Chrome verification for service-worker control, installability, cached offline reuse, and uncached offline fallback honesty.
- Packet 5 (completed and validated on 2026-05-22):
  - Item 12 — video preview now starts with muted autoplay + `playsInline` for the most reliable browser-compatible autoplay path.
  - Item 13 — modal dialogs and overlay surfaces now dismiss on outside click in addition to their explicit close buttons.
- Packet 6 (completed and validated on 2026-05-22):
  - Item 15 — breadcrumb navigation now uses a home-icon root plus slash separators, removing redundant `All files` / `Up one level` controls where breadcrumbs already cover navigation.
- Packet 7 (completed and validated on 2026-05-22):
  - Item 16 — local relaunch now retries transient bootstrap/session startup failures and reuses persisted worker-side local-dev account state so ordinary `rtk npm run dev` restarts restore workspace access instead of dropping straight into reconnect.
  - Item 17 — the cache-size preset dropdown was removed; cache sizing now stays on the slider plus direct MB input only.
  - Item 18 — file-size units remain controllable from the main workspace header only; the duplicate settings control was removed.
  - Item 19 — the folder-view file list now accepts drag-and-drop uploads with active drop-state affordance and success messaging.
  - Item 20 — dev-mode PWA support is enabled in Vite, and desktop Chrome dev-server checks now verify service-worker control, manifest/installability, and the full browser evidence path from the root `rtk npm run dev` configuration.
  - Item 21 — media preview now shows next/previous overlay controls, photos alone advance on click/Space, audio/video stay passive, and the app prefetches one adjacent media item ahead by default.
  - Item 22 — cache policy now exposes a dedicated max-cacheable-file-size control with a 15 MB default; larger files still open/download but skip whole-blob persistence.
- Packet 8 (completed and validated on 2026-05-22):
  - Item 23 — ordinary local relaunch now retries session restore even from a stale browser-side reconnect-required flag and only shows reconnect UI after restore is truly paused/failed.
  - Item 24 — installed PWAs now keep a usable cached shell when the local server is stopped/unreachable, including the exact Chrome-installed relaunch path where the browser still reports online connectivity.
  - Item 25 — the update prompt now waits for service-worker takeover, exposes the active app build label for proof, and Chrome verification confirms reload activates the updated content.
- Packet 9 (completed and validated on 2026-05-22):
  - Item 26 — Vite development mode no longer surfaces a false update prompt on ordinary `npm run dev` restarts; the prompt remains reserved for preview/production-like update flows.
  - Item 27 — root OSS/release artifacts now include `LICENSE`, an expanded `README.md`, and `docs/DEPLOYMENT.md`.
  - Item 28 — root deploy automation now exists via `npm run deploy:web`, `npm run deploy:worker`, `npm run deploy:worker:dry-run`, and `npm run deploy`, backed by a repo-pinned Wrangler dependency.
  - Item 29 — the exact `cd apps/worker && wrangler dev` workflow now works in mock mode when Wrangler is installed/on `PATH`, and the Worker deploy path is validated through the real Wrangler dry-run.
  - Item 30 — the Pages deploy path is now explicit: the canonical user-facing command is `npm run deploy:web`, which defaults the Worker origin to `https://davora.xyofn8h7t.workers.dev` and the Pages project name to `davora` unless overridden for another environment, and any remaining Cloudflare project/auth boundary must still be documented honestly.
- Packet 10 (completed and validated on 2026-05-22):
  - Item 31 — Worker release preflight now fails fast when `SESSION_SECRET` is not provisioned, docs now require `wrangler secret put SESSION_SECRET`, and the web bootstrap surfaces the missing-secret state explicitly from `/api/health`.
  - Item 32 — default deploy/runtime behavior now truthfully treats empty `NEXTCLOUD_ALLOWED_HOSTS` as allow-any-valid-Nextcloud-host; docs/examples and real-validation wiring no longer pretend the allowlist is required.
  - Item 33 — deployed Worker observability is now enabled by default and operator docs include the live tail command `cd apps/worker && wrangler tail davora --format pretty`.
  - Item 34 — the deployed `Illegal invocation` root cause was an unbound Worker `fetch` reference in the real Nextcloud client; it is now bound safely, and the observed `davora-worker` log signal was explained as stale Pages bundle drift from an older deployment that still hardcoded `davora-worker.xyofn8h7t.workers.dev`.

- Packet 11 (recorded as open/pending on 2026-05-23):
  - Item 35 — root folder should be chosen per account during the connection flow for all users, not only as server-side/debug config.
  - Item 36 — completed in Packet 11a on 2026-05-23: the deployed reconnect storm was caused by Worker isolate/account-store loss, not true auth failure. The Worker now persists connected accounts for deployed runtimes in a Durable Object (`DAVORA_ACCOUNT_STORE`) using the same encrypted payload format as local-dev file persistence, so ordinary connect/session/search/upload traffic no longer falls into reconnect-required on isolate hops. Transient search/upload failures stay action-local; reconnect remains reserved for true account loss/removal.
    - Exact failure before the fix: deployed `POST /api/accounts` returned 201, then the immediate `POST /api/session` often landed on a different Cloudflare isolate and returned 409 `account_reconnect_required`; that false reconnect state then surfaced during normal search/upload use.
    - Why backend state was necessary here: pure in-memory Worker state was insufficient in deployed Cloudflare runtime because requests are not isolate-sticky. Local Node dev already had file-backed persistence, but deployed runtime had no equivalent persisted account store.
    - Why this was the smallest working fix: Packet 11a added only the minimal deployed account-persistence layer needed for correctness, reused the existing encrypted payload format keyed by `SESSION_SECRET`, and left browser storage/session design unchanged.
    - Current lifecycle/retention semantics: the Durable Object keeps one encrypted `accounts` snapshot for the named store; connect/remove/clear-all overwrite that snapshot, explicit removal only disappears data by writing a new snapshot without the removed accounts, there is no TTL/auto-expiry/pruning/delete path today, and there is no separate history or app-level retention cap beyond the single-snapshot design plus platform limits.
    - Architectural bar from here: the user is skeptical of backend state/storage. Any future backend state must document the exact deployed-runtime failure it solves, why browser-local/stateless alternatives are insufficient, why the proposed state is the minimum safe fix, and what cleanup/limit semantics apply.
    - Validation + stable state: pre-deploy live repro failed 6/6 `201 -> 409`; after Worker deploys `1d522366-9382-446b-9410-00eaa659be2f` and final hardening deploy `80479ab5-ac1b-4a5f-8300-58888127904d`, live repro passed 6/6 `201 -> 200`, end-to-end connect/session/search/upload succeeded, and the current stable code state is commit `74903e6` (`fix: persist deployed accounts across worker isolates`).
  - Item 37 — background transfer status should reserve fixed space, avoid layout jumping, show uploads/downloads, support multiple active tasks with overflow/dropdown, and expose progress for large transfers.
  - Item 38 — downloads and non-viewable-file downloads do not work on Chrome Android.
- Packet 12 (recorded as open/pending on 2026-05-23):
  - Item 39 — audio player should remember position if possible.
  - Item 40 — uploading multiple files and directories is must-have.
  - Item 41 — downloading multiple files/directories is must-have; directory downloads may zip client-side if needed.
  - Item 44 — remove the app name from the in-app chrome to free space and rely on status tray/search instead.
- Packet 13 (recorded as open/pending on 2026-05-23):
  - Item 42 — clarify and/or revisit the server-side secret requirement as a design decision if needed.
  - Item 43 — run one more OSS/publish readiness review round before open source.
  - Item 45 — run team visual/manual test-review loops and keep improving constructively while useful.

## Current workflow requirements for the next improvement loop
- PM delegates all work; execute sequentially by default and parallelize only when definitely harmless.
- Each stable working state should be committed to git.
- Git is now initialized on `main`; the workflow started from the baseline commit `chore: initialize git baseline`, and the latest stable product state recorded here is Packet 11a commit `74903e6` (`fix: persist deployed accounts across worker isolates`).

## Future limitations / non-goals (not open backlog for this delivery)
- The managed UX feedback backlog above is complete through Packet 10, with Packets 11-13 now recorded as open backlog; the items below remain intentionally out of scope unless future product scope changes.
- Do not broaden backend state beyond Packet 11a's account-persistence store unless docs first show the exact deployed-runtime failure, why browser-local/stateless options are insufficient, and why the added state is the minimum safe fix.
- Add OAuth account connection when product scope expands.
- Add richer media controls/metadata if deeper UX polish is needed beyond the new content-first preview treatment.
- Add pinned/sync-specific cache layers separately from opened-file cache when that future feature exists.
