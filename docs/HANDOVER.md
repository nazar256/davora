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
- Root agent handoff now lives in `AGENTS.md`; future agents should read it first for the current no-commit instruction, dirty-worktree deployment state, local browser/runtime notes, latest validation summary, and the rule that the latest active deploy is the one in AGENTS rather than older historical deploy entries.
- Start from `README.md` for local setup, env examples, mode selection, validation commands, the dedicated `rtk npm run test:pwa` preview-build PWA verification path, the paired default `rtk npm run dev` Chrome/DevTools verification requirement when installability feedback is under review, and the checked-in screenshot walkthrough.
- Deploy/operator workflow now lives in `docs/DEPLOYMENT.md`, including the canonical root commands `npm run deploy:web`, `npm run deploy:worker`, `npm run deploy`, the default Pages Worker origin `https://davora.xyofn8h7t.workers.dev` used when `VITE_API_BASE_URL` is unset, the default Pages project name `davora`, the `SESSION_SECRET` preflight/provisioning guard, Worker observability enablement plus the `wrangler tail davora` log path, and the exact `cd apps/worker && wrangler dev` smoke path (with Wrangler installed/on `PATH`).
- The explicit redesign source of truth is `docs/FILE_MANAGER_REDESIGN_BRIEF.md`. The approval and QA process source of truth is `docs/UI_QUALITY_GATE.md`.
- Stable UI evidence lives in `docs/screenshots/` and is refreshed by the full browser evidence path `rtk npm run test:e2e`. The current evidence set includes the new settings dialog plus browse preview, focused preview, mutation controls, unlock, error, reconnect, and mobile screenshots.
- `AGENTS.md` is the authoritative place to identify the current live deployment. As of the latest handoff, live Pages/Worker include the dirty Packet 13 browse-density follow-up and remain uncommitted by user instruction.
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

- Packet 11 (completed on 2026-05-23; item 36 completed in Packet 11a):
  - Item 35 — completed: the connect/reconnect flow now allows selecting a per-account root folder (prefilled from Worker health defaults), and the Worker persists/enforces it per account/session.
  - Item 36 — completed in Packet 11a on 2026-05-23: the deployed reconnect storm was caused by Worker isolate/account-store loss, not true auth failure. The Worker now persists connected accounts for deployed runtimes in a Durable Object (`DAVORA_ACCOUNT_STORE`) using the same encrypted payload format as local-dev file persistence, so ordinary connect/session/search/upload traffic no longer falls into reconnect-required on isolate hops. Transient search/upload failures stay action-local; reconnect remains reserved for true account loss/removal.
    - Exact failure before the fix: deployed `POST /api/accounts` returned 201, then the immediate `POST /api/session` often landed on a different Cloudflare isolate and returned 409 `account_reconnect_required`; that false reconnect state then surfaced during normal search/upload use.
    - Why backend state was necessary here: pure in-memory Worker state was insufficient in deployed Cloudflare runtime because requests are not isolate-sticky. Local Node dev already had file-backed persistence, but deployed runtime had no equivalent persisted account store.
    - Why this was the smallest working fix: Packet 11a added only the minimal deployed account-persistence layer needed for correctness, reused the existing encrypted payload format keyed by `SESSION_SECRET`, and left browser storage/session design unchanged.
    - Current lifecycle/retention semantics: the Durable Object keeps one encrypted `accounts` snapshot for the named store; connect/remove/clear-all overwrite that snapshot, explicit removal only disappears data by writing a new snapshot without the removed accounts, there is no TTL/auto-expiry/pruning/delete path today, and there is no separate history or app-level retention cap beyond the single-snapshot design plus platform limits.
    - Architectural bar from here: the user is skeptical of backend state/storage. Any future backend state must document the exact deployed-runtime failure it solves, why browser-local/stateless alternatives are insufficient, why the proposed state is the minimum safe fix, and what cleanup/limit semantics apply.
    - Validation + stable state: pre-deploy live repro failed 6/6 `201 -> 409`; after Worker deploys `1d522366-9382-446b-9410-00eaa659be2f` and final hardening deploy `80479ab5-ac1b-4a5f-8300-58888127904d`, live repro passed 6/6 `201 -> 200`, end-to-end connect/session/search/upload succeeded, and the stable Packet 11a fix anchor is commit `74903e6` (`fix: persist deployed accounts across worker isolates`).
  - Item 37 — completed: background transfer status now reserves fixed app-bar space, tracks recent upload/download tasks, shows determinate/indeterminate progress, and exposes overflow in a popover.
  - Item 38 — completed: downloads now use a fetch + blob + anchor download flow instead of the prior iframe/form submission path, improving Chrome Android behavior.
