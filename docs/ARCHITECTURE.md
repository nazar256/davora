# Architecture

## Overview
The repo is an npm workspace with three packages:
- `apps/web`: React + Vite PWA frontend.
- `apps/worker`: Cloudflare Worker / local Node server that normalizes Nextcloud WebDAV into a JSON API.
- `packages/shared`: shared types, path helpers, and API contracts.

## Request flow
1. On bootstrap, the browser checks Worker health/bootstrap requirements.
2. In local web development, the browser talks to same-origin `/api`; Vite proxies those requests to the local worker so browser CORS policy is not part of the default dev bootstrap path.
3. With no connected accounts, the browser shows a first-run zero state and collects Nextcloud connection details in-app.
4. The browser submits the account connection request to the Worker together with browser-ownership headers; the Worker validates the hostname, credentials, root access, and browser ownership, then returns non-secret account metadata.
5. When needed, the browser optionally submits the deployment unlock code together with the selected account id and the same browser-ownership headers to request an account-bound session.
6. The Worker validates the account material, signs a short-lived session token bound to that account, and returns capabilities.
7. The browser stores the opaque session token plus non-secret account/session metadata, then calls normalized JSON endpoints for the active account.
8. The Worker uses account-specific credentials to query Nextcloud WebDAV and translates XML responses into JSON.
9. The browser caches successful folder/file/search responses locally under an account namespace for offline revisit.

## Worker responsibilities
- Own account validation, browser-ownership enforcement, and account-bound session signing.
- Validate host, username, and root path configuration for each Nextcloud account connection.
- Enforce root-path sandboxing for every requested path.
- Surface bootstrap metadata for:
  - `GET /api/health`
  - `POST /api/accounts`
  - `POST /api/session`
  - `DELETE /api/accounts/:accountId`
- Provide normalized endpoints for the active account session:
  - `GET /api/files?path=`
  - `GET /api/metadata?path=`
  - `GET /api/file?path=`
  - `GET /api/search?q=&path=`
  - `GET /api/download?path=` and a browser-native `POST /api/download` handoff for downloads without buffering the whole file in browser memory
- Support `MOCK_BACKEND=true` for deterministic UI/e2e tests while still exercising the same account/session model.

## Browser responsibilities
- Talk only to the normalized Worker API.
- Never parse WebDAV XML.
- Maintain connected accounts, active account selection, active account session, current folder, selected item, focused preview state, search results, offline cache state, and bootstrap/unlock state.
- Render a list-first file-management workspace with account onboarding/switching controls, breadcrumb/search toolbar, contextual action/detail rail, focused preview overlay, and reconnect/remove flows when required.
- Register the service worker and manifest for PWA behavior without caching authenticated API responses.

## Data/contract model
Shared contracts expose:
- `ConnectedAccount`
- `AppSession`
- `FileEntry`
- `FileMetadata`
- `FilePreview`
- `SearchResult`
- `ApiError`
- `HealthResponse`

## Security boundaries
- Trust boundary 1: browser ↔ Worker via connect/session bootstrap requests carrying browser-ownership headers and a signed account-bound session token.
- Trust boundary 2: Worker ↔ Nextcloud via Basic auth using user-supplied credentials held server-side for the current app runtime.
- All direct WebDAV requests stay inside the Worker boundary.
- `APP_UNLOCK_CODE` is validated server-side and never returned to the browser.
- Browser-side caches and sessions are partitioned by account namespace to prevent cross-account bleed.

## Storage foundation note
- This pass establishes a strong runtime account foundation and browser-safe persistence model.
- Local Node-worker development now persists connected accounts in an encrypted `.tmp/local-dev/worker-state.json` file by default, keyed from the local session secret so restarts preserve account continuity without moving raw credentials into browser storage.
- Deployed Cloudflare runtime now persists the same encrypted connected-account payload in the `DAVORA_ACCOUNT_STORE` Durable Object. Packet 11a made this necessary because pure in-memory Worker maps were insufficient in deployed runtime: `POST /api/accounts` and the immediate `POST /api/session` can hit different isolates, and Cloudflare does not guarantee isolate-sticky request handling or durable in-memory state.
- Browser persistence keeps only non-secret account metadata, browser-ownership tokens, and session tokens; it never stores raw app passwords.

## Backend state policy
- The current backend state is intentionally minimal: only the Worker-side connected-account material needed to preserve correct account-bound session behavior across deployed isolate hops is persisted server-side.
- Packet 11a chose a Durable Object because it was the smallest working deployed fix: it reuses the existing AES-GCM encrypted payload format keyed by `SESSION_SECRET`, leaves local-dev file persistence unchanged, and avoids pushing raw credentials into browser storage or redesigning the session model.
- Current `DAVORA_ACCOUNT_STORE` semantics are intentionally narrow: one named Durable Object instance stores one encrypted `accounts` snapshot, and each connect/remove/clear-all write replaces that snapshot wholesale rather than appending records or keeping history.
- Current removal/retention behavior is equally minimal: explicit account removal and clear-all replace the persisted snapshot with one that no longer contains those accounts (including an empty encrypted snapshot when no accounts remain), but there is no automatic TTL, expiry, pruning job, or delete endpoint for the Durable Object payload.
- Current bounds are only the ones the implementation actually has today: no app-level max account count, age-based retention window, or per-account history exists; the practical ceiling is the single encrypted snapshot model plus underlying Durable Object storage/write limits, and an unreadable snapshot (for example after `SESSION_SECRET` changes) is treated as unavailable persisted state that requires reconnect.
- The user is skeptical of backend state/storage. Any future backend-state addition must clear a higher bar in docs before implementation: record the exact failure being solved, explain why browser-local/stateless/request-scoped alternatives are insufficient, justify why the proposed server-side state is the minimum safe fix, and describe its cleanup/retention limits explicitly.

## Validation strategy
- Unit/integration tests cover shared helpers, Worker auth/config logic, account validation, account-bound sessions, WebDAV translation, and browser UI state.
- Playwright covers desktop, mobile, offline browser checks, focused preview flow, contextual mutation dialogs, zero-state onboarding, account switching, and reconnect/remove flows against mock mode.
- Real validation provisions only `.davora-agent-test` via direct WebDAV setup/cleanup, then exercises the real Worker through the in-app account connect + session + list/file/search/move/copy/create-folder/upload/delete behavior inside that sandbox.
