# Davora improvements implementation

The selected improvements from the [2 October priorities](IMPROVEMENT_PRIORITIES.md) and [catalogue](IMPROVEMENT_CATALOGUE.md) are implemented locally. They make incomplete browsing and search honest, preserve account and offline-data boundaries, and improve existing workflows without adding a backend store, framework or paid Cloudflare requirement.

**3 October 2026 status:** root validation, focused corrections, screenshot and PWA gates passed; independent combined source, integration and UI review approved the local release candidate, with all 19 UI checks passing for the observed local scope. The reviewer inspected the current rendered evidence, test corrections and final inventory. The original browser-run failures and unchanged audio replay remain explicit in [Testing](TESTING.md). This work has not been deployed. Cloudflare readback and the canonical Worker dry-run cannot authenticate in the configured noninteractive environment. No commit, push or tracker change has been made.

## Selected outcomes

| Priority | Delivered behavior | Remaining scope |
|---|---|---|
| 1. Folder completeness | Bounded listings carry complete/partial metadata. Partial and older unverified cached listings expose a small optional explanation. Recursive offline, ZIP and merge operations cannot silently treat incomplete enumeration as exhaustive. | A folder still returns at most 200 direct children; full XML parsing remains. Large-folder pagination is not implemented. |
| 2. Account removal | Removal purges the target account's cache, retained data, offline preference and playback positions, while preserving other accounts and cloud files. Ambiguous namespaces and storage failures keep cleanup retryable. | Revoking the Nextcloud app password remains a separate action in Nextcloud. |
| 3. Offline readiness | Settings retains saved/incomplete/missing/empty states after reload. Retry uses the original retained selection, reuses readable same-size originals, and can be canceled through the existing transfer tray. Optional storage details distinguish account cache, kept originals and approximate browser-origin usage. | No automatic resume or generic transfer journal. Same-size reuse does not prove remote freshness; browser quota is not free disk space or a success guarantee. |
| 4. Transfer safety | Base64 validation no longer overflows the stack on large input. Browser cancellation stays attached through response-body consumption. Five header-session mutation routes authorize before JSON parsing. | No supported production size envelope, blanket ZIP/upload cap, Worker-to-provider cancellation/deadline guarantee, or local Node buffering redesign. |
| 5. Connection guidance | Existing forms explain encrypted server custody, the configured default folder and local removal accurately. Longer help is optional and keyboard/touch accessible. | No new authentication flow or provider-side revocation mechanism. |
| 6. Verification baseline | The missing NAV-07 contract inventory entry is restored. Current root gates pass with the exact dependency lockfile and Node 22.22.2. | A broad CI or setup-diagnostics project was not selected. |
| 7. Search coverage | Both backends share one serial bounded search policy. Live partial, saved and explicit-offline results have distinct explanations and empty states; ordinary complete results retain their normal density. | At most 50 external listings, 200 examined children per listing, 20 results and visited depths 0–3. No continuation, index or complete-library search. |
| 8. Startup work | JSZip loads at the two existing asynchronous ZIP entry points. A controlled comparison removed 31,316 gzip bytes from initial entry code. Settings now closes before opening its report dialog, so it cannot obstruct report export. | Total service-worker precache is effectively unchanged. Device startup speed and a PDF viewport rewrite were not established. |

The actual Worker route with a fake DAV upstream proves the search request makes at most 50 external listing calls, sequentially consuming each body before the next call. This is a tested request bound, not a production Cloudflare CPU, memory, quota or billing measurement.

## Catalogue disposition

Every proposal is accounted for below. Partial delivery is intentional where the evidence supported a narrow correction rather than a larger redesign. The original catalogue contains 33 IDs and no C26.

