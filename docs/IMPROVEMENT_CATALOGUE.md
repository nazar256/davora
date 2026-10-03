# Davora improvement catalogue

3 October 2026: all proposal dispositions and current validation/release status are recorded in [Davora improvements implementation](IMPROVEMENT_IMPLEMENTATION.md). The review below is preserved as the original proposal.

Review date: 2 October 2026. Reviewed source: [`3cd19c3c39ab5babaf93e6801e8a720e94ef5ab0`](https://github.com/nazar256/davora/tree/3cd19c3c39ab5babaf93e6801e8a720e94ef5ab0). Start with the [eight priorities](IMPROVEMENT_PRIORITIES.md) for the decision-ready version.

This catalogue contains 33 proposed improvements across product, UX, reliability, performance, architecture, testing, and operations. It deliberately includes attractive experiments as well as concrete gaps. It does not authorize implementation or claim that every idea should be built.

The recommendation is to make personal Nextcloud file work dependable across accounts, mobile use, and connectivity changes. Existing multi-account support, favourites, selection, conflict handling, retry, offline retention, PWA behavior, and media streaming are foundations to preserve.

## How to read the proposals

**Do first** identifies the priorities or their necessary supporting slices. **Next** means useful follow-on work. **Explore** means validate demand or feasibility before committing. IDs are stable references; related entries can share one delivery effort.

Effort describes agent delivery and verification, not person-days: **small** is a focused owner/check set; **medium** crosses several existing owners with integration or browser evidence; **large** changes substantial contracts or platform behavior. Each entry separately names human attention and maintenance. Confidence applies to the present-state evidence; user frequency and commercial demand were not measured.

Source links point to current repository files; line numbers and the snapshot above identify the reviewed version. Test-source inspection proves a test exists, while the fresh execution results are recorded separately below.

## File completeness and finding things

### C01 Complete folder enumeration and honest recursive results

**Do first · high confidence · medium effort.** The [Nextcloud adapter](../apps/worker/src/nextcloud/client.ts) parses full XML and locally slices it at lines 176–202 and 255–265. The [folder contract](../packages/shared/src/api/files.ts) carries only path/items. [Archive planning](../apps/web/src/lib/batchDownload.ts) and [offline planning](../apps/web/src/features/offline/sync/planAdapters.ts) treat those arrays as exhaustive.

A synthetic full response with 205 children returned 200; the omitted nested folder was never traversed, and the actual offline controller reported completion. Introduce completeness metadata and safe enumeration or an explicit partial outcome. Keep browse rendering limits separate from recursive-job correctness.

**Acceptance:** more-than-200 and nested fixtures cannot produce a complete retained root or successful complete-folder archive with missing entries. **Human attention:** API semantics and partial-operation review. **Maintenance:** modest shared-contract/adapter coverage. Removing every limit without a replacement budget is not the proposed fix.

### C02 Search with visible scope and limits

**Do first/Next · high source confidence · medium effort.** [Real search](../apps/worker/src/nextcloud/client.ts) at lines 372–404 is bounded to 20 results, 64 folders, and depth three; [the search schema](../packages/shared/src/api/search.ts) has no coverage/continuation field. [Mock search](../apps/worker/src/mock/data.ts) follows different bounds.

Show the active folder and covered scope, disclose truncation, and explore an explicit bounded continuation. Keep full-text indexing out of this slice. **Acceptance:** distinguish an exhausted search from an incomplete search, preserve cancellation, and run both adapters through matching boundary scenarios. **Human attention:** choose continuation/limits. **Maintenance:** modest API/UI cost.

## Offline use and storage

### C03 Offline readiness that survives reload

**Do first · high source confidence, rendered impact needs a targeted fixture · medium effort.** [Retained summaries](../apps/web/src/features/offline/retention/model.ts) contain completeness, readable count, and availability; [the settings projection](../apps/web/src/features/offline/workspace/useOfflineApplicationWorkspace.ts) at lines 166–185 drops them. [Settings](../apps/web/src/features/settings/settingsDialog/CachePanel.tsx) shows retained roots and removal, without that status/recovery detail.

Expose incomplete/ready/unreadable states and a recheck/retry action using existing sync ownership. Live partial-result reporting and retry already exist. **Acceptance:** partial sync → reload still identifies the incomplete root and offers recovery; ready requires complete enumeration and readable originals. **Human attention:** one status vocabulary review. **Maintenance:** modest, with no new global workflow store.

### C04 Storage information that matches physical usage

**Do first with C03 · high source confidence · medium effort.** [Cache accounting](../apps/web/src/platform/storage/openedFileRepository.ts), lines 566–618, intentionally excludes retained originals from normal-cache eviction and its 1 MB–8 GB control. [Storage estimates](../apps/web/src/platform/diagnostics/browserDiagnosticsEnvironment.ts) currently serve diagnostics rather than normal storage decisions.

Show aggregate retained content separately, distinguish logical cache limits from approximate browser-origin quota, and make insufficient-space outcomes actionable. **Acceptance:** unknown quota stays unknown; overlapping retained roots do not inflate a claimed physical total; clearing normal cache preserves originals. **Human attention:** storage wording and policy. **Maintenance:** browser variability; an origin-wide estimate is not exact free space reserved for Davora.

### C18 Recover interrupted work after restart

**Explore after C03 · medium confidence in value · large effort.** [Transfer state](../apps/web/src/features/transfers/useTransfers.ts) and [copy/move retry specifications](../apps/web/src/features/operations/copyMove/tasks.ts) are runtime-owned, while retained roots survive in browser storage.

Start with a narrow offline-sync resume/recheck record in the browser. Reconcile what is readable under the current account and authority before resuming; do not persist reusable authorization or promise operating-system background execution. **Experiment/acceptance:** interrupt a sync, reload, and recover only unfinished safe work without repeating successful downloads. **Human attention:** lifecycle and privacy policy. **Maintenance:** migration/expiry semantics. This is larger than displaying an existing incomplete root.

### C24 Explain local repair and degraded retained data

**Next · high source confidence, frequency unmeasured · small/medium effort.** [Opened-file storage](../apps/web/src/platform/storage/openedFileRepository.ts), lines 638–735, validates and repairs persisted data, including dropping malformed entries and detaching best-effort repair writes.

Provide a concise recovery explanation when retained data is structurally discarded or unreadable, with a local recheck/re-download path and a bounded diagnostic reason. **Acceptance:** corrupt/missing/temporarily unavailable states stay distinct; interactive reads remain responsive; raw private paths do not enter general telemetry. **Human attention:** recovery wording. **Maintenance:** small if attached to existing storage outcomes.

## Transfers and backend reliability

### C05 A measured upload envelope

**Do first as measurement/admission · high source confidence · medium initially, potentially large later.** [Upload preparation](../apps/web/src/platform/upload/browserUploadFileContent.ts) reads a complete data URL; [the API](../apps/web/src/lib/api.ts) sends base64 JSON; [Nextcloud upload](../apps/worker/src/nextcloud/client.ts), lines 427–443, decodes it to a Buffer. There is no explicit maximum payload length in [the upload schema](../packages/shared/src/api/folderUpload.ts).

Measure representative files, define supported limits, and reject oversize work before expensive materialization. Evaluate binary/chunked transport only if the supported workload requires it. **Acceptance:** measured max-size behavior, early rejection, correct progress/cancel/partial outcomes. **Human attention:** workload and protocol/security decisions. **Maintenance:** low for admission, higher for a new transport. No observed crash rate is claimed.

### C06 Reduce full-file buffering in ordinary downloads

**Next within the transfer priority · high source confidence · medium/large effort.** The active [download orchestration](../apps/web/src/features/operations/download/orchestration.ts), [browser runtime](../apps/web/src/platform/api/browserOperationRuntime.ts), and [API Blob path](../apps/web/src/lib/api.ts) buffer a full file. The [Worker backend contract](../apps/worker/src/files/backend.ts) also uses complete byte arrays for ordinary originals/downloads. Media has a separate streaming path already.

Benchmark ordinary saves and investigate a browser-native/streamed handoff with a clear fallback. The existence of a Worker POST download route alone does not prove the active browser path uses it. **Acceptance:** fewer full-file materializations for supported large saves, correct filename/authority, bounded cancellation, no reusable credentials in URLs. **Human attention:** browser/security review. **Maintenance:** compatibility and fallback coverage.

### C07 Archive preflight and honest phase cancellation

**Next within the transfer priority · high source confidence · medium effort.** [Batch download](../apps/web/src/lib/batchDownload.ts), lines 68–171, builds a recursive plan, stores fetched blobs in JSZip, and generates a final compressed Blob. It has no app-level byte/item/depth budget or direct cancellation of ZIP generation.

Show known/unknown size and planning/download/compression phases; establish a safe envelope, then offer a split or explicit refusal when necessary. **Acceptance:** large synthetic jobs terminate predictably; incomplete listings never look exhaustive; cancellation during planning or compression cannot later save an archive. **Human attention:** thresholds and fallback behavior. **Maintenance:** modest initially; streaming ZIP generation is a separate measured decision.

### C08 Deadlines and cancellation through the upstream boundary

**Next · high source confidence, incidence unmeasured · medium effort.** [Nextcloud request execution](../apps/worker/src/nextcloud/client.ts), lines 157–173, has no explicit per-operation timeout/abort policy. Browser explicit-offline mode already aborts registered backend requests through [the network gate](../apps/web/src/lib/networkPolicy.ts); it should not be described as missing.

Define operation-specific deadlines and cancellation propagation. Treat unknown mutation outcomes differently from safe read retries. **Acceptance:** a hanging fake upstream reaches a useful terminal state, stale owners cannot update the new account, and an already-applied mutation is not blindly replayed. **Human attention:** mutation/retry semantics. **Maintenance:** moderate, kept at the existing client boundary.

### C09 Authenticate and bound bodies before expensive parsing

**Do first supporting C05 · high source confidence · medium effort.** [Route parsing](../apps/worker/src/http/router.ts) can materialize JSON/form bodies before authority resolution; returning authentication errors first does not avoid that earlier work. [Diagnostic upload](../apps/worker/src/diagnostics/reportInbox.ts) already demonstrates authenticated, bounded ingress for its own endpoint.

Separate cheap route selection from authenticated, size-bounded parsing for expensive payloads. Include [the local Node bridge](../apps/worker/src/node-server.ts), which currently buffers incoming bodies. **Acceptance:** unauthorized/oversized requests stop without full materialization or upstream work; valid response/error contracts remain intact. **Human attention:** security and compatibility review. **Maintenance:** low if expressed as a shared ingress policy. This is resource hardening, not a demonstrated exploit.

### C17 Transfer failures at large counts

**Next · high source confidence, scale unmeasured · small/medium effort.** [Transfer history](../apps/web/src/features/transfers/model.ts) and [tray selectors](../apps/web/src/features/transfers/selectors.ts) bound task rows, but [the tray](../apps/web/src/features/transfers/tray/TransferTrayStage.tsx) renders each displayed task's full failure list.

Summarize counts and progressively reveal/search failures; retain precise retry accounting and optional local copy/export. **Acceptance:** a 1,000-failure fixture remains navigable and every unresolved item is accessible. **Human attention:** small UX review. **Maintenance:** low. Do not add noisy per-file remote telemetry merely to support this view.

### C20 Readiness for core and optional dependencies

**Next · high source confidence · small/medium effort.** [Configuration health](../apps/worker/src/config.ts), lines 235–268, checks config syntax/policy, while [account service construction](../apps/worker/src/accounts/factory.ts) can provide an unavailable store and diagnostics can fail later on missing optional bindings.

Distinguish public configuration health, core account-store readiness, and optional diagnostic availability. **Acceptance:** unusable core storage cannot look fully ready; optional reporting does not make file browsing unhealthy; no account identity or secrets leak through health. **Human attention:** operator semantics. **Maintenance:** low; avoid expensive or mutating health probes.

## Connection, trust, and everyday interaction

### C10 Guided connection and actionable reconnect

**Do first · high source confidence · small/medium effort.** [The account form](../apps/web/src/features/accounts/connect/AccountFormStage.tsx) asks for server, username, app password, root, and label. [Reconnect](../apps/web/src/features/accounts/connect/ConnectAccountStage.tsx) reuses that foundation.

Add concise help for finding/creating an app password, URL shape, optional root, and the difference between reconnecting and adding a new account. Map failure classes to the next useful action. **Acceptance:** observed new-user tasks complete without operator docs; invalid host/password/root receives specific guidance without exposing credentials. **Human attention:** copy plus a small comprehension test. **Maintenance:** low. OAuth or another authentication architecture is unnecessary for this first slice.

### C11 Explain credential custody and revocation accurately

**Do first with C10 · high confidence · small effort.** [Form copy](../apps/web/src/features/accounts/connect/AccountFormStage.tsx), line 83, says the password is used only to connect. [Account persistence](../apps/worker/src/accounts/repository.ts) and [the encrypted codec](../apps/worker/src/accounts/persistedAccountStateCodec.ts) retain it for subsequent Worker requests.

Explain that raw passwords are not kept in browser storage, while the connected service keeps encrypted credentials for ongoing access. Distinguish removing Davora's connection from revoking the app password at Nextcloud. **Acceptance:** users can answer where credentials live and how access is revoked. **Human attention:** brief privacy/copy review. **Maintenance:** negligible unless custody changes.

### C12 Complete account-local cleanup

**Do first · high source confidence · small/medium effort.** [Account removal](../apps/web/src/app/createAccountRemovalRuntime.ts) purges major cache/favourite/sort stores, but has no purge port for [explicit-offline account IDs](../apps/web/src/platform/storage/browserExplicitOfflineModeStorage.ts), [folder-audio state](../apps/web/src/features/preview/folderAudio/model.ts), or [audio resume positions](../apps/web/src/lib/audioResume.ts).

Bring these into the existing revoke-then-purge lifecycle and keep an inventory of every account-owned persistent store. **Acceptance:** remove A with A+B records seeded, prove all A records removed, B unchanged, and cleanup failure retryable. **Human attention:** privacy and legacy-key review. **Maintenance:** low. The demonstrated gap is local residue; no cross-account read was established.

### C19 Consistent dialog Back, focus, and gesture behavior

**Next · source inconsistency plus a bounded browser observation · small/medium effort.** [Navigation surfaces](../apps/web/src/features/navigation/model.ts) and [their coordinator](../apps/web/src/features/navigation/workspaceSurfaceController.ts) know folder shortcuts/reporting; [quick-action suppression](../apps/web/src/features/browsing/quickActions/workspace/useQuickActionsWorkspace.ts) uses a different list. Offline-sync confirmation is represented in the latter, not the navigation surface union. In the local mobile walkthrough, browser Back left Keep offline confirmation open; in the desktop shortcut flow it dismissed the shortcut while preserving underlying details. Settings also remained open after the sampled Escape action but closed on browser Back.

Write a small intended-behavior matrix, add focused interaction checks, and repair only proven omissions. Keep workflow state feature-owned. **Acceptance:** each overlay has explicit Back/Escape/scrim/return-focus/gesture behavior, including replacement and account switch. **Human attention:** sensitive navigation semantics. **Maintenance:** low with exhaustive contracts. A new global modal/workflow store is not justified.

These observations are a prompt for deterministic reproduction with controlled history and intended behavior, not proof that every dismissal difference is a defect. Physical mobile system-Back and all overlay combinations were not tested.

### C25 Settings organized around frequent tasks

**Next as a design experiment · current browser evidence, user benefit unmeasured · small/medium effort.** At 390×844, the initial settings viewport is occupied by theme and account identity/details; storage, retained files, power, view, support, and experiments continue below it. At 1440×900 the first viewport reaches the beginning of storage. This matches [the settings composition](../apps/web/src/features/settings/settingsDialog/SettingsDialogStage.tsx); it does not by itself prove users are confused.

Prototype direct entry points for Accounts, Offline and storage, and Appearance, with connection metadata and advanced/support settings disclosed when needed. Keep current controls and focus behavior; avoid creating a multi-page settings application. **Experiment/acceptance:** compare time/interactions to switch account, verify an offline folder, and free cache space, including keyboard and narrow-screen use. **Human attention:** task ranking and a brief usability comparison. **Maintenance:** low if it reorganizes existing feature-owned views. Coordinate the offline entry point with C03 instead of adding a second readiness model.

## Performance and maintainability

### C15 Startup budgets and secondary-feature loading

**Do first as measurement · high build/source confidence, speed impact unmeasured · medium effort.** The clean build produced main JS 1,054.46 kB/314.51 kB gzip, PDF app 535.21 kB/162.31 kB gzip, and a 25-entry PWA precache of 3,371.89 KiB. [PWA configuration](../apps/web/vite.config.ts) already excludes heavy HEIC assets; PDF and HEIC decoder imports are already lazy.

Measure cold/warm first browse on a representative mobile target, attribute eager code, and defer infrequently used archive/report/advanced surfaces only when the benefit exceeds first-use delay. **Acceptance:** a stated timing/transfer budget improves without breaking shell availability or updates. **Human attention:** device/workload target and performance review. **Maintenance:** moderate. Chunk size alone is not a user-latency result.

### C16 Render PDF pages near the viewport

**Do first/Next after measurement · high source confidence · medium effort.** [PDF interaction](../apps/web/src/features/preview/pdf/usePdfPreviewInteraction.ts), lines 221–298, loads full bytes and renders pages sequentially across the document. [The PDF view](../apps/web/src/features/preview/pdf/PdfPreviewStage.tsx) allocates page canvases. Cancellation/destruction safeguards already exist.

Benchmark long documents; prioritize visible/nearby pages and release distant canvases while preserving page tracking and zoom. **Acceptance:** a long-PDF fixture has bounded render/canvas work, prompt first-page visibility, correct jumps/zoom, and reliable replacement/unmount cleanup. **Human attention:** media/browser review. **Maintenance:** moderate. Avoid an arbitrary page limit without an intended workload.

### C13 A reproducible automated quality gate

**Do first · executed evidence · small/medium effort.** Root [test scripts](../package.json) are substantial, but no repository-owned CI definition was found. The fresh run failed [the behavior coverage index](../apps/web/src/features/behaviorContractCoverage.test.ts) because [NAV-07](BEHAVIOR_CONTRACT.md) is absent from its ID/owner map. The latest navigation behavior has its own source/tests; the failure is an inventory mismatch, not proof scroll restoration is broken.

Map the ID to real evidence without weakening the assertion. Automate clean-install lint/type/unit/build and proportionate browser/PWA gates, with immutable results. Separate `test:e2e` verification from the screenshot-writing command. **Acceptance:** the current mismatch is caught on a clean clone and ordinary checks never rewrite tracked screenshots. **Human attention:** workflow/platform choice. **Maintenance:** CI cost and dependency upkeep. External CI existence remains unverified.

### C14 Supported toolchain and local setup diagnostics

**Do first with C13 · directly observed environment evidence · small effort.** The checkout's default Node was below [the required version](../package.json), and installed dependencies differed from the lockfile and lacked declared packages. A clean archived snapshot with Node 22.22.2 and a lockfile install built successfully; this was an environment problem, not a source-build defect.

Document/pin supported runtime and package-manager expectations, prefer a clean-lockfile setup path, and provide a read-only preflight for version/dependency/browser/port mismatches. **Acceptance:** a fresh contributor reaches the mock app without hidden adjustments, while stale installs fail with useful guidance. **Human attention:** small tooling decision. **Maintenance:** periodic version updates; do not add a container platform solely for this check.

### C21 Tests that represent real adapter boundaries

**Do first supporting C01/C02 · high confidence · medium effort.** [The mock backend](../apps/worker/src/mock/data.ts) exposes all matching entries, while [the real adapter](../apps/worker/src/nextcloud/client.ts) applies local bounds. The completeness probe showed that the same downstream planner succeeds differently with those inputs.

Add shared adapter-contract scenarios plus explicit realistic fixtures: 205 siblings with a late nested folder, deep search, partial listing, many failures, quota/corrupt storage, and hanging upstream. **Acceptance:** mock success cannot substitute for a missing real-adapter completeness signal; every top recommendation gains one meaningful regression scenario. **Human attention:** low, review fixture realism. **Maintenance:** moderate; avoid duplicating the same case at every layer.

### C22 Current product and extension map

**Next · high source confidence · small effort.** [The PRD](PRD.md) and [redesign brief](FILE_MANAGER_REDESIGN_BRIEF.md) predate current favourites, bulk selection, and other features. [Architecture](ARCHITECTURE.md) mixes useful boundaries with historical size/phase records; [tasks](TASKS.md) mix implementation and release authority/status.

Curate a short current capability map and “change this here; preserve this contract; run these checks” guide. Keep implemented, tested, deployed, and authorized states separate; label historical measurements as historical. **Acceptance:** a contributor locates a semantic owner without replaying phase logs. **Human attention:** scope/source-of-truth agreement. **Maintenance:** low if concise; no new documentation portal required.

### C23 Test semantics instead of implementation spelling

**Next when touched · high sampled source confidence · small incremental effort.** [Composition tests](../apps/web/src/app/useBrowserWorkspaceComposition.test.tsx) include assertions against exact import/call/variable strings. Other lifecycle and architecture tests already provide substantial behavioral protection.

Classify these checks as durable boundaries, behavior guarantees, or completed-migration tripwires. Replace only redundant spelling checks with semantic dependency/AST or public-boundary behavior tests. **Acceptance:** harmless renaming passes, while wrong ownership/stale callbacks fail; equivalent or stronger coverage is green before removing old checks. **Human attention:** coverage-equivalence review. **Maintenance:** lower refactor churn. A wholesale test rewrite would cost more than this evidence supports.

## Product experiments worth testing

### C27 Ready-to-leave offline packs

**Explore · strong fit with existing capabilities, demand unverified · medium/large effort after a prototype.** [Retained roots](../apps/web/src/features/offline/retention/model.ts), [sync confirmation](../apps/web/src/features/offline/sync/confirm/OfflineSyncConfirmStage.tsx), and explicit offline mode already cover much of the underlying work.

Prototype a trip/project checklist that answers which selected files are complete, readable, fresh enough, and affordable to retain, followed by an offline rehearsal. Start as a view over existing roots, not a new sync engine or backend store. **Experiment:** observe users preparing a real task and verifying readiness with/without the checklist. **Dependencies:** C01/C03/C04. **Human attention:** user-task research. **Maintenance:** moderate UX/state cost only if the experiment is useful.

### C28 Account-local Recent and reopen

**Explore · no current general Recent surface found · medium effort.** [Favourites](../apps/web/src/features/browsing/favourites/FavouritesStage.tsx), transfer history, and audio resume cover narrower jobs. A recent-files/folders surface is absent from the inspected public entry points and was an older [design non-goal](FILE_MANAGER_REDESIGN_BRIEF.md).

Test a short browser-local reopen list against existing favourites/history. Include unavailable/moved states, clearing, expiry, and account-removal cleanup. **Experiment:** compare return-to-document task success and interactions. **Human attention:** privacy/retention policy and product scope. **Maintenance:** modest. Do not infer demand merely because many file managers have recents.

### C29 Saved searches and lightweight filters

**Explore after C02 · current absence source-checked · medium effort.** [Search identity](../apps/web/src/features/browsing/search/model.ts) already includes account/path/query; [the browse header](../apps/web/src/features/browsing/browseHeader/BrowseHeaderStage.tsx) exposes a live query rather than saved definitions.

First prototype saving a scoped query. Add type/date/size filters only for validated tasks, showing whether filtering applies to all results or merely the loaded bounded set. **Experiment:** repeat a common retrieval task and compare with existing search/favourites. **Human attention:** a small user study and scope semantics. **Maintenance:** modest for definitions, higher for richer backend filters. Full-text indexing remains a separate expansion.

### C30 Share-to-Davora upload

**Explore · platform feasibility and demand unverified · large effort if adopted.** File/folder pickers and drag/drop exist, but [the PWA manifest](../apps/web/vite.config.ts) does not register a share target. The diagnostic inbox is unrelated to user-file ingestion.

Test one browser/OS flow that accepts a shared file, confirms account/folder, and invokes existing upload authority. Define expiry/clear behavior for queued private bytes and a normal-picker fallback. **Experiment:** verify source-app/file-type coverage and compare task completion with the existing picker. **Human attention:** platform, destination, and retention policy. **Maintenance:** medium/high browser-platform cost; no server inbox by default.

### C31 Recovery from accidental changes

**Explore · explicit scope expansion · medium/large effort.** The [Nextcloud client](../apps/worker/src/nextcloud/client.ts) exposes normal file mutations, but no trash/version/restore operation; [the brief](FILE_MANAGER_REDESIGN_BRIEF.md) excludes deleted-file views.

Start with an accurate route to recovery in Nextcloud. Consider in-app restore only after checking provider capabilities, permissions, version semantics, and root boundaries. **Experiment:** recover a disposable deleted/overwritten file on a specifically authorized test account. **Human attention:** product/security decision. **Maintenance:** provider-specific API support. Do not promise Undo for an irreversible operation.

### C32 Keyboard action palette

**Explore · existing keyboard controls must be preserved · medium effort.** [Accessibility tests](../apps/web/tests/accessibility.spec.ts) and [quick actions](../apps/web/src/features/browsing/quickActions/QuickActionsStage.tsx) cover direct controls; no general action palette was found.

Prototype a small searchable list of existing navigation, search, create, and upload actions. Reuse capability/admission logic and destructive confirmations. **Experiment:** compare common keyboard tasks against the current focus flow. **Human attention:** accessibility/task review. **Maintenance:** modest if it invokes existing commands. This is a productivity idea, not evidence that current controls are inaccessible.

### C33 Open in Nextcloud for advanced work

**Explore · proposed low-scope alternative to broad expansion · small/medium effort.** Davora's [product scope](PRD.md) intentionally omits collaboration and many provider features.

Verify a safe native-provider handoff for the current account/path, with an honest root fallback, before recreating sharing/versioning/admin features. **Experiment:** test supported file-link behavior and correct account context without credentials in URLs. **Human attention:** navigation/security review. **Maintenance:** provider-version compatibility. This idea does not assume deep-link semantics are already verified.

### C34 Browser-assisted Nextcloud connection

**Explore · provider mechanism verified, Davora integration unproven · large effort.** Nextcloud's [Login Flow v2](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2) opens provider login in a browser and ultimately returns per-client app credentials. It differs from Nextcloud's [OAuth2 integration](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/oauth2.html); it is not simply “add OAuth.”

Test whether it reduces manual app-password copying for Davora's supported deployments. Preserve the manual route and Worker credential boundary; specify cancellation, expiry, polling, account ownership, and revocation before implementation. **Acceptance:** no raw password persistence in the browser and no orphaned login lifecycle. **Human attention:** explicit product/security decision. **Maintenance:** moderate provider-flow compatibility. C10/C11 can ship independently.

## Improvements deliberately not promoted

- **Another broad architecture rewrite:** [App](../apps/web/src/App.tsx) is already a 17-line composition root. Existing feature ports, shared schemas, and dependency enforcement should be preserved. File counts or long cohesive modules are insufficient reasons for another extraction campaign.
- **A new global store or workflow framework:** no reviewed lifecycle required it. Navigation should coordinate dismissal while features retain workflow state.
- **Generic offline/retry/favourites/bulk-operation/media-streaming features:** these already exist. The proposals above concern narrower completeness, recovery, capacity, and discoverability gaps.
- **A supposed Durable Object concurrency fix:** separate awaited storage calls are not evidence of a race; Cloudflare's [default input/output gates](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) cover the inspected storage-only pattern. Keep platform assumptions tested, but do not fix an unproven race.
- **Immediate account-store sharding or tombstone garbage collection:** [one encrypted snapshot](../apps/worker/src/accounts/repository.ts) has a real capacity boundary, but the personal-account workload was not measured. First measure serialized size/churn against [platform limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and preserve revocation safety.
- **A claimed DNS-rebinding vulnerability:** hostname/allowlist validation and manual redirects exist. The unverified resolved-destination/platform boundary merits a bounded threat-model check, not a claim of demonstrated exploitability.
- **A missing diagnostic retention system:** deployment already checks remote R2 lifecycle rules in [the deploy preflight](../scripts/deploy.ts). Lack of lifecycle rules in Wrangler configuration does not prove retention is absent. Live bucket state was not inspected.
- **Team sharing, generic providers, native packaging, or a full-text indexing service as routine additions:** these change the audience, trust model, operating cost, and explicit v1 scope. Demand evidence should precede those investments.

## Evidence and review limits

The review covered product/design/history documents, current browser and Worker entry points, public feature ownership, account/session/offline/storage lifecycles, file and media pipelines, shared contracts, security/config/persistence/diagnostics, tests, quality/deployment tooling, and sample maintenance drills. It used six bounded evidence streams, architecture synthesis, a dedicated completeness probe, and independent claim review. It was broad sampling of the repository, not a line-by-line proof of correctness.

### Fresh execution

The original checkout was clean and matched remote `main` at intake. Its dependencies were stale. To preserve it, the current Git snapshot was archived under ignored `.tmp`, dependencies installed from the committed lockfile, and checks run there with Node 22.22.2. No dependency or source change was made to the original checkout.

- Build, type checking, lint, architecture, and dependency-direction checks passed.
- The architecture check reported 516 production modules, 1,723 imports, and zero cycles. These are descriptive observations, not quality scores.
- Root tests: **3,340 passed, one failed**. Web: 2,923 passed/one failed; Worker: 292 passed; shared: 84 passed; deployment tooling: 22 passed; quality tooling: 19 passed.
- The sole failure was the `NAV-07` behavior-contract inventory mismatch described in C13. It was not fixed in this review.
- The completeness probe exercised the actual Nextcloud client, offline plan adapter, and execution controller with synthetic local responses. It verified 205 input children → 200 returned items → 200-file plan → `completed` and one root-completion call. The matching mock path exposed all synthetic entries, including the nested child.
- The probe did not execute final ZIP compression or prove production occurrence. ZIP omission is source-traced through the shared planner; no remote deletion or corruption was observed.

### Current browser evidence

A fresh built mock app was exercised in standalone headless Chrome at 1440×900 and 390×844. The in-app browser exposed no available surface and the DevTools bridge did not become ready, so the browser runbook's fallback was used. All account/file data was synthetic.

Observed journeys included first connection, root/nested browsing, search, navigation drawer, selection/actions, desktop text preview, settings, theme changes, keep-offline confirmation, explicit offline mode, folder shortcuts, report creation UI, and selected focus/Back/Escape interactions. The sampled compact mobile layout preserved a list-first surface; this review does not recommend undoing the recent header decluttering. No diagnostic report was sent.

C19 records the specific dismissal observation; C25 records the settings viewport facts. A mobile search capture occurred before its result settled, and a mobile preview capture still showed opening progress. Those transient frames were not promoted to search or preview defect claims.

Representative local captures: [desktop connection](../.tmp/agent-artifacts/ux_evidence/desktop-connect-form.png), [mobile browsing](../.tmp/agent-artifacts/ux_evidence/mobile-root.png), [desktop settings](../.tmp/agent-artifacts/ux_evidence/desktop-settings-dialog.png), [mobile settings](../.tmp/agent-artifacts/ux_evidence/mobile-settings.png), and [keep-offline after Back](../.tmp/agent-artifacts/ux_evidence/keep-offline-after-back.png). These are supplemental ignored review artifacts, not portable checked-in evidence. The observations, viewport, source snapshot, and source links remain recorded here if temporary captures are removed.

### What remains unverified

Production deployment/state, real Nextcloud folder ordering/volume, actual customer incidence, real device memory/latency/quota, external CI, and product demand were not established. No production state, tracker, private diagnostic content, real-account credentials, or `.env` was accessed. Full browser/PWA release suites and real-backend validation were not rerun as release gates. Live coverage did not establish degraded transfer/reconnect recovery, broad PDF/HEIC/media behavior, long-name/deep-path geometry, install/update, actual browser-offline recovery, enlarged text, or automated axe accessibility results. Existing tests for those areas were inspected, not treated as fresh visual approval.

Source-supported visual hypotheses are not design approval. Device/network targets and product success measures in this document are proposed acceptance criteria, not existing measurements. Browser evidence and its specific limits are recorded with the review's supporting artifacts; source links and the execution summary above preserve the substantive findings independently of those temporary files.
