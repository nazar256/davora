# Testing

## Automated coverage completed
- Shared unit tests for path helpers, viewer mapping, and capability mapping.
- Worker unit/integration tests for config validation, in-app account connection, encrypted local-dev persistence across restart, account-bound session token verification, XML parsing, normalized API routes, reconnect behavior, and mutation operations.
- Browser component tests for first-run zero state, in-app connect flow, account switching, reconnect form prefilling, unlock bootstrap, focused preview rendering, markdown MIME variants, PDF fallback actions, unsupported-file direct download fallback with immediate status feedback and reconnect/error preflight coverage, account-scoped offline cache behavior, cache-first folder refresh, cached preview apply flow, Packet 6 breadcrumb navigation, Packet 7 drag-and-drop upload, gallery navigation, Packet 8 offline cached-shell fallback, max-cacheable-file-size policy, account-scoped cache isolation across switching, Packet 2/5/7 settings/profile behavior plus main-toolbar file-size preference coverage, muted video autoplay attributes, outside-click modal dismissal, and Packet 4/7/8 install + update handling.
- Browser component tests now also cover Packet 12 milestone 1: connected shell header without a persistent in-app `Davora` wordmark plus best-effort audio reopen resume for the same browser account/file.
- Browser component tests now also cover Packet 12 item 40 upload flows: normal multi-file picker uploads, directory picker uploads with preserved nested relative paths, and the still-working single-file/drag-drop upload behavior.
- Browser component tests now also cover Packet 12 item 41 download flows: mixed file+folder batch download selection, client-side ZIP packaging through the existing per-file download API, and the still-working single-item details download path.
- Opened-file cache tests for metadata/blob separation, account namespacing, LRU eviction, cache summary, and supported limit clamping.
- Playwright browser checks for desktop, mobile, zero-state onboarding, account switching, offline cached access, cache-first folder refresh, cache-first preview apply flow, reconnect/remove, markdown/PDF/video preview behavior, unsupported-file direct download fallback, focused preview flow, contextual mutation safety flow, Packet 6 breadcrumb navigation, Packet 7 drag-and-drop upload, gallery controls, Packet 8 relaunch continuity cleanup, Packet 2/5/7 profile/settings interactions including outside-click dismissal, the default-dev Chrome PWA/installability path, and preview-build PWA checks for installed offline launch plus functional update application.
- Playwright browser checks now also verify Packet 12 milestone 1 desktop behavior: the connected header stays compact without the persistent app name, and reopening the same audio file restores the saved position best-effort in the same browser/account.
- Playwright browser checks now also verify Packet 12 item 40 behavior: the normal picker uploads multiple files in one action, folder uploads preserve nested relative paths under the current folder, and the existing mutation flow still works when uploading one file from inside a subfolder.
- Playwright browser checks now also verify Packet 12 item 41 behavior: a mixed file+folder selection downloads as one ZIP archive with preserved folder contents on desktop and mobile, while existing single-file direct-download behavior remains unchanged.
- Dedicated Playwright screenshot-capture coverage that regenerates checked-in UI artifacts for zero state, connected workspace, account switching, the new settings dialog, browse preview, focused preview, mutation controls, unlock, error, reconnect-required, and mobile browse evidence.
- Real backend validation script using env password source, live username `ynvio`, browser-ownership headers, sandbox-rooted Nextcloud mutation paths, and `.davora-agent-test` only; it exercises the Worker through in-app account connect + session + list/file/search/move/copy/create-folder/upload/delete behavior.

## Required UI evidence workflow
When UI work changes the shipped experience, rerun all of these from the repo root:
- `rtk npm run typecheck`
- `rtk npm test`
- `rtk npm run build`
- `rtk npm run test:pwa`
- `rtk npm run test:e2e`

`rtk npm run test:pwa` is the dedicated preview-build PWA verification path for manifest/installability/service-worker/offline behavior.

`rtk npm run test:e2e` is the full browser evidence path: the root script runs the Playwright browser suite first and then regenerates checked-in screenshots for desktop and mobile evidence.

UX/product conclusions must be drawn from that browser-rendered evidence path, not from source inspection alone. If a reviewer or agent has only read code, they may comment on implementation risk, but they must not approve or reject visual/interface quality without screenshots, browser output, or a browser walkthrough.