| IDs | Disposition |
|---|---|
| C01 | Bounded completeness and safe consumers implemented; full enumeration deferred. |
| C02 | Bounded coverage and truthful search presentation implemented; exhaustive continuation/indexing deferred. |
| C03, C04 | Persisted readiness and optional storage detail implemented. |
| C05 | Validator defect repaired and local measurements collected; production size envelope unverified. |
| C06 | Download protocol/buffering rewrite deferred; evidence did not justify broader transport architecture. |
| C07 | Blanket archive caps/rewrite deferred without verified useful thresholds. C01 guards and targeted cancellation fixes remain separate delivered protections. |
| C08 | Browser response-body cancellation implemented; Worker/provider propagation and deadlines deferred. |
| C09 | Authorization before parsing implemented for five header-session mutations; authenticated body caps, body-token route and Node ingress buffering remain. |
| C10, C11 | Narrow connection, custody and revocation guidance implemented; no new authentication system. |
| C12 | Target-account local cleanup implemented. |
| C13 | NAV-07 inventory repair implemented; broad CI initiative unselected. |
| C14 | Verified toolchain used for this work; setup diagnostics feature unselected. |
| C15 | Two deferred ZIP imports implemented; initial code bytes measured, device speedup unverified. |
| C16 | PDF viewport/lifetime rewrite deferred pending representative workload evidence and lifecycle design. |
| C17, C20 | Large-count transfer presentation and generic dependency-readiness work unselected. |
| C18 | Retained-root retry/cancel implemented; generic restartable transfers deferred because reliable recoverable source data is not available. |
| C19 | General interaction cleanup unselected. One reproduced Settings/report overlap was corrected; mobile focus return from a disconnected drawer opener remains a pre-existing follow-up. |
| C21, C23 | Broad adapter-test and test-semantics initiatives unselected; targeted regression coverage added where required for the selected changes. |
| C22 | This current disposition and handover record delivered; broad product/extension map unselected. |
| C24 | Standalone repair-history notices deferred; retained readiness already explains the supported recovery case. |
| C25 | Settings reorganization unselected; existing compact surfaces retained. |
| C27, C28, C29, C30, C31, C32, C33, C34 | Offline packs, Recent/reopen, saved searches, share-to-upload, cloud recovery, command palette, advanced Nextcloud handoff and browser-assisted connection remain unselected product experiments. |

## Validation and evidence

Root validation passed on 3 October: lint with 311 existing baselined findings and no new debt; quality and all workspace type checks; architecture with 522 modules and no cycles; dependency rules with no violations; and 3,580 tests across web (3,049), Worker (377), shared (113), deployment tooling (22) and quality tooling (19). All workspace builds passed. The existing Vite large-chunk advisory remains.

Packet evidence additionally includes native browser body termination after headers, target-account persistence tests, desktop/mobile disclosure geometry and interaction, and an actual installed-PWA first ZIP export. The latter used explicit offline plus genuine browser network offline, made zero API requests during the observation window, loaded the deferred ZIP chunk from the service worker, and produced a decoded 2,798-byte report archive with the expected synthetic fields. The Settings/report browser regression uses ordinary hit testing and validates ZIP contents.

The account-purge negative control was replayed after implementation; its original failed environment is not represented as a behavioral red test. Search preserved five causal preimplementation failures and one setup failure, then replayed all six corrected cases against the isolated original source. Delayed ZIP import/currentness tests are supplementary characterization. These distinctions prevent overstating tests-first evidence.

Detailed current commands and aggregate outcomes belong in [Testing](TESTING.md); the rendered walkthrough and combined review belong in [UX review](UX_REVIEW.md). Stable invariants and test owners are in the [behavior contract](BEHAVIOR_CONTRACT.md).

## Release boundary

Worker must publish before web: new Worker preserves the negotiated legacy listing/search responses, while the new client requires current metadata and fails safely against the old Worker. Already-open or installed old clients can persist. Rollback must retain a compatible Worker or coordinate both sides; an update prompt does not prove every client migrated.

Release is currently blocked by configured Cloudflare authentication. Both read-only deployment lookup and the canonical Worker dry-run exited before a deployment identity or bundle was produced; no upload occurred. The current local changes are not evidence of a deployed version.

Optional live Nextcloud validation was not run. A read-only check found the exact `.davora-agent-test` sandbox already exists, but its contents were not established as disposable. The existing validation script deletes that entire root, so no write or cleanup was attempted. Deterministic Worker/fake-DAV tests cover the new contracts; they do not claim real-provider workload, latency or production behavior.
