# PRD — Davora PWA v1 multi-account foundation

## Product goal
Ship a Nextcloud-focused Progressive Web App that lets a browser user connect multiple Nextcloud accounts inside the app, switch the active account safely, and browse, open, preview, cache, upload, organize, copy, move, and delete files through a normalized Worker API.

## Problem
Direct WebDAV browser integrations are awkward and unsafe for this use case because they expose credential handling, XML parsing, and backend quirks to the client. Davora needs a server-side adapter that converts WebDAV into a predictable JSON API while also supporting in-app account onboarding and switching without cross-account cache/session bleed.

## v1 users
- Primary: an operator managing one or more of their own Nextcloud accounts inside Davora.
- Secondary: reviewers validating architecture, UX, security posture, and handoff quality.

## v1 in scope
1. In-app Nextcloud account onboarding using user-entered base URL, username, app password, and optional label.
2. Multiple connected accounts in one app instance, with active-account switching.
3. Worker-backed session bootstrap bound to a specific account.
4. Normalized JSON API for folder listing, metadata lookup, text/media preview support, original-file fetch, upload, create-folder, move/rename, copy, delete, download, and bounded search.
5. Browser UI for zero-state onboarding, account switching, reconnect/remove states, navigation, breadcrumbing, selection, and required file operations for the active account.
6. Account-aware folder/search/opened-file caching and session restore behavior.
7. Installable PWA shell with honest offline behavior and no service-worker API caching of authenticated account data.
8. Mock mode for deterministic local browser/e2e checks.
9. Real Nextcloud validation using env-supplied credentials only to drive the in-app connect flow against a dedicated safe test directory.
10. Required documentation, acceptance matrix, task/status tracking, handover notes, ADRs, and project state file.

## Explicit v1 non-goals
- OAuth login or token refresh flows.
- Generic WebDAV backends beyond Nextcloud.
- Browser-side direct WebDAV or XML handling.
- Persisting raw Nextcloud app passwords in browser local storage, IndexedDB, or service-worker caches.
- Multi-user tenancy and sharing semantics.
- Full-text indexing beyond bounded WebDAV traversal search.
- Native mobile packaging.

## Functional requirements
- The browser can connect a Nextcloud account inside the app by submitting base URL, username, app password, and optional label.
- The browser can keep multiple account records, show the active account clearly, and switch the active account.
- The browser can reconnect an account when Worker-side account material is unavailable or a session becomes invalid.
- The browser can remove an account and its local account-scoped cache/session state.
- The browser can start an account-bound Worker session and fetch capabilities.
- The browser can list folders under the configured root and refresh after operations.
- The browser can create folders, upload files, rename/move resources, copy resources when supported, and delete resources with explicit confirmation.
- The browser can inspect metadata and open files.
- Internal text renders in-app.
- Markdown renders as HTML with raw fallback.
- Images, audio, and video open from original file content when supported.
- Unsupported types show an explicit fallback and still allow download.
- The browser can download files through the Worker.
- The browser can search by name/path within bounded depth.
- The browser can reuse cached folder/opened-file data offline and after reload without mixing accounts.
- Offline mutation attempts are disabled or fail clearly without pretending success.

## Opened-file cache requirements
- Cache opened-file metadata separately from binary payload tracking.
- Use a configurable cache limit.
- Evict deterministically using LRU when over limit.
- Support offline reopen after reload for previously cached files from the same account only.
- Expose a dev-visible clear-cache action for the active account.

## UX/state requirements
- First run shows a zero-state with a clear Connect Account call to action.
- Active-account context stays visible while browsing.
- Clear loading, empty, error, offline, stale-cache, reconnect-required, and permission-denied states.
- Honest messaging about what is and is not available offline.
- Responsive layout that remains usable on tested mobile viewport sizes.

## Security requirements
- The browser may temporarily hold the user-entered app password only long enough to submit the connect/reconnect request.
- Real backend credentials are not persisted in browser local storage, IndexedDB, or service-worker caches.
- Browser API uses opaque account-bound session tokens, never raw backend credentials, for normal file operations.
- Backend root path is sandboxed.
- Allowed Nextcloud hostnames are validated.
- Secrets are redacted from docs, code, logs, screenshots, and tests.
- Real backend validation is restricted to `.davora-agent-test` only.

## Live backend input
- Live username for validation: `ynvio`.
- Live base URL for validation: `https://nextcloud.ownhost.top`.

## Acceptance summary
See `docs/ACCEPTANCE.md` for the required-item matrix and current completion state.
