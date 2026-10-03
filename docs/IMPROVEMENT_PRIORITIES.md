# Davora improvement priorities

3 October 2026: implementation outcomes, deliberate deferrals and current validation/release status are recorded in [Davora improvements implementation](IMPROVEMENT_IMPLEMENTATION.md). The review below is preserved as the original proposal.

Review date: 2 October 2026. Source snapshot: [`3cd19c3`](https://github.com/nazar256/davora/tree/3cd19c3c39ab5babaf93e6801e8a720e94ef5ab0).

Davora already does much of the difficult work: account isolation, explicit offline mode, retained original files, cancellable workflows, media previews, and a modular architecture with extensive tests. The best next step is to make its existing promises dependable and easy to understand at realistic file-library sizes.

This is a proposed improvement portfolio, not an implementation plan or release approval. No application code was changed. The [full catalogue](IMPROVEMENT_CATALOGUE.md) contains 33 ideas, evidence, trade-offs, acceptance criteria, and deferred alternatives.

## The eight most valuable improvements

### 1. Never call a partial folder complete

**Why first:** this affects the truth of browsing, folder downloads, and offline preparation. The Nextcloud adapter parses a folder response and silently returns at most 200 children. The normalized API carries no completeness indicator.

A deterministic probe supplied 205 children, including a nested folder beyond the cutoff. Davora returned 200, never visited the omitted folder, downloaded the 200 planned files, and reported offline completion. This proves the local failure path; it does not establish production occurrence or remote data loss.

**First useful change:** carry completeness through the Worker/shared API and recursive planners. A bounded browse result can remain bounded, but offline preparation and ZIP creation must enumerate everything or explicitly stop/report partial scope. Simply removing the cap would move the scaling problem into rendering, caching, and recursive work.

**Success:** a folder above the boundary either includes every expected child or produces an unmistakably incomplete outcome. No incomplete plan can mark a retained root complete.

**Cost:** medium agent effort across existing API, adapter, planner, and test owners; careful human contract review; modest ongoing maintenance. [C01 and supporting parity tests](IMPROVEMENT_CATALOGUE.md#c01-complete-folder-enumeration-and-honest-recursive-results).

### 2. Make removing an account remove all of its local information

The current removal flow correctly revokes authority and purges major caches, but omits the explicit-offline account set and audio playlist/resume records. Those records can retain account-linked names, paths, and listening positions. The reviewed consumers remain account-scoped; this is not a demonstrated cross-account leak.

**First useful change:** add those stores to the existing retryable local-purge lifecycle and maintain an explicit inventory of account-owned persistence.

**Success:** seed accounts A and B, remove A, and prove every A-owned record is gone while B remains intact. A failed cleanup stays retryable.

**Cost:** small to medium agent effort; focused privacy/lifecycle review; low maintenance. [C12](IMPROVEMENT_CATALOGUE.md#c12-complete-account-local-cleanup).

### 3. Make offline readiness visible after reload

Retained roots already know whether they are incomplete and how many files are readable. Settings currently drops that information when it builds its display items. Existing live retry support does not solve the later question: “Is this folder actually ready to take with me?”

**First useful change:** show complete/incomplete/readable status and a recheck/retry action using the existing retained-root model. Show retained storage separately from evictable cache and add a clearly approximate device-storage indication where supported. The 1 MB–8 GB cache setting intentionally does not cap retained originals.

**Success:** partial sync followed by reload remains visibly incomplete and recoverable; “ready” requires readable original bytes and a complete source enumeration. Clearing ordinary cache still preserves retained files.

**Cost:** medium agent effort; one human decision on status language; moderate browser-storage maintenance. [C03 and C04](IMPROVEMENT_CATALOGUE.md#c03-offline-readiness-that-survives-reload).

### 4. Define a supported large-file envelope before redesigning transfers

Uploads pass through base64 JSON; ordinary downloads buffer complete files in both Worker and browser; ZIP creation retains downloaded inputs and generates a final Blob. These are confirmed implementation paths, not measured crashes. Audio/video playback already has a separate ranged streaming path.

**First useful change:** measure representative files and archives, define supported byte/item/depth limits, reject unsafe work early, and make planning/downloading/compression/cancellation states truthful. Replace buffering or encoding only where measurements show intended workloads cannot fit.

**Success:** supported sizes finish within a defined memory/time budget; oversized or unknown-size jobs have explicit outcomes; cancelling cannot later trigger an unwanted save. No raw credentials or reusable sessions enter download URLs.

**Cost:** medium effort for measurement and admission; potentially large for subsequent transport changes. Human review should decide the supported workload before approving that larger work. [C05–C07 and C09](IMPROVEMENT_CATALOGUE.md#c05-a-measured-upload-envelope).

### 5. Make connection setup understandable and accurate

The form collects server URL, username, app password, root, and label, but provides little contextual help. Its statement that the password is “used only to connect” also understates ongoing encrypted Worker custody. “Not stored in this browser” is the accurate browser-specific distinction.

**First useful change:** explain app-password creation, the optional root, credential custody, removal, and provider-side revocation at the relevant decision points. Keep routine copy short, with details available on demand.

**Success:** a new user can connect and recover from an invalid host/password/root without reading operator documentation, and can explain where credentials live and how access is revoked.

**Cost:** small initial agent effort; short copy/privacy review and a few observed user tasks; low maintenance. A browser-assisted Nextcloud login is a separate experiment, not a prerequisite. [C10, C11, and C34](IMPROVEMENT_CATALOGUE.md#c10-guided-connection-and-actionable-reconnect).

### 6. Restore a clean test baseline and make verification repeatable

The clean-snapshot run passed 3,340 tests and failed one: `NAV-07` exists in the behavior contract but is missing from the executable coverage index. Type checking, lint, architecture checks, and the build passed. Repository-owned CI definitions were not found; external automation was not inspected.

**First useful change:** map `NAV-07` to its real regression evidence without weakening the assertion. Establish a clean-lockfile verification path, supported toolchain/browser prerequisites, and automated checks. Separate ordinary browser verification from screenshot regeneration, which currently happens inside `test:e2e`.

**Success:** a clean clone detects this mismatch automatically, preserves tracked evidence during verification, and produces identifiable check artifacts. Deployment remains a separately authorized action.

**Cost:** small to medium agent effort; little human decision-making; ongoing CI execution and dependency upkeep. [C13, C14, and C21](IMPROVEMENT_CATALOGUE.md#c13-a-reproducible-automated-quality-gate).

### 7. Tell users what search covered

Real search stops at 20 results, 64 visited folders, and three descendant levels, and also inherits the folder-list cap. The response does not explain the covered scope or whether more work remains. The mock scans a different scope, so routine mock success is insufficient evidence of real search usefulness.

**First useful change:** expose scope and incompleteness, then offer an explicit bounded continuation or narrower search. Keep name/path search distinct from an expensive full-text indexing project.

**Success:** users can distinguish “no match in the searched scope” from “this file does not exist,” and both adapters exercise the same boundary cases.

**Cost:** medium agent effort; a product decision on continuation and limits; modest maintenance. [C02](IMPROVEMENT_CATALOGUE.md#c02-search-with-visible-scope-and-limits).

### 8. Measure and reduce startup and long-document work

The clean production build has a 1,054.46 kB main JavaScript chunk, 314.51 kB gzip. The PDF application chunk is 535.21 kB, 162.31 kB gzip. PDF/HEIC already have lazy-loading boundaries, but the PDF viewer renders pages sequentially across the document. File sizes establish an opportunity to investigate; they do not prove slow interaction on users' devices.

**First useful change:** define cold/warm browse and first-page budgets on a representative mobile device/network. Attribute eager code, delay secondary features where beneficial, and test visible/nearby-page rendering for long PDFs.

**Success:** measurable first-use improvement with bounded canvas work, preserved zoom/navigation/cleanup, and unchanged offline/PWA update behavior.

**Cost:** medium agent effort; performance/browser review; moderate maintenance. [C15 and C16](IMPROVEMENT_CATALOGUE.md#c15-startup-budgets-and-secondary-feature-loading).

## The most interesting product bets

These are experiments with plausible value, not demand proven by this review.

- **Ready to leave:** turn existing retained folders into a trip/project checklist with verified completeness, readable files, space requirements, and an offline rehearsal. This is the strongest extension of Davora's existing differentiation. Fix completeness first. [C27](IMPROVEMENT_CATALOGUE.md#c27-ready-to-leave-offline-packs).
- **Continue where I left off:** a small account-local Recent view, optionally paired with saved scoped searches, could shorten repeated file work without adding backend persistence. Test against existing favourites and browser history first. [C28 and C29](IMPROVEMENT_CATALOGUE.md#c28-account-local-recent-and-reopen).
- **Send this file to Nextcloud:** test one supported share-to-upload flow that confirms account and folder before using the existing upload path. Prove the browser/OS fit before building an inbox. [C30](IMPROVEMENT_CATALOGUE.md#c30-share-to-davora-upload).

## Suggested sequence

Start with completeness, account cleanup, and the failed contract index. Then make offline readiness and connection guidance clear. Establish realistic file/library fixtures and operation budgets before selecting a transport or performance redesign. Run one small product experiment at a time after these foundations are trustworthy.

Preserve the existing architecture. A global store, another App decomposition, generic WebDAV, team collaboration, server-side indexing, or new backend persistence would need a concrete problem and evidence that the smaller alternatives are insufficient.

The current desktop/mobile walkthrough also supports testing [task-oriented settings](IMPROVEMENT_CATALOGUE.md#c25-settings-organized-around-frequent-tasks) and checking [consistent dialog dismissal](IMPROVEMENT_CATALOGUE.md#c19-consistent-dialog-back-focus-and-gesture-behavior). These are useful focused follow-ups, not evidence that the whole interface needs a redesign.

The [catalogue's evidence record](IMPROVEMENT_CATALOGUE.md#evidence-and-review-limits) distinguishes current source, local execution, browser observations, and unverified production or user-impact claims.
