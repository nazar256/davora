# ADR 001: Worker owns Nextcloud credentials

## Status
Accepted

## Context
The app must not expose the Nextcloud app password to browser code, logs, docs, or bundles. The browser still needs a usable file API.

## Decision
The Cloudflare Worker owns the real Nextcloud credentials via environment bindings and performs all WebDAV requests server-side.

## Consequences
- Browser code uses only normalized JSON endpoints.
- Real backend credentials stay out of the client boundary.
- Worker configuration becomes the critical deployment surface and must be validated carefully.