## Required deploy/runtime workflow evidence
When a change touches deployment wiring, Worker runtime config, or PWA update signaling, rerun these exact commands in addition to the usual automated tests:

- `cd apps/worker && wrangler dev`
- `npm run deploy:worker -- --dry-run`
- `npm run deploy:web`

Expected evidence rules:
- `wrangler dev` must start from `apps/worker` with the checked-in safe mock defaults once Wrangler is installed/on `PATH`, and should answer `GET /api/health` successfully.
- Worker deploy must be exercised through the real Wrangler bundle path with `--dry-run`, and release deploy must fail fast if required runtime secrets such as `SESSION_SECRET` are not provisioned.
- Pages deploy must be exercised through the exact upload command even if Cloudflare blocks the final external upload because auth, account access, or a missing project; in that case, document the exact blocker precisely instead of marking the path “validated” without evidence.
- Vite development mode should not be used as proof of release-update prompting; that remains the job of `rtk npm run test:pwa`.

## Additional validation status
- `scripts/validate-real.ts` sends the required browser-ownership headers for `/api/accounts` and `/api/session` and now keeps real Nextcloud MKCOL/PUT/MOVE/COPY/DELETE requests rooted under `.davora-agent-test`.
- `rtk npm run validate:real` passed on 2026-05-21 against `https://nextcloud.ownhost.top` for username `ynvio`, covering the in-app account connect + session + list/file/search/move/copy/create-folder/upload/delete flow.
- Guardrail: if `NEXTCLOUD_APP_PASSWORD` is restored in the project-root `.env`, rerun `rtk npm run validate:real` before carrying forward any earlier “blocked on missing secret” note.

## Results
- Multi-account foundation pass on 2026-05-21: typecheck passed.
- Multi-account foundation pass on 2026-05-21: unit/integration tests passed.
- Multi-account foundation pass on 2026-05-21: production build passed.
- Multi-account foundation pass on 2026-05-21: Playwright desktop/mobile onboarding/switching/offline/reconnect/remove/mutation/unlock checks passed.
- Multi-account foundation pass on 2026-05-21: checked-in screenshot capture passed and refreshed `docs/screenshots/*` for the new account-aware UX set.
- Preview UX packet pass on 2026-05-21: typecheck passed.
- Preview UX packet pass on 2026-05-21: workspace tests passed, including markdown MIME charset handling and PDF preview actions.
- Preview UX packet pass on 2026-05-21: production build passed.
- Preview UX packet pass on 2026-05-21: Playwright desktop/mobile preview, offline, mutation, reconnect, and unlock checks passed.
- Preview UX packet pass on 2026-05-21: screenshot evidence refreshed for browse preview, focused preview, mutation controls, unlock, error, reconnect, and mobile states.
- Preview cleanup loop pass on 2026-05-21: typecheck, unit/integration tests, production build, Playwright browser checks, and refreshed screenshot evidence all passed after tightening preview header dismissal and natural-fill media/PDF sizing.
- Real backend validation rerun passed on 2026-05-21 after fixing real Nextcloud mutation requests to preserve the `.davora-agent-test` sandbox root.
- Packet 1 completion pass on 2026-05-21: stale JS/TS shadowing removed from `apps/web` active resolution paths; web unit tests, typecheck, build, Playwright browser coverage, and refreshed screenshot capture all passed against the live TS/TSX sources.
- Packet 2 settings/profile pass on 2026-05-21: typecheck passed.
- Packet 2 settings/profile pass on 2026-05-21: workspace tests passed, including settings-based account/cache controls and file-size preference coverage.
- Packet 2 settings/profile pass on 2026-05-21: production build passed.
- Packet 2 settings/profile pass on 2026-05-21: Playwright desktop/mobile browser checks passed, including the new `Profile & settings` entry point.
- Packet 2 settings/profile pass on 2026-05-21: screenshot evidence refreshed, including `docs/screenshots/davora-settings-dialog.png`.
- Packet 2 cleanup pass on 2026-05-21: reran typecheck, workspace tests, production build, Playwright desktop/mobile checks, and refreshed screenshot evidence after decluttering the app bar and switching the mobile settings close action to Done.