- Packet 12 (completed on 2026-05-23):
  - Item 39 — completed in milestone 1: reopening the same audio file in the same browser/account now restores the last known position on a best-effort basis using browser-local storage keyed by account + path; if storage is unavailable, invalid, rejected by the browser, or no longer usable for the media duration, preview starts quietly at `0:00` with no resume claim.
  - Item 40 — completed on 2026-05-23: the current-folder actions now expose separate `Upload files` and `Upload folder` controls; normal picker flow accepts multiple files in one action, directory uploads preserve nested relative paths under the current folder by creating any missing parents first, and the transfer tray remains per-file so progress stays honest. Stable product commit `c08e43c` was later included in the successful deploy of current HEAD `8ecc9c1`, publishing Worker version `4ba02fa9-632e-48ab-bf02-d9784bc52a98` at `https://davora.xyofn8h7t.workers.dev` plus Pages deploy `https://92f36b69.davora.pages.dev`.
  - Item 41 — completed on 2026-05-23: the file list now adds explicit row-level batch-download selection (checkboxes only for this download use case, not a broader generic bulk-action system), selected files/folders can be downloaded together through one `Download selected` workflow, and any folder/batch result is packaged client-side as a ZIP while existing single-item open/details/download flows stay on their direct path. Stable product commit `143a97b` was later included in the successful deploy of current HEAD `7bac20c`, publishing Worker version `d130505e-f946-4174-8878-5f37e15b783b` at `https://davora.xyofn8h7t.workers.dev` plus Pages deploy `https://782fb753.davora.pages.dev`.
    - Mixed selections: selecting both files and folders produces one ZIP that preserves folder structure and includes standalone files at the current-folder/search-relative root.
    - Scope guardrail: this deliberately does **not** introduce generalized bulk move/copy/delete behavior; batch selection exists only to satisfy item 41's download requirement.
    - Progress/status honesty: the transfer tray reports queued/preparing/transferring/done for the batch archive, uses real streamed file-download progress while fetching selected files, and falls back to an honest preparing state while the browser is generating the ZIP.
  - Item 44 — completed in milestone 1: once an account is connected, the in-app chrome no longer shows a persistent `Davora` wordmark, keeping that compact header space for location/status/install/settings/transfer affordances instead while preserving the zero-state product naming.
- Packet 13 (recorded as open/pending on 2026-05-23):
  - Item 42 — clarify the actual server-side secret/design requirement: deployed runtime requires `SESSION_SECRET`, while Nextcloud credentials are entered in-app and stay out of browser persistence and server-start env config. The decision artifact is `docs/adr/003-worker-keeps-user-entered-nextcloud-credentials-server-side.md`.
  - Item 43 — run one more OSS/publish readiness review round before open source, using `docs/PACKET13_REVIEW_GATES.md` as the explicit pass/fail checklist and record.
  - Item 45 — run team visual/manual test-review loops and keep improving constructively while useful; each recorded loop must use `docs/PACKET13_REVIEW_GATES.md` and include browser-rendered evidence.

## Current workflow requirements for the next improvement loop
- PM delegates all work; execute sequentially by default and parallelize only when definitely harmless.
- The user explicitly approved committing and pushing the completed Linear closeout work to `main` after a clean diff audit.
- Git is initialized on `main`; the workflow started from the baseline commit `chore: initialize git baseline`, the stable Packet 12 item 41 product anchor is commit `143a97b` (`feat: add batch file and folder downloads`), and a later UX checkpoint commit `ffe579e` (`feat: refine mobile and preview ux`) exists before this final closeout commit.
- The latest deployed closeout checkpoint is Worker version `11bd50c2-e919-470a-845d-e957d3d8d668` and Pages `https://2912134e.davora.pages.dev`. It includes all completed Linear work through PER-48/PER-49/PER-50/PER-51/PER-52, the reopened PER-46/PER-44/PER-42 follow-ups, earlier PER-41/PER-43/PER-45/PER-39/PER-40/PER-5/PER-38 work, and the final review fixes for search result ordering plus path-bound stream tokens. Worker health and both immutable/canonical Pages URLs were verified after deploy. The prior 2026-07-09 empty-queue audit was superseded: a 2026-07-10 refresh found new Backlog tickets PER-48, PER-49, PER-50, PER-51, and PER-52 plus reopened PER-46; those tickets are now Done, and the final review/audit entries below are the active closeout state.
- Newer PER-48 deploy checkpoint on 2026-07-10: Worker version `23c2557a-83be-4296-80e3-aea635bf1bf6` and Pages `https://3b973661.davora.pages.dev` include image/PDF zoom controls. The proof screenshot is `docs/screenshots/davora-mobile-preview-zoom.png`, attached to Linear as `2ebe20db-b28a-40e1-b697-392fe0e85754`; completion comment `442ba5aa-3883-419c-b5e9-5c647556135e` captures validation, review, deploy, and proof. PER-48 was moved to Done, and the latest Linear queue refresh returned empty Backlog, Todo, In Progress, In Review, and Reopened lists.
- Final review-refine completed on 2026-07-10 after the queue was empty. The general reviewer found and the code fixed search results being sorted/grouped instead of preserving backend/relevance order. The security reviewer found and the code fixed reusable session tokens in `/api/file/stream` URLs by replacing them with short-lived path-bound stream tokens minted through an authorized request. Both re-reviews returned `Verdict: APPROVED`. Final deploy published Worker `11bd50c2-e919-470a-845d-e957d3d8d668` and Pages `https://2912134e.davora.pages.dev`; Worker health and Pages HTTP 200 verified. Remaining Medium/Low follow-ups retained for later hardening: set `NEXTCLOUD_ALLOWED_HOSTS` in production, validate `SESSION_SECRET` entropy, align DELETE CORS/account removal, add static Pages security headers, and consider reducing stream-token URL telemetry exposure.
- No newer local-only product work is recorded after that deploy.
- Documentation alignment rule: after any material state change, update `AGENTS.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/UX_REVIEW.md`, `docs/TESTING.md`, and `.agent/project-state.json` before assuming context will survive compaction.

## Future limitations / non-goals (not open backlog for this delivery)
- The managed UX feedback backlog above is complete through Packet 10, with Packets 11-13 now recorded as open backlog; the items below remain intentionally out of scope unless future product scope changes.
- Do not broaden backend state beyond Packet 11a's account-persistence store unless docs first show the exact deployed-runtime failure, why browser-local/stateless options are insufficient, and why the added state is the minimum safe fix.
- Add OAuth account connection when product scope expands.
- Add richer media controls/metadata if deeper UX polish is needed beyond the new content-first preview treatment.
- Add pinned/sync-specific cache layers separately from opened-file cache when that future feature exists.
