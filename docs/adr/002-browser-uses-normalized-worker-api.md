# ADR 002: Browser uses a normalized Worker API instead of raw WebDAV

## Status
Accepted

## Context
Raw WebDAV XML is not a stable or ergonomic browser contract for a PWA. It also pushes protocol-specific parsing and edge cases into client code.

## Decision
The Worker converts WebDAV responses into explicit JSON contracts shared by `packages/shared`, and the browser talks only to those normalized endpoints.

## Consequences
- Browser code stays simpler and easier to test.
- WebDAV quirks stay isolated to Worker/server-side code.
- The shared contract can evolve without exposing XML semantics to the UI.