## Coverage map
- Path normalization: `packages/shared/tests/paths.test.ts`
- Capability/viewer mapping: `packages/shared/tests/capabilities.test.ts`
- WebDAV XML/metadata parsing: `apps/worker/tests/xml.test.ts`
- Worker/API operations including account connect, account-bound sessions, and mkdir/upload/move/copy/delete: `apps/worker/tests/app.test.ts`
- Cache metadata + LRU eviction + account namespacing: `apps/web/src/opened-file-cache.test.ts`
- Browser normalized API contract: `apps/web/src/api-contract.test.ts`, `apps/web/src/browser-contract.test.ts`
- Browser onboarding/switching/reconnect/unlock/preview/offline flows: `apps/web/src/App.test.tsx`, `apps/web/tests/app.spec.ts`
- Dedicated preview-build PWA verification: `apps/web/tests/pwa.spec.ts`, `apps/web/playwright.pwa.config.ts`
- Checked-in screenshot artifact generation: `apps/web/tests/screenshots.spec.ts`
- Live Worker validation script: `scripts/validate-real.ts`
- Packet 3 preview/navigation pass on 2026-05-21: typecheck passed.
- Packet 3 preview/navigation pass on 2026-05-21: workspace tests passed, including unsupported-file direct download coverage and up-arrow parent-navigation assertions.
- Packet 3 preview/navigation pass on 2026-05-21: production build passed.
- Packet 3 preview/navigation pass on 2026-05-21: Playwright desktop/mobile browser checks passed, including unsupported-file browser download behavior and the updated up-arrow parent-navigation controls.
- Packet 3 preview/navigation pass on 2026-05-21: screenshot evidence refreshed, including the browse/mutation-control and mobile artifacts that show the updated parent-navigation affordance.
- Packet 3 cleanup pass on 2026-05-22: added browser-native /api/download handoff coverage in worker/browser tests and verified the unsupported-file status copy appears before the async download handoff completes.
- Packet 4 PWA/installability pass on 2026-05-22: typecheck passed.
- Packet 4 PWA/installability pass on 2026-05-22: web unit tests passed, including install-prompt handling and dismiss/re-show coverage.
- Packet 4 PWA/installability pass on 2026-05-22: production build passed with generated manifest, service worker, and install icons.
- Packet 4 PWA/installability pass on 2026-05-22: `rtk npm run test:pwa` passed against the preview build, validating manifest metadata, service-worker control, Chrome installability apart from the automation-only `in-incognito` warning, cached-account offline reload behavior, and the uncached offline zero-state fallback.
- Packet 4 PWA/installability pass on 2026-05-22: reran the full `rtk npm run test:e2e` browser + screenshot path successfully after the PWA updates.

