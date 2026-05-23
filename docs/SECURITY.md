# Security

## v1 security posture
- The browser never talks to WebDAV directly.
- The browser may temporarily hold the user-entered Nextcloud app password only long enough to submit an in-app connect or reconnect request.
- Raw Nextcloud app passwords are not persisted in browser local storage, IndexedDB, or service-worker caches.
- The browser does persist non-secret account metadata, opaque session tokens, and a browser-ownership token used to bind account-management requests to one browser context.
- Local Node-worker development may persist connected-account credentials only in the worker boundary, encrypted on disk under `.tmp/local-dev/worker-state.json` with a key derived from `SESSION_SECRET`.
- The Worker validates and uses upstream credentials, then exposes only a normalized JSON API plus account-bound session tokens.
- Signed session tokens gate access to normalized API endpoints and are bound to a specific account + runtime account nonce.
- The Worker validates allowed origins, sandbox root paths, allowed Nextcloud hosts, optional unlock-code requirements, and browser ownership for connect/reconnect/remove/session bootstrap.
- Local web development uses same-origin `/api` proxying by default, reducing reliance on browser CORS allowlists while keeping Worker-side origin validation available for explicit cross-origin setups.
- Real validation writes are hard-pinned to `.davora-agent-test` and cleaned up after use.
- Opened-file cache is isolated by account namespace from any future pinned/sync semantics.

## Secret-handling rules
- Do not hardcode or print `NEXTCLOUD_APP_PASSWORD`.
- Do not include real secrets in docs, screenshots, test snapshots, browser storage fixtures, or browser console output.
- Keep env files out of source control.
- Treat `APP_UNLOCK_CODE` as a deployment secret; share it only out-of-band.
- Treat session tokens and browser-ownership tokens as sensitive operational material even though they are not raw app passwords.

## Browser boundary evidence
- Browser source and bundle are guarded against raw WebDAV/XML/basic-auth surfaces.
- Browser persistence stores only non-secret account metadata, browser-ownership tokens, and account-bound session tokens.
- Checks:
  - `apps/web/src/api-contract.test.ts`
  - `apps/web/src/browser-contract.test.ts`
  - account persistence/cache tests in `apps/web/src/*.test.ts*`
- No `remote.php/dav`, `PROPFIND`, `Authorization: Basic`, or raw `NEXTCLOUD_APP_PASSWORD` handling persists in browser storage code.

## Worker boundary evidence
- Worker-only WebDAV logic lives in `apps/worker/src/nextcloud/client.ts`.
- Session handling/signing lives in `apps/worker/src/security/token.ts`.
- Per-account validation and browser-ownership checks live in `apps/worker/src/accounts/store.ts` and `apps/worker/src/app.ts`.
- Worker health exposes only bootstrap requirements, not the actual `APP_UNLOCK_CODE` value.
- Mock reset is gated behind mock mode plus a reset token and is not exposed as an unauthenticated live route.

## Cache/session isolation requirements
- Folder/search/opened-file cache keys are namespaced by account.
- Active-account switching must not reuse another account’s cached folder data or opened file blobs.
- Service worker does not runtime-cache authenticated `/api/*` responses.

## Delete/mutation safety
- Delete requires the selected filename to be typed explicitly before success.
- Offline mutations are disabled at the UI layer and fail clearly if attempted.
- Real backend validation refuses any root other than `.davora-agent-test`.

## Local-dev durability boundary
- In local Node-worker development, connected account material survives ordinary restarts through the encrypted worker-side state file.
- Browser persistence still avoids raw password storage, account management remains bound to the browser context, and removing/resetting worker state still forces an explicit reconnect.
- Other runtimes continue to require a dedicated Worker-native durable store before claiming restart durability there.
