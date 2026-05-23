# ADR 003: Worker keeps user-entered Nextcloud credentials server-side; `SESSION_SECRET` is the required deployed secret

## Status
Accepted

## Supersedes
- ADR 001

## Context
The app must not expose the Nextcloud app password to browser code, persisted browser storage, logs, docs, or bundles. The browser still needs a usable in-app account connection flow, and deployed runtime must preserve the minimum server-side material needed for account-bound sessions to survive ordinary Worker isolate hops.

## Decision
Users enter Nextcloud base URL, username, and app password in-app during connect/reconnect. The Worker validates that input, keeps connected-account material only inside the Worker boundary, and performs WebDAV requests server-side.

No per-user Nextcloud credential is required as server-start environment configuration for normal app use. The mandatory deployed server-side secret is `SESSION_SECRET`, which signs session tokens and encrypts Worker-side persisted account material. `APP_UNLOCK_CODE` remains optional deployment policy, not a baseline runtime requirement.

## Consequences
- Browser code and browser persistence never keep raw Nextcloud app passwords.
- Operators must provision `SESSION_SECRET` before release; they do not provision per-user Nextcloud credentials as environment bindings for baseline app use.
- Worker-side persisted account material remains a tightly scoped runtime correctness mechanism, not a general server-side account database.
- Any future Worker-side persisted account material must document the exact runtime failure it solves, why browser-local/stateless alternatives were insufficient, and its retention/cleanup limits.