- Packet 4 cleanup pass on 2026-05-22: typecheck passed.
- Packet 4 cleanup pass on 2026-05-22: web unit tests passed, covering zero-state install gating, contextual workspace install affordance behavior, dismissed install re-show on a later browser event, and silent offline-ready handling.
- Packet 4 cleanup pass on 2026-05-22: production build passed.
- Packet 4 cleanup pass on 2026-05-22: `rtk npm run test:pwa` passed with preview-build UX coverage confirming install affordance stays off the first-run zero-state while remaining available contextually in an active workspace, and offline verification still passed for cached-account reuse plus honest uncached fallback.
- Packet 4 cleanup pass on 2026-05-22: reran the full `rtk npm run test:e2e` browser + screenshot path successfully after the prompt-intrusiveness cleanup.
- Local-dev persistence packet on 2026-05-22: typecheck passed.
- Local-dev persistence packet on 2026-05-22: workspace unit/integration tests passed, including same-origin `/api` browser contract coverage and encrypted worker-side restart persistence coverage.
- UX feedback packet 5 on 2026-05-22: added unit/browser coverage for file-size mode expansion, slider/manual cache-limit controls, hidden desktop account switching, muted video autoplay attributes, and outside-click modal dismissal.
- UX feedback packet 5 on 2026-05-22: refreshed preview-build manifest assertions to cover additional installability metadata and reran the PWA preview-build Chrome checks successfully.
- UX feedback packet 5 on 2026-05-22: additional real Chrome DevTools evidence on local preview confirmed `/manifest.webmanifest` returned the shipped metadata (`lang`, `categories`, `display_override`, icons, screenshots) and the service worker became controller-backed after one reload.
- UX feedback packet 7 on 2026-05-22: typecheck passed.
- UX feedback packet 7 on 2026-05-22: workspace unit/integration tests passed, including breadcrumb navigation, drag-and-drop upload, gallery controls, relaunch restore, and max-cacheable-file-size coverage.
- UX feedback packet 7 on 2026-05-22: production build passed with the updated PWA config and browser-cache policy controls.
- UX feedback packet 7 on 2026-05-22: `rtk npm run test:pwa` passed for the preview-build manifest/service-worker/installability path.
- UX feedback packet 7 on 2026-05-22: `rtk npm run test:e2e` passed, including the new default-dev desktop Chrome installability check plus refreshed screenshot evidence.
- Packet 8 bug batch on 2026-05-22: `rtk npm run typecheck` passed.
- Packet 8 bug batch on 2026-05-22: `rtk npm test` passed, including new relaunch/media regression coverage and the build-label/update assertions.
- Packet 8 bug batch on 2026-05-22: `rtk npm run build` passed with the updated service-worker runtime caching and build-label wiring.
- Packet 8 bug batch on 2026-05-22: `rtk npm run test:pwa` passed with Chrome evidence for the exact installed-PWA stopped-server launch path (browser still online, local server unreachable) and update-prompt reload activating the changed build label/content.
- Packet 8 bug batch on 2026-05-22: `rtk npm run test:e2e` passed, including default-dev Chrome verification that relaunch no longer gets stranded behind reconnect on ordinary local restart.
- Packet 9 publish/deploy readiness pass on 2026-05-22: `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, `rtk npm run test:pwa`, and `rtk npm run test:e2e` passed after the dev-only update-prompt suppression and deploy-doc/script changes.
- Packet 9 publish/deploy readiness pass on 2026-05-22: `cd apps/worker && wrangler dev` started successfully and returned healthy mock-mode bootstrap output via `GET /api/health`.
- Packet 9 publish/deploy readiness pass on 2026-05-22: `npm run deploy:worker -- --dry-run` passed through the real Wrangler bundle/deploy path.
- Deploy-path correction pass on 2026-05-22: `scripts/deploy.ts` now defaults `VITE_API_BASE_URL` to `https://davora.xyofn8h7t.workers.dev`, the operator path is the literal root command `npm run deploy:web` (with optional overrides only when targeting a different Worker origin or Pages project), and future publish/deploy claims must verify that exact user-facing command rather than a near-equivalent variant.
- Packet 10 deploy/runtime pass on 2026-05-22: unit coverage now verifies deploy preflight fails without Worker `SESSION_SECRET`, the web bootstrap surfaces missing `SESSION_SECRET` from `/api/health`, and `scripts/validate-real.ts` no longer injects a synthetic `NEXTCLOUD_ALLOWED_HOSTS` default so live validation exercises the new allow-any-host default honestly.
- Packet 10 deploy/runtime live validation pass on 2026-05-22: `rtk npm run deploy:worker` and `rtk npm run deploy:web` succeeded in this environment, publishing Worker version `013f15fd-f4c2-4966-8a46-6d5714ec335a` and Pages deployment `https://5fc47ef6.davora.pages.dev/`; live DevTools inspection then confirmed `GET /api/health` returned `configLoaded: true`, the current production bundle references `davora.xyofn8h7t.workers.dev` (not `davora-worker...`), and `POST /api/accounts` now returns the expected upstream validation error (`Nextcloud request failed with 401.` for an invalid app password) instead of `Illegal invocation`.
- Packet 10 real-backend validation rerun passed on 2026-05-22: `rtk npm run validate:real` passed with empty/default `NEXTCLOUD_ALLOWED_HOSTS`, confirming the allow-any-valid-host default works in the live validation path.
- Packet 10 observability verification on 2026-05-22: `wrangler tail davora --format pretty --sampling-rate 0.99 --method POST` captured a live `POST /api/accounts - Ok` invocation while the response body still surfaced the expected upstream validation error, confirming the operator tail path works against the deployed Worker.
- Packet 11a pre-deploy live repro on 2026-05-23: `node --env-file-if-exists=.env .tmp/repro-packet11a-loop.mjs` failed 6/6 times against `https://davora.xyofn8h7t.workers.dev` with `connectStatus=201` followed immediately by `sessionStatus=409`, `sessionCode=account_reconnect_required`, proving deployed runtime account state was getting lost between `/api/accounts` and `/api/session`.
- Packet 11a pre-deploy log evidence on 2026-05-23: `wrangler --cwd apps/worker tail davora --format pretty --sampling-rate 0.99` captured the same connect/session sequence as `Ok` requests while the response bodies still returned reconnect-required, confirming the issue was logical runtime-state loss rather than transport 5xx failure.
- Packet 11a implementation validation on 2026-05-23: `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, and `rtk npm run deploy:worker -- --dry-run` all passed after adding the Durable Object-backed deployed account store and the transient-failure regression coverage.
- Packet 11a live deploy/validation on 2026-05-23: initial Worker version `1d522366-9382-446b-9410-00eaa659be2f` fixed the main isolate-loss bug, then reviewer hardening shipped in Worker version `80479ab5-ac1b-4a5f-8300-58888127904d`; final live validation after that deploy showed `node --env-file-if-exists=.env .tmp/repro-packet11a-loop.mjs` passing 6/6 `201 -> 200` connect/session attempts against `https://davora.xyofn8h7t.workers.dev`, and `node --env-file-if-exists=.env .tmp/repro-packet11a.mjs` succeeding end-to-end for connect + session + search + upload + cleanup from the deployed web origin `https://davora.pages.dev`.
- Packet 11a post-deploy tail evidence on 2026-05-23: `wrangler --cwd apps/worker tail davora --format pretty --sampling-rate 0.99` showed successful `GET/PUT https://davora.internal/accounts` Durable Object traffic alongside successful deployed `/api/accounts`, `/api/session`, `/api/search`, and `/api/upload` requests, confirming the new runtime persistence path is active in production and that action paths stay healthy after the reviewer hardening.
- Packet 11a real-backend regression on 2026-05-23: `rtk npm run validate:real` still passed against `https://nextcloud.ownhost.top`, confirming the local-dev file-backed path and live Nextcloud flow remain intact after the shared persistence refactor.
- Packet 11a checkpoint recording on 2026-05-23: the stable Packet 11a fix anchor in git is commit `74903e6f46fcf1007a835e4e9fd001538c788201` (`fix: persist deployed accounts across worker isolates`); this follow-up checkpoint updated docs/state only and did not change product runtime behavior.
- Packet 11a docs consistency pass on 2026-05-23: no product-code or runtime-validation rerun was needed; the checkpoint work was limited to aligning acceptance/state wording and documenting the current `DAVORA_ACCOUNT_STORE` retention semantics truthfully from existing implementation (overwrite on connect/remove/clear-all, no automatic expiry/pruning, no extra app-level retention cap beyond the single-snapshot Durable Object design).
- Packet 12 milestone 1 pass on 2026-05-23: `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, `rtk npm run test:pwa`, and `rtk npm run test:e2e` passed after removing the persistent in-app `Davora` wordmark from connected chrome, adding best-effort audio reopen resume per browser account/file, refreshing screenshot evidence, and adding Vitest + Playwright regressions for both behaviors. The installed-PWA stopped-server sub-check is skipped in this environment when no system Chrome binary exposing the CDP `PWA.*` domain is present; the remaining preview-build PWA checks still passed.
- Packet 12 item 40 pass on 2026-05-23: `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, and `rtk npm run test:e2e` passed after adding explicit `Upload files` + `Upload folder` current-folder controls, batching multiple selected files through the existing upload API, preserving nested directory relative paths under the current folder, and extending Vitest + Playwright coverage for multi-file picker uploads, directory uploads, and the preserved single-file/drag-drop flows. This milestone intentionally did not run deploy because item 40 was requested as a pre-deploy stable commit only.
- Packet 12 item 41 pass on 2026-05-23: `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, `rtk npm run test:pwa`, and `rtk npm run test:e2e` passed after adding an explicit row-level batch-download selection flow, client-side ZIP packaging for folder/batch downloads, and Vitest + Playwright coverage for mixed file+folder downloads plus the preserved single-item download path. The installed-PWA stopped-server sub-check remains skipped automatically in this environment when no system Chrome binary exposes the CDP `PWA.*` domain; the remaining preview-build PWA checks passed.
- Packet 12 item 41 deploy evidence on 2026-05-23: the exact root release command `npm run deploy` succeeded from clean HEAD `7bac20c`, publishing Worker version `d130505e-f946-4174-8878-5f37e15b783b` at `https://davora.xyofn8h7t.workers.dev` and Pages deploy `https://782fb753.davora.pages.dev`. Wrangler warned that the root `wrangler.toml` lacks `pages_build_output_dir`, so Pages ignored that config file for this successful deploy.
