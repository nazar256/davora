# Architecture

## Overview
The repo is an npm workspace with three packages:
- `apps/web`: React + Vite PWA frontend.
- `apps/worker`: Cloudflare Worker / local Node server that normalizes Nextcloud WebDAV into a JSON API.
- `packages/shared`: shared types, path helpers, and API contracts.

The workspace dependency direction is `web -> shared` and `worker -> shared`; `shared` depends on neither application.

## Runtime entry points

- Web: `apps/web/index.html` -> `apps/web/src/main.tsx` -> `apps/web/src/App.tsx`. The entry point loads only `css-system.css`, whose declared order is reset -> tokens -> primitives -> layout -> feature-owned sheets -> utilities -> narrowly justified overrides. `App.tsx` is a 17-line composition root; `app/useBrowserWorkspaceComposition.tsx` owns the explicit feature graph and `AppShell` remains declarative.
- Cloudflare: `apps/worker/wrangler.toml` -> `apps/worker/src/index.ts` -> `handleRequest` in `apps/worker/src/app.ts`. The entry module also exports the account-store Durable Object.
- Local Worker: `apps/worker/src/node-server.ts` -> the same `handleRequest`. Local durable state defaults to ignored `.tmp/local-dev` storage.
- PWA: Vite PWA generates the service worker; authenticated API responses are not part of the application-shell precache.

The Worker has one request path. `requestBootstrap.ts` owns global OPTIONS, method-permissive health, configuration loading, mock-reset admission/order, and exact-origin admission behind a discriminated result. `http/router.ts` derives an exhaustive typed route from shared endpoint descriptors; `http/context.ts` resolves route-specific browser/session/stream authority; `http/application.ts` dispatches account and file use cases; and `http/failure.ts` owns the closed, redacted response taxonomy. `app.ts` is composition-only and applies CORS exactly once. Wrong-method `GET /api/mock/reset` remains an unauthorized file-route request; reset concealment is owned only by the POST reset branch.

## Phase 0 maintainability baseline

Measured on 2026-07-16 before production-code refactor movement.

### Static dependency graph

- 51 non-test production TypeScript/TSX/JavaScript modules.
- 84 local import edges and 29 external-package imports.
- 0 strongly connected import cycles in the baseline static TypeScript import scan.
- The two unresolved relative edges were CSS imports, not production TypeScript modules.
- Highest local fan-out: `App.tsx` 20, Worker `app.ts` 8, account store 6.
- Highest local fan-in: shared `index.ts` 20, Worker `types.ts` 6, web `fileSize.ts` 5.

Phase 1 replaces the one-off scan with an enforced architecture command. Zero baseline cycles means cycles can hard-fail immediately; legacy side-effect and unsafe-pattern debt requires an exact ratchet rather than a file-wide exemption.

### Size and ownership hotspots

| Module | Baseline lines | Architectural concern |
|---|---:|---|
| `apps/web/src/App.tsx` | 7,360 | Composition, feature models, effects, browser APIs, and many views share one owner. |
| `apps/web/src/styles.css` | 3,659 | Legacy/global ownership and responsive rules span features. |
| `apps/web/src/design-system.css` | 1,068 | Loaded after legacy CSS and partly acts as an override layer. |
| `apps/worker/src/app.ts` | 580 | Route/security/application logic plus parallel backend dispatch. |
| `apps/worker/src/mock/data.ts` | 578 | Mock backend and fixture responsibilities are coupled. |
| `apps/worker/src/nextcloud/client.ts` | 476 | Broad adapter surface. |
| `apps/web/src/lib/api.ts` | 391 | Transport and unchecked response trust boundary. |
| `apps/web/src/components/CachePanel.tsx` | 339 | Large feature view outside an explicit feature boundary. |
| `apps/worker/src/accounts/store.ts` | 314 | Persistence, hydration, and concurrency behavior share one module. |

Current large evidence files are `App.test.tsx` (3,954 lines, 113 tests, about 15.5 seconds of the baseline web unit run), `tests/app.spec.ts` (3,160), `tests/screenshots.spec.ts` (about 1,470), and Worker `app.test.ts` (881). Inspected production code totals about 19,116 lines; tests/specs total about 11,570 lines.

### Direct platform-access baseline

A lexical production scan found 168 references to browser/network/time/platform globals; this is a debt signal, not proof that every reference is an unsafe side effect.

- `App.tsx`: 83 references.
- `ReloadPrompt`: 18 references.
- By token: `window` 59, `localStorage` 29, `crypto` 18, `document` 18, `fetch` 11, timers 14, `matchMedia` 6, `navigator` 5, `history` 4, `ResizeObserver` 2, and animation-frame APIs 2.
- Budget-specific examples: object URL create/revoke appears in two production modules; history access is concentrated in `App.tsx`; one XHR and one `navigator.onLine` access exist.

The architecture ratchet must fingerprint existing debt precisely and fail new references outside declared adapters/hooks. It must not grandfather an entire hotspot module, which would permit the debt to grow.

### Build baseline

- Web `dist`: about 5.8 MiB.
- HEIC worker: 2,996,909 bytes.
- PDF worker: 1,304,896 bytes.
- Main app JavaScript: about 554 KiB.
- PDF application chunk: about 532 KiB.
- CSS: 73,711 bytes.
- Worker `dist`: about 336 KiB; main Worker application output about 24 KiB.
- Shared `dist`: about 48 KiB.

Vite reports the existing main/PDF chunks above 500 KiB. Later phases compare against these values; a regression over 10% requires explanation and approval.

## Maintenance-drill baseline

These drills measure story locality before and after the refactor.

1. **Add a sort mode.** Phase 4C localizes persisted values, validation, labels, compact labels, option order, and all comparator behavior in `features/browsing/model.ts`, with pure adjacent tests. Settings consumes the browsing public API, and `App` renders the catalog generically. Adding a mode now changes the browsing model/tests without a root-application edit.
2. **Add or change a preview viewer/action.** A normal action change is localized to `features/preview/shell/PreviewModalStage.tsx`, `features/preview/workspace/projectPreviewModalStage.ts`, and `features/preview/workspace/usePreviewWorkspace.ts`, with adjacent tests and feature-owned browser/screenshot evidence. A new viewer kind additionally declares its shared schema in `packages/shared/src/api/fileContent.ts` and uses the focused viewer plus Worker classification path. Neither case requires root `App` or global-CSS branching.
3. **Add a transfer terminal state.** The state transition lives in `features/transfers/model.ts`; terminal presentation lives in `features/transfers/tray/presentation.ts` and `features/transfers/tray/TransferTrayStage.tsx`. Adjacent model/view evidence owns the change, with the feature stylesheet touched only when presentation changes. Root `App` is not an owner.
4. **Add a Worker endpoint.** Declare the shared endpoint descriptor and parser, then route it through the catalog-driven `apps/worker/src/http/router.ts` to one `apps/worker/src/files/service.ts` use case and one `FileBackend` operation implemented by the mock and Nextcloud adapters. The endpoint matrix and exhaustive parser table reject an unhandled catalog addition; duplicated route dispatch is absent.

The final drill result meets the locality target: each web drill fits within one feature and no more than three production feature files plus an optional shared schema; the Worker drill has one declared endpoint/use-case/backend path rather than duplicated dispatch.

## Final convergence metrics — 2026-09-01

- Architecture: 468 production modules, 1,550 imports, zero cycles, and zero generated shadows. Dependency rules inspect 787 modules and 2,695 dependencies with zero violations.
- Composition: `apps/web/src/App.tsx` is 17 lines and `app/AppShell.tsx` is 146 lines. Platform-reference census is 103 and the architecture ratchet permits no undeclared migrated-module access.
- Two production modules exceed the executable 600-line soft budget, both accepted by final whole-goal review `.tmp/agent-artifacts/expert/20260901T043055Z-whole-goal-final-rereview.md` as narrow exceptions rather than hidden debt: `features/accounts/session/model.ts` is 660 lines (+60) of cohesive exhaustive session-state/transition authority; `platform/storage/openedFileRepository.ts` is 657 lines (+57) of cohesive versioned transactional IndexedDB migration, rollback, and isolation authority. Splitting either only to satisfy line count would divide its invariant boundary. Their focused model, persistence, migration, race, and resource tests remain the enforcement mechanism; revisit either exception if unrelated stories begin to scatter across the module.
- Build output is CSS 76.49 KiB (13.49 KiB gzip), main JavaScript 915.90 KiB (278.43 KiB gzip), PDF application chunk 532.22 KiB (161.49 KiB gzip), HEIC worker 2,996.91 KiB, and PDF worker 1,304.90 KiB. The main source chunk grew because the monolith was divided into explicit feature modules without a product-level lazy-loading redesign; gzip output and startup behavior are covered by the production build, browser, and PWA gates. The two media workers remain effectively unchanged from Phase 0.

## Target modular architecture

Create these boundaries only as real vertical slices move; do not scaffold empty abstractions.

```text
apps/web/src/
  app/                 composition and cross-feature coordination only
  features/            accounts, navigation, browsing, operations, offline,
                       transfers, preview, settings, and pwa
  platform/            api, browser, storage, and media adapters
  ui/                  shared accessible primitives and token/style foundation

apps/worker/src/
  app.ts               environment setup and composition only
  http/                router, middleware, and cohesive route declarations
  application/         ports and use cases
  adapters/            mock, nextcloud, and accounts
  security/            authorization/token/path enforcement primitives
  config/              validated environment configuration
```

A feature contains only the layers it needs: pure model/transitions, selectors, feature-required ports, controller/effect orchestration, presentation, owned styles, a small public `index.ts`, and adjacent tests.

## Enforced dependency rules

- Pure models cannot import React, DOM/browser APIs, HTTP, storage, clocks, random IDs, or concrete adapters.
- Controllers depend on feature ports, never concrete global/platform implementations.
- Views receive explicit state/actions and do not perform persistence or backend work.
- Feature internals cannot be imported by another feature; cross-feature use goes through public APIs or app-coordination events.
- `platform` does not import feature internals, including port modules. Adapters are structurally typed and checked with `satisfies` at the composition root.
- `shared` contains only concepts used by both browser and Worker; it is not a web-feature dumping ground.
- The composition root can wire and coordinate but cannot own feature business rules.
- `app/AppShell.tsx` is the single declarative top-level visual owner. Its discriminated bootstrap/workspace contract owns the top DOM/classes, common chrome, keyed drawer mount, banners, pull-refresh presentation, workspace placement, passed-through refs, and exact overlay order using public feature Stage APIs. It owns no state, effects, browser/API/storage access, policy, feature internals, or global store; `App.tsx` retains hooks, controllers, cross-feature policy, service composition, and resolved bindings. The adjacent pure `projectAppShell` projector owns only the final discriminant selection and forwards the already-resolved binding groups by identity; it is not a second shell or policy owner.
- The workspace status presentation is feature-owned by `features/workspace/status/WorkspaceStatusStage.tsx`: it renders exactly one `.state-banner-slot`, forwards the public `StateBanner` binding, and conditionally renders the offline toggle. `AppShell` composes that Stage immediately before `main` and does not recreate its banner/toggle subtree. The Stage owns presentation only; status state, policy, and effects remain with their existing workspace/controller owners.
- A surface stack contains only ordered identity, owning feature, and dismissal routing. Viewer/dialog/transfer/mutation lifecycle state remains feature-owned.
- Dependency cycles and reverse layers hard-fail. Direct platform access hard-fails in migrated target modules; legacy platform-global debt remains report-only until the typed-lint ratchet is configured from current Context7 guidance.
- Tests, generated PWA/build output, and configuration are excluded from production side-effect rules but retain their own correctness/lint rules.

Use dependency-graph tooling for imports, cycles, and layers; use typed lint rules for promises, unsafe operations, exhaustiveness, React Hooks, and restricted platform APIs. Do not auto-fix Hooks dependencies or unsafe casts in bulk because those changes can alter runtime behavior.

## Phase 3 service-composition pilot

The settings-persistence pilot establishes the first explicit browser service seam without creating a global service locator:

- `app/AppServices.ts` contains only the feature service required by the migrated runtime path: `settings`.
- `main.tsx` constructs browser services explicitly and passes them to `App`. The optional `App` prop creates one stable fallback service only for legacy tests and direct renders.
- `features/settings` owns the settings model, runtime normalization, canonical storage key, persistence workflow, public API, and deterministic fake.
- Connect/reconnect form state, builders, transient credential presentation, validation/submission lifecycle, `AccountFormStage`, `ConnectAccountStage`, and `ConnectAccountDialogStage` live in `features/accounts/connect`. App supplies concrete connect/session/navigation ports and mounts feature-projected bootstrap/dialog bindings; it does not interpret form mode or own account modal copy/scrim markup.
- Declarative remove-account confirmation chrome lives in `RemoveAccountStage` (`features/settings/removeAccount`); App retains label-match validation, retention/cache/favourites teardown, and `deleteConnectedAccount` orchestration.
- Declarative profile/settings dialog chrome lives in `SettingsDialogStage` (`features/settings/settingsDialog`), including colocated `CachePanel` presentation; uiSettings load/save + change handlers live in `features/settings/uiSettings` (`useUiSettings`); theme watch lives in `features/settings/theme`. Explicit-offline state/transitions live in `features/offline/mode`; App retains composition across chrome surfaces, account switching, cache/retention commands, account routing, wake-lock, and PWA/bootstrap wiring.
- `platform/storage/browserStringStorage.ts` is feature-agnostic. It exposes raw string operations, imports no feature types, and turns unavailable or failing browser storage into an explicit no-op capability.
- Stored JSON is untrusted: malformed or wrongly typed fields become safe defaults before entering application state. Corrupt syntax is removed when storage permits.

The inline pre-module theme bootstrap in `index.html` remains a deliberate temporary exception: it reads the same literal key before application modules execute to prevent a wrong-theme flash. Theme/PWA extraction in 4G owns eliminating or formally generating that duplication without delaying first paint.

The Phase 4G settings workspace retains that first-paint bootstrap unchanged. `features/settings/workspace/useSettingsPreferencesWorkspace` is the sole early parent composition owner of validated settings persistence/status and reactive theme; the late pure `projectSettingsDialogStage` receives explicit public projections and is the sole `SettingsDialogStageProps` construction policy. App provides adapters/projections at those two points only. No bridge, ref/provider workaround, duplicated settings state, or generic shell-props builder is permitted; account actions, cache/retention, wake-lock, navigation, and each feature lifecycle retain their existing owners.

The Phase 4G browser-connectivity slice keeps browser-global ownership explicit: `features/offline/connectivity` exposes typed object snapshots and owns the `useSyncExternalStore` read/subscribe lifecycle, while `platform/network/browserConnectivityPort.ts` alone reads `navigator.onLine` and installs/removes online/offline listeners. `AppServices` supplies the structurally typed adapter; deterministic fakes publish test snapshots. App has no online/offline listener, and the viewport `matchMedia` effect remains a separate lifecycle. Explicit-offline mode and `workerUnavailable` are distinct facts and retain their existing owners.

The responsive-viewport slice applies the same boundary to presentation width: `features/navigation/viewport` owns browser-free narrow/wide snapshots and `useResponsiveViewport`; `platform/browser/browserResponsiveViewportPort.ts` privately owns the single inclusive `(max-width: 900px)` query, `matchMedia`, listener identity, and cleanup. `AppServices` provides the structural adapter and App consumes only the semantic hook. The 900px boundary and synchronous first render are stable; viewport replacement/unmount/StrictMode and duplicate-event cleanup are explicit. This adapter remains independent from connectivity, explicit-offline, PWA, theme, orientation, ResizeObserver, and CSS policy.

Platform adapters remain extracted only with an owning vertical slice. Explicit-offline persistence and backend-network gating now live in `platform/storage/browserExplicitOfflineModeStorage.ts` and `platform/network/browserBackendNetworkGate.ts`; preview-specific popup/object-URL/timer/listener effects live in `platform/preview/browserPreviewModalRuntime.ts`; browser connectivity globals now live only in `platform/network/browserConnectivityPort.ts`; feature policy does not import browser globals. Remaining work continues under accounts/storage (4B), API and folder/search cache (4C), mutations/upload/download and request cancellation (4D), IndexedDB/offline/transfers/wake lock (4E), remaining preview/media ownership (4F), history/URL/Back (4A), and theme/PWA browser events (4G).

The AppShell extraction is an ownership/locality boundary, not a line-count mechanism: the cohesive shell is 185 lines and App remains above its eventual composition-only budget. Expanding the shell with controller policy merely to reduce App would violate dependency direction.

### Explicit-offline mode ownership

`features/offline/mode` is the single owner of account-keyed explicit-offline mode and its ordered enter/exit transaction. It restores the network gate before startup request effects, persists before applying mode changes, activates the gate before entry cleanup, and commits corrupt-storage recovery before unblocking on exit. Retained-tree projection is delegated to the public retention owner rather than reimplemented in App.

Storage and repair failures fail closed. Failed persistence leaves the current mode unchanged and performs no gate, cleanup, or success effects. Session-bound work carries account plus generation identity so stale completion and cleanup cannot mutate replacement state. The legacy `lib/explicitOfflineMode.ts` path and duplicate folder-audio `exclusivePause` implementation are retired; shared exclusive playback uses the preview feature owner.

## Phase 4C browsing policy slice

`features/browsing` is the owner of the first extracted browsing rules:

- `model.ts` contains the single sort catalog. `SortMode` is derived from it, and persisted validation plus desktop/mobile labels use the same public vocabulary.
- `selectors.ts` owns hidden-name detection, immutable folder-first browse sorting, and visible-item selection.
- Active search results are filtered for hidden entries but never passed through browse sorting, preserving backend relevance order.
- Settings imports browsing only through `features/browsing/index.ts`; browsing has no settings dependency.

The destination picker deliberately reuses the public sorter with folder-only `name-asc`. That first extraction did not scaffold unused controllers or ports; the subsequent Favourites, folder lifecycle, search lifecycle, and presentation boundaries are documented below, while views and styles remain deferred.

### Browsing presentation policy

`features/browsing/presentation.ts` is the pure owner of search active/display derivation, breadcrumb values/labels/ARIA labels, root/folder/location vocabulary, item/result count labels, and exact browse/search summaries.

- Raw search query transport and cache identity remain owned by the search lifecycle; presentation trims only for activity and visible copy.
- Breadcrumb data construction is shared, but main browse, navigation drawer, and destination picker retain their distinct visibility, separators, icons, current-page, disabled, and click policies in their views.
- The browsing-presentation module has no browser globals or navigation ownership. `features/navigation/useWorkspaceNavigation` owns synchronous URL/path restore and sync, history chrome snapshots, and path-transition cleanup through injected public feature ports; workflow state is not passed to it. The late `features/navigation/useWorkspaceSurfaceCoordinator` is the sole owner of the popstate subscription and ordered Back coordination: it reads authoritative event-time workflow ports, guards retained callbacks with generation/active/subscribed-port identity, applies the ten-surface priority and dismissal-before-path ordering, and exposes the combined surface reader used by pull-to-refresh. App wires it after preview/mutation/account owners and retains no workflow snapshot/dismiss refs or early listener bridge; no global workflow store exists. `platform/browser/browserHistoryAdapter` owns mandatory location reads through `getLocation`. Legacy navigation hooks are retired to `.tmp/trashbin/20260729_180833-nav-hooks`. Mobile Chromium and built installed-PWA tests cover the application-owned History/popstate path. A physical installed-Android system-Back key run remains an explicit device-integration evidence gap accepted for the 2026-09-01 web/PWA and Cloudflare release, not a claimed pass; any Android-only Back report, Chrome/PWA history-delivery change, or native-wrapper introduction reopens mandatory real-device validation.
- Root vocabulary remains intentionally contextual: `Home` is the folder/breadcrumb label while `/` is the location label.

### Browsing read-workspace composition

The reviewed `features/browsing/workspace` child is the parent composition boundary for the read path. It owns raw query plus composition/projection of the existing folder, search, and folder-status hooks, current-context validation, list/search projection, and browsing presentation projection. Folder and search children remain authoritative for request, cache, abort, stale-result, and failure-only fallback lifecycles; offline content is injected through a narrow source rather than importing retention/offline internals. App retains only thin public adapters for selection query-active state, preview items, mutation reload, account clear, and refresh path-navigation wiring. Bootstrap ports use stable memoization, and folder-status ports preserve stable identity with external list-error precedence. This boundary does not own navigation/history, retention/cache policy, selection, mutation, transport/Worker/shared contracts, CSS/visual behavior, PWA state, or a global workflow store; a second App read owner is a reversal condition.

The reviewed `projectBrowsingSurfaceBindings` projector is the late pure presentation boundary for the complete BrowseHeader/FileList bindings. Its input has exactly grouped `owners` and semantic `ports`; it consumes whole public browse, selection, operation, offline, navigation, settings, status, and pull-to-refresh outputs without importing sibling internals or owning hooks/resources. App passes one current render's owner outputs and mounts the single result for both Stages; the typed offline-sync port forwards the account-bound selection capture by reference. This projector owns no authority, persistence, transport, lifecycle, or DOM/CSS policy; its locality budget is guarded by the App `<=965` characterization tripwire.

The reviewed browsing external-error slice closes the remaining ownership inversion: `useBrowsingWorkspace` is the sole owner of `externalListError` and exposes stable `reportExternalListError`/`clearExternalListError` commands. App no longer stores or aliases the error; producer and clear adapters bind structurally to the workspace commands, while status, folder/search lifecycles, mutation-local errors, and navigation remain separate. Folder-versus-external, active-search, offline/loading, and routine-transition precedence stays in the workspace. Favourites retain their own lifecycle but use a committed render-pure owner epoch published in `useLayoutEffect`, so stale success/failure after replacement, abandoned concurrent renders, or unmount is inert. No raw error is persisted, logged, serialized, or placed in a URL; no global notification store or cross-feature internal import is introduced.

### Workspace status ownership

`features/workspace/status` owns the one non-persistent informational message previously stored in `App.tsx`. Its public API is intentionally small: first-mount `initialMessage`, immutable `{ message }` snapshot, and stable synchronous `commands.announce(message)`. The pure model replaces only the message and preserves same-message React no-op behavior; the hook owns no timer, listener, request, storage, browser global, provider, event bus, queue, severity, source registry, or history. App binds existing producer ports to the semantic announce command and reads the snapshot for the existing workspace header. Bootstrap-time announcements remain accumulated because the owner mounts unconditionally before the bootstrap/workspace branch; external browsing errors, inline mutation errors, PWA prompts, and transfer state remain independent. No feature imports status internals, and no raw credential/error sink or persistence/URL serialization is introduced.

### Mobile AppBar sort-panel ownership

`features/browsing/appBar/useAppBarSortPanel` owns the App-lifetime mobile sort-panel visibility that was previously held directly in `App.tsx`. It exposes only `{ open, toggle, select }`; `select` invokes the injected public settings sort command before closing, so synchronous failure leaves the panel open. `AppBarStage` remains declarative and consumes the binding with the authoritative settings `sortMode`; settings retains persistence/announcement, browsing retains ordering, and responsive/search rendering remains unchanged. The owner has no ref bridge, effect, timer, listener, request, provider, global store, or history/surface semantics. Wide/search hiding preserves openness, including the existing behavior that search hides the trigger while an already-open panel remains mounted. No CSS/DOM redesign or adjacent lifecycle extraction is part of this boundary.

### AppBar application-workspace projection

`features/browsing/appBar/workspace/useAppBarWorkspace` is the single application projection owner for the complete `AppBarStage` binding. It invokes the existing `useAppBarSortPanel` and `useTransferTray` owners, forwards whole public account/session/bootstrap/connectivity/viewport/browsing/navigation/offline/settings/PWA/wake-lock/transfer/offline-sync outputs, and exposes one binding without introducing a provider, store, runtime port, effect, listener, request, timer, or resource owner. Public `appBar/stage` and `appBar/sortPanel` forwarding modules keep the parent dependent only on public feature APIs. Transfer tasks remain authoritative and account-filtered; clear/retry/toggle stay in the transfer owner, and no delete/WebDAV/Nextcloud/request capability crosses the tray. App consumes only the parent binding and no longer reconstructs the sort/tray graph. The shared `dirname` helper remains canonical for navigate-up normalization. This reviewed child preserves AppBar DOM/CSS/ARIA/copy/focus and PWA/wake-lock behavior, but does not claim Phase 4C/Phase 4 completion or an App line-budget milestone.

### Strict Worker account-state codec and hydration

`apps/worker/src/accounts/persistedAccountStateCodec.ts` is the pure trust-boundary validator and AES-GCM codec for persisted account authority. It accepts complete V1/V2 shapes only, returns discriminated `absent | ready | invalid` outcomes without secret-bearing failure details, validates account/credential/revocation invariants and exact envelope structure, rejects duplicates/live-tombstone collisions, and validates serializer output before encryption. `accounts/repository.ts` is the sole decoded-state repository; commands run through bounded compare-and-swap retries in `accounts/transaction.ts`. `localAccountStorage.ts` owns locked atomic file replacement and legacy-envelope upgrade; `durableAccountStorage.ts` adapts the revisioned Durable Object protocol. Missing, corrupt, stale, and storage-failure states remain distinct and fail closed. This boundary has no browser/UI/WebDAV/PWA dependency and cannot delete or mutate Nextcloud content. Any future public route to the Durable Object requires a separate auth/security decision.

### Browser ownership and account transport

`features/accounts/ownership` is the sole browser identity owner. It reads the established `davora-browser-id` and `davora-browser-secret` keys through explicit storage results, preserves valid stored bytes, generates only missing halves with secure platform entropy, canonicalizes headers without changing stored values, and fails closed with redacted stable reasons for malformed or unavailable authority. It does not rotate valid identities, add keys, use insecure fallbacks, or expose secret-shaped details.

`features/accounts/transport` is the public account HTTP boundary for health, connect, session, and encoded account deletion. `platform/security/browserOwnershipStoragePort.ts`, `platform/security/browserOwnershipEnvironmentPort.ts`, and `platform/api/browserAccountTransport.ts` own browser and HTTP details; generic request/error infrastructure remains in `lib/api.ts`. AppServices creates one storage adapter, one identity service, and one transport, and account-state/session consumers receive that transport through the public accounts index. Health intentionally does not read identity. Raw endpoint imports and the old `lib/browserIdentity.ts` owner are retired, so no per-call transport or second identity owner remains.

This slice preserves wire paths/bodies/headers/error and schema behavior, browser/account isolation, credential containment, Worker ownership/CORS/session/tombstone behavior, and all WebDAV semantics. Client-side account removal may purge retained browser namespaces but never removes WebDAV content. The account transport boundary is security-reviewed; the pre-existing Worker `rootPath` default discrepancy is a separate recorded exception and not folded into this ownership migration.

### Account-actions/removal application composition

`features/accounts/actions/workspace` is the sole React/application owner for Add, reconnect, remove, reset, commands, busy state, and complete action Stages. `createAccountRemovalCommand` adapts that public owner to the existing account registry without taking ordering, persisted `revoke -> purge`, generation, authority, or retry ownership from `features/accounts/registry`; an opaque retry token remains commit-only through the registry. `app/createAccountRemovalRuntime.ts` is a narrow two-method adapter constructed once by `createBrowserAppServices` from the same account transport, retention repository, browsing cache, and favourites instances used elsewhere. It revokes only the captured connected account and purges only the target browser-local namespaces; it has no repository field, file/WebDAV capability, generic fetch, session/token, DOM, storage, or logging surface. App retains only semantic cross-feature quiesce/reset, the necessary bridge, and shell placement; concrete revoke/purge/retry/known-account/busy-stage policy is not an App responsibility. Public dismissal invalidates and releases only the current remove attempt's busy ownership, while stale completion remains inert across replacement/unmount/StrictMode. This boundary has been browser-gated, scoped-security-approved, and full-gated; it does not claim Phase 4B/Phase 4 completion.

### PWA runtime/workspace ownership

`apps/web/src/platform/pwa/useBrowserPwaRuntimePorts.ts` is the single platform composition owner for `createBrowserPwaPorts()` and `useBrowserPwaRegistration()`, memoizing one structural runtime port set per mount without importing feature implementation. `features/pwa/workspace/usePwaWorkspace` is the sole parent of `usePwaPromptState` and exposes only nested install and reload-prompt presentation bindings; App passes them unchanged and `AppBarStage` remains declarative. `usePwaPromptState` owns one active reload attempt, retaining and take-clearing the platform waiter cancellation, invalidating on runtime-port replacement, rejection, unmount, and StrictMode replay, and guarding late callbacks by attempt/generation with at-most-one reload while preserving controller-change/1500ms behavior. Browser listener/timer mechanics remain in the platform adapter; manifest, Workbox strategy, DOM/CSS/ARIA/copy, account/cache/API/Worker, and WebDAV ownership remain unchanged. The child is fully reviewed and browser-gated but does not imply Phase 4G/Phase 4 completion.

### Pull-to-refresh workspace ownership

`features/navigation/pullToRefresh/` owns the pull-to-refresh model, gesture lifecycle, scroll-origin contract, indicator Stage, and workspace composition. The workspace owns the single forwarded `FileListStage` HTMLElement ref and combines its `scrollTop` with the structural `PullToRefreshEnvironmentPort` supplied by `platform/browser/browserPullToRefreshEnvironmentPort.ts` for `window.scrollY`; feature code reads no browser global. App supplies only event-time public getters for path, token, open surfaces, and the existing browsing `refreshPath` adapter, while AppShell retains placement and handler spreading without interpreting gesture state. The hook preserves exact thresholds/eligibility/ten-surface rules and one-in-flight behavior; fulfillment, rejection, and synchronous throws converge on terminal idle state, and mounted/generation guards make unmount/StrictMode completions inert without absorbing browsing request/abort/error ownership. Root pull modules and the general navigation scroll-origin port are retired without compatibility shims. No CSS, API/Worker/shared, persistence, PWA, or WebDAV behavior changes.

### Account-scoped batch selection

`features/operations/selection` owns multi-item selection identity and lifetime independently of file-list rendering and mutation execution.

- A membership is account plus canonical normalized path, with an immutable resource descriptor, captured browse/search origin, insertion order, and monotonically assigned membership version.
- Metadata rebind preserves membership identity/version/origin; remove/re-add creates a new version. Captured async completion removes only still-matching submitted memberships, so newer, re-added, or other-account selection is inert.
- Selectors own membership, counts/known-size summaries, and explicit archive roots. ZIP/offline planning no longer infers selected-item roots from mutable current path/search UI state.
- Delete reconciliation removes exact paths and segment descendants but not prefix siblings. The dialog remains the retry-queue owner and guards async updates with a committed workflow ID.
- Focused selection is now feature-owned: `features/operations/selection` owns focused identity, immutable descriptor/version, mobile actions/details subview, capture/rebind/clear/delete reconciliation, and long-press timeout lifecycle. App raw focused-selection state, direct focused setters/getters, timer globals, and timer-factory adaptation are retired; batch selection remains a separate owner. Query-only focus retention and stale long-press suppression are characterized, including account/path/session/unmount replacement. App retains only structural projection plus capabilities, mutation/download/offline execution, partial-result copy, user-visible messages, and workspace-navigation composition. Transfer/offline ownership remains Phase 4E; preview modal chrome, session/gallery lifecycle, browser runtime, per-session resource construction, and atomic original-file opening remain feature/platform/app-factory owned.
- `features/operations/selection/workspace` is the reviewed parent composition boundary for early focused/batch state snapshots and typed commands (`useSelectionStateWorkspace`), interaction/long-press/row-suppression composition (`useSelectionInteractionWorkspace`), and late pure `projectSelectionDetailsStage` projection. Focused/batch models/controllers remain authoritative; App no longer assembles their hooks, interaction ports, selection-specific clear-batch ref synchronization, detail/summary/mobile-sheet derivation, inline selection-details bindings, or neutral selection fan-out. Immutable account/path/query/context epochs reject detached Alpha→Beta→Alpha completions and timer callbacks after cancellation, replacement, unmount, or StrictMode replay. This is one reviewed Phase 4D child slice; it does not claim Phase 4D or broader milestone completion.
- Declarative keep-offline confirmation chrome lives in `OfflineSyncConfirmStage` (`features/offline/sync/confirm`); `App` retains dialog open/estimate state, operation-context gating, confirm→transfer enqueue/execute, selection-capture clear, and retry reopen wiring.
- Account health/session transport and lifecycle live in `features/accounts/session`; `createSession` is transport-only. `features/accounts/bootstrap` owns the sole production `useAccountSession` invocation, the complete `SessionState` gate/error/support/navigation projection, account-keyed unlock draft/submission lifecycle, restore bindings, cached-shell eligibility, and exact cached-shell announcement. Account-scoped switch/session-terminal reset remains in `features/accounts/reset`; App supplies concrete ports and shell slots but does not own unlock secrets or interpret session state.
- `features/accounts/workspace` is the sole account-context/bootstrap parent boundary. `useAccountStateWorkspace` publishes one redacted immutable management/operational/pending-removal snapshot plus semantic account commands; bearer authority is a separate atomic account-id/revision-bound capture derived from the same registry generation. `useAccountBootstrapWorkspace` is the later status/presentation boundary for registry notices, announcements, switch failures, and account commands. App does not interpret registry records, pending/fallback precedence, host/token/capability/name/namespace facts, or apply terminal session mutation; explicit reset/purge/navigation adapters remain. The workspace is not a global store, provider, service locator, or second account/session lifecycle.
- `features/accounts/registry` is the sole validated browser account-registry authority. Its codec/model/service/hook own hydration and canonical repair, immutable authoritative snapshots, persistence-before-publish, and connect/session/switch/remove commits against the latest valid snapshot. `platform/storage/browserStringStorage.ts` is the generic browser storage boundary and imports no feature internals; account APIs remain transport-only. Storage-unavailable bootstrap fails closed, credential-shaped/unknown fields are stripped, explicit partial/degraded outcomes preserve truthful authority, and generation-bound retry/repair prevents duplicate remote deletion and stale/StrictMode publication. App owns only concrete port composition and already-resolved stage projection; the former `lib/accountState.ts` owner is retired without a shim.
- Session authority persistence is a synchronous `commitSession` port invoked only after account, explicit-offline mode, generation, and mounted-lifetime freshness checks. Commits reject missing or mismatched account identities while preserving peer account records and active selection. Unknown unlock errors are mapped to stable redacted copy.
- Declarative deployment-unlock chrome lives in `UnlockPanelStage` (`features/accounts/unlock`) and emits submit intent only; DOM event prevention remains view-local. Zero-state Root remains empty until the user enters a value.
- Declarative session-restore banner and manual retry chrome lives in `RestoreSessionStage` (`features/accounts/restore`); `App` retains `allowOfflineCachedShell` gating and ensure/retry callbacks into session ownership.
- Declarative zero-state, connect/reconnect panels, transient form lifecycle, and add/reconnect modal chrome live in `features/accounts/connect`; `useConnectAccount` projects opaque bootstrap/dialog bindings. `App` retains concrete ports, bootstrap gate selection, cross-feature combined account busy policy, and `bootstrapError` as a sibling banner outside the stage.

### Destination planning

`features/operations/destination` owns pure copy/move destination policy independently of picker rendering, async execution, and selection reconciliation.

- One discriminated `planDestination` API canonicalizes accepted picker/manual paths, validates names, rejects unchanged or self/descendant targets, checks exact case-sensitive conflicts, and produces ordered single/batch targets. Invalid plans contain no executable targets.
- Batch copy conflict resolution includes fetched destination entries and targets planned earlier in the same ordered batch. Batch move rejects the complete plan on its first conflict.
- Conflict suggestions preserve extension, dotfile, Unicode, punctuation, and exact-case behavior while selecting the deterministic smallest available suffix without a clock fallback or fixed upper bound.
- `resolveDestinationListingPath` gives async folder loading the canonical folder whose entries back a plan, including the parent of a single manual destination. Stale response guards compare this canonical identity.
- `DestinationPickerStage` remains declarative destination chrome, while its hook publishes destination intents, listing state, validation, and outcomes into the mutation aggregate. Destination planning stays domain-owned and does not depend on mutation presentation internals.

### Mutation workflow and surface ownership

`features/operations/mutation` owns the sole mutable presentation lifecycle and surface for create-folder, single/batch delete, and single/batch copy/move. Its discriminated workflow model, lifecycle hook, and `MutationWorkflowStage` coordinate domain-owned delete, destination, and copy/move publishers without absorbing their planners/controllers.

- Every attempt has opaque identity bound to immutable intent, operation context, captured path, ownership generation, mount generation, and stable domain identity. Async publications must match all current ownership facts.
- Same-context replacement, path/context replacement, dismissal, unmount, and StrictMode replay leave stale work inert. An older attempt cannot publish into, close, or clear the busy state of its replacement.
- Partial results retain domain identity: delete retry contains only unresolved original-order targets; destination partial state retains failed sources in original order. Effects are accepted only after the current attempt reaches completed.
- Navigation/history route dismissal only; selection and transfers keep their own state. App creates structural ports and mounts the single declarative stage; it owns no parallel action/destination/error state or compatibility projection.

`features/operations/mutation/workspace` is the reviewed parent composition boundary for the lifecycle, destination, workflow, action-dialog, and copy/move public hooks. Child owners remain authoritative and the workspace is not an operations store: App retains composition plus the early stable hook-order bridge. The bridge does not mirror mutation state. List-error presentation remains isolated from mutation workspace state, the preview selection bridge remains intact, and the required no-op/cast fallbacks from the former App fan-out are retired. This is one gated Phase 4D child slice; it does not claim Phase 4D or broader milestone completion.

### Operation-execution workspace and browser runtime

`features/operations/workspace` has an explicit three-part composition topology: `useOperationAuthorityWorkspace` is the early owner of operation mode/context identity, scoped abort/currentness, and semantic capability access; the retained `useSelectionInteractionWorkspace` remains the sole owner of long-press, row interaction, selection chrome, and semantic batch-clear planning; `useOperationExecutionWorkspace` is the late owner of mutation/download/upload child composition and operation presentation projection. App passes the same authority and the selection interaction's semantic `clearBatchSelection` command directly—there is no render-time mutable ref, no-op initializer, provider, or second context owner.

`platform/api/browserOperationRuntime.ts` is the operation-specific browser adapter injected through `AppServices`. It forwards the established API/download/ZIP/upload-content calls, abort and transfer-ID factories, progress/signal identity, browser save, and existing unauthorized/reconnect/error classification without exposing generic fetch, feature internals, reusable sessions, or secret-bearing state. The public workspace output contains semantic authority/capabilities, mutation state/bridge/stage, download and upload bindings, and operation commands only; child command bags and mutable refs remain private. This slice preserves the existing Worker/shared HTTP/path/account boundary and has no WebDAV mutation.

### Download workspace composition

`features/operations/download/workspace` is the reviewed parent composition boundary for focused and batch downloads. `useDownloadWorkspace` captures immutable current-account/session/context/policy and batch archive snapshots, then delegates to the existing `useDownload`; `createDownloadWorkspacePorts` is a narrow typed factory for API/browser, abort-registry, transfer, session, error, and presentation adapters. App no longer assembles `useDownload`/`createDownloadPorts` or fans out per-call guards/builders. Batch selection owns entries/archive roots and capture, transfers own progress/terminality, operation context and the abort registry own acquire/release/signal/context ownership, and transport/browser download, session, and presentation remain separate owners.

The bounded batch lifecycle repair acquires one abort scope, propagates its signal through list/fetch work, releases exactly once, and checks registration, ownership, and current context before deferred work and every progress/status/terminal publication. Account replacement (including the Alpha-token case) aborts prior work and makes late callbacks inert; no token-shaped value reaches presentation. This is one reviewed Phase 4D child slice and not a phase or milestone completion claim.

### Upload interaction and browser preparation

`features/operations/upload` owns upload planning/orchestration plus the current picker/drop interaction policy. Its pure drop model decides eligible file drags, active-state transitions, copy effect, and ordered exactly-once submission; `useUploadInteraction` binds that policy to current account/session/path/capability/busy authority. Browsing remains a declarative consumer and imports no operation internals.

`platform/upload/browserUploadFileContent.ts` owns abort-aware FileReader Data URL preparation, progress forwarding/cancellation, content-independent errors, deterministic cleanup, and late-callback inertness. `platform/upload/browserDirectoryInput.ts` owns the browser-specific directory-input attributes/properties. Platform imports no feature internals. App only wires these structural adapters and passes projected interaction bindings; it does not own FileReader, directory attributes, drop state, or drag/drop policy.

### Preview modal shell

`features/preview/shell` owns preview overlay chrome, image/PDF/video stage composition, modal-audio stream/retry/resume UI, and preview-specific presentation helpers.

- `PreviewModalStage` composes public `ImagePreviewStage`, `PdfPreviewStage`, and `VideoPreviewStage` APIs plus colocated modal `<audio>` playback. `platform/preview/browserPreviewModalRuntime.ts` owns its browser-only popup, anchor, Blob/PDF wrapper, URL, timer, keydown, resize, RAF, DPR, location, original-file, and audio-resume capabilities without importing feature internals.
- `app/createPreviewComposition.ts` is wiring-only: it constructs isolated per-session material/resource contracts from public preview APIs and platform adapters, with exact object ownership rather than forgeable structural identity. `createBrowserAppServices` creates one retention repository and injects that same instance into the preview runtime, retention workspace, and account-purge path; the executable AppServices identity test guards this invariant. Blob URLs have exact-once release ownership; Worker stream URLs are never treated as revocable Blob URLs.
- Preview-session acquisition/resource lifetime, open/gallery policy, atomic cancellable original-file opening, folder-audio playback, and wake-lock demand are feature-owned. `useOriginalFileOpen` owns current attempt identity so close, file/account/token/open replacement, a newer start, unmount, and StrictMode replay cancel stale work and make late outcomes inert. App retains structural preview mounting plus genuine Back/history coordination, not preview browser policy or resource construction.
- `features/preview/workspace` is the sole parent coordinator, sole `openedEntry` owner, and owner of the public modal Stage projection: it composes the existing session, open, and folder-audio child hooks and maps their state through `projectPreviewModalStage`, but does not absorb their resource, viewer, routing, or playback lifetimes. Ref-backed synchronous cleanup deduplicates the session callback and semantic route clear; public commands are `dismiss`, `clearForPathTransition`, `clearAccountContext`, and `prepareUnsupportedDownload`. `usePreviewOpen` remains the routing policy and pauses folder audio only for a true media switch; unsupported, cache-only, and error routes preserve established audio behavior. App's identity state/setters, clear fan-out, child runtime/port graph, modal interpretation, bridge-backed `isOpen`, and no-op error adapters are retired while navigation retains explicit history/Back wiring. `PreviewApplicationPorts` exposes only semantic retention capabilities; the workspace exposes no raw repository, Blob, filename, token, session-resource, or status mirror; App consumes `mediaActivity` for the existing wake-lock demand.

### Account-scoped Favourites

`features/browsing/favourites` owns favourite identity, validated persisted entries, first-wins deduplication, account metadata rebinding, deterministic creation time, immutable reorder, retained-offline availability, account-scoped persistence, and atomic React state commands.

- Persisted paths cross the shared normalized-path constructor before basename or state construction; unsafe entries are dropped independently while valid siblings survive.
- Hook state is tagged by account ID, backend, root, and cache namespace, so stale entries are hidden immediately and same-ID metadata changes reload/rebind.
- Storage and clock effects enter through feature ports. `platform/storage/browserStringStorage.ts` exposes explicit result operations for Favourites while preserving no-op legacy settings operations; `platform/time/systemClock.ts` is domain-neutral.
- `AppServices` contains the structurally typed `settings`, `favourites`, browser-connectivity, and `favouritesPointerEnvironment` adapters. Platform modules import no feature internals.
- `platform/browser/browserFavouritesPointerEnvironment` is the sole browser owner of `document.elementFromPoint` and window pointermove/up/cancel listeners. `useFavouriteReorderInteraction` owns dragged identity, latest callbacks, native/pointer commands, hit-testing, commit-safe environment replacement, same-key idempotence, and listener cleanup; `FavouritesStage` retains only declarative markup plus DOM/pointer-capture adapters. `NavDrawerStage` key-remounts the stage on close so active listeners terminate. App retains online target resolution, cache refresh, open/navigation, and user-facing messages, but no direct favourites pointer mechanics.

Storage read/write/delete failures are explicit results. Failed saves retain current state; failed cleanup never blocks account removal. Malformed syntax/non-array data is removed when possible, and normalized values remain account-namespaced.

### Folder lifecycle

`features/browsing/folder` owns ordinary folder loading as a tagged lifecycle: idle, initial loading, cached refresh, live ready, stale cache, explicit offline, or failed. The reducer and controller are pure; `useFolder` binds requests to an immutable committed context covering account, cache namespace, path, token, mode, ports, and the explicit-offline snapshot.

- The browser adapter owns `AbortController`, live API error classification, and optional cache effects. The feature sees ports and discriminated outcomes only.
- A result, cache write, availability callback, or terminal-session callback is accepted only for the active request and committed context. Replaced work is aborted and late work is inert.
- `App` retains path/history, search, mutations, and rendering composition. FolderState→status/listError chrome mapping is owned by `features/browsing/folder` (`applyFolderStatus` / `useFolderStatus`) with App wiring ports only. Post-mutation refreshes explicitly suppress folder announcements so their caller-owned outcome is not overwritten.
- `/api/files` has one strict shared request/success schema used at Worker output and browser input. File entries require canonical paths, matching basename/name, and requested-folder containment; established optional Nextcloud permissions/owner metadata is validated explicitly.

The public folder barrel exports the hook, selectors, state/key types, and port contract only. Concrete browser API/cache code remains under `platform/api`.

### Naming and guardrail conventions

- Feature directories and public APIs use domain names (`browsing`, `transfers`, `preview`) rather than technical layer names. Cross-feature imports end at that feature's `index.ts`.
- Pure domain files are named `model.ts` or `selectors.ts`; required effects are described by `ports.ts`; orchestration is named `controller.ts`; concrete browser/runtime implementations live under `platform` or Worker `adapters`.
- Test data builders remain beside their domain owner. Shared test utilities are limited to deterministic primitives such as clocks, identifiers, browser capabilities, and deferred requests.
- `npm run check:architecture` is the compact hard gate for current workspace direction, cycles, prospective feature/layer boundaries, direct globals in migrated target modules, and exact-baselined generated JavaScript shadows.
- `npm run lint` hard-fails unused code, non-exhaustive tagged-union switches, Rules of Hooks violations, and unsafe returns. Existing promise, unsafe-operation, unnecessary-assertion, unsafe-cast, and Hooks dependency debt is fingerprinted exactly in `scripts/quality/lint-debt.json`; additions and unrecorded removals both fail.
- `dependency-cruiser` owns resolvable import topology, cycles, and workspace layer direction. The repository TypeScript-AST check owns symbol-aware platform-global access, feature public-API rules, pure model/selectors, and generated JavaScript shadows; `npm run check:architecture` runs both.
- `npm run metrics` reports module/import/platform-reference hotspots without failing budgets. Metrics become hard limits only after the owning slice is migrated and reviewed.
- Exact baselines use stable rule, path, node/message identity, normalized source, and count. Normal checks require exact equality; removals deliberately fail as a stale baseline until a prune-only command records the improvement, and that command refuses additions. `npm run baseline:lint:prune` and `npm run baseline:architecture:prune` are the deliberate prune-only paths.
- Exhaustive tagged-union mappings use `assertNever` only after all intended cases are explicit; a permissive `default` must not hide a new variant.

## Migration sequence

1. Freeze behavior and add guardrail ratchets.
2. Prove runtime-schema/endpoint-catalog infrastructure with one low-risk health endpoint.
3. Prove the service composition seam with only the adapters required by a low-risk browsing/sorting or settings-persistence pilot.
4. Migrate remaining contracts and adapters just in time with each vertical feature slice.
5. Move navigation/surface coordination only after the pilot proves boundaries without introducing a new global store.
6. Converge Worker request handling on route declaration -> typed middleware/context -> use case -> backend/account port -> mock or Nextcloud adapter.
7. Retire old paths only after focused, slice, and milestone gates prove parity.

## Request flow
1. On bootstrap, the browser checks Worker health/bootstrap requirements.
2. In local web development, the browser talks to same-origin `/api`; Vite proxies those requests to the local worker so browser CORS policy is not part of the default dev bootstrap path.
3. With no connected accounts, the browser shows a first-run zero state and collects Nextcloud connection details in-app.
4. The browser submits the account connection request to the Worker together with browser-ownership headers; the Worker validates the hostname, credentials, root access, and browser ownership, then returns non-secret account metadata.
5. When needed, the browser optionally submits the deployment unlock code together with the selected account id and the same browser-ownership headers to request an account-bound session.
6. The Worker validates the account material, signs a short-lived session token bound to that account, and returns capabilities.
7. The browser stores the opaque session token plus non-secret account/session metadata, then calls normalized JSON endpoints for the active account.
8. The Worker uses account-specific credentials to query Nextcloud WebDAV and translates XML responses into JSON. Every production Nextcloud client receives the destination policy and asserts it immediately before its sole fetch; production accepts valid public HTTPS hosts by default and can be restricted with an exact normalized hostname allowlist, while localhost is available only behind explicit development flags. Redirects remain manual, and reconnect ownership/tombstone checks precede destination validation.
9. Authorized file ingress follows the single HTTP pipeline: `http/router.ts` validates the endpoint request, `http/context.ts` selects the route-specific authority source and binds session/stream claims to account/backend/root/nonce/path, and `http/application.ts` delegates exactly once to `files/service.ts`. The service issues bounded stream tokens or calls the single `FileBackend` port; mock and Nextcloud are adapters of that same contract. `app.ts` only composes the pipeline and applies origin/CORS.
9. The browser caches successful folder/file/search responses locally under an account namespace for offline revisit. Browsing folder/search cache keys use a v2 total length-prefixed codec with independent namespace/path/query components; reads/writes never consume legacy v1 keys. Repository construction and every cache clear best-effort purge only v1 folder/search `localStorage` keys globally and verify absence; this does not touch IndexedDB, Cache Storage, Worker/API/server, or Nextcloud/WebDAV. Cached search values re-enter only through the same canonical path/name/scope validation as live results.

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
- Maintain connected accounts, active account selection, active account session, current folder, selected item, focused preview state, offline cache state, and bootstrap/unlock state. Ordinary folder and search result lifecycles are feature-owned tagged states with abortable platform ports and committed full-context identity.
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

All production API families now participate in the shared executable endpoint catalog under `packages/shared/src/api`. The catalog declares canonical methods, preserved match policy, auth class, response kind, and runtime request/success/error schemas. The Worker router parses untrusted input through those descriptors before dispatch, validates constructed JSON envelopes before serialization, and preserves route-specific authority and binary response checks. The browser parses JSON success envelopes before feature adapters enforce request matching and domain containment. The development-only mock reset remains deliberately outside the public catalog behind its explicit runtime/token gate.

`GET` is the canonical health method used by the browser descriptor. The current Worker branch remains path-only and method-permissive because rejecting previously accepted methods would be an unrelated behavior change. Method enforcement belongs to the later typed-router migration after explicit characterization and review.

Shared path algebra distinguishes validated logical paths (`NormalizedPath`) from paths proven to be resolved beneath a root (`SandboxedPath`). Only `packages/shared/src/paths.ts` creates these brands after segment validation. Raw query, JSON, persisted, and WebDAV values remain strings at their boundaries; callers parse explicitly before branded operations. The first runtime pilot is `NextcloudClient.listFolder`; other Nextcloud methods, mock data, contracts, cache keys, and application state remain on their legacy string signatures until their owning slice migrates.

Destination planning is web workflow policy owned by `features/operations/destination`, not a shared transport contract. Shared paths provide canonical segment validation; the feature adds operation-specific naming, conflict, containment, listing, and target rules.

Operation admission is web workflow policy owned by `features/operations/policy`. A pure evaluator combines committed connectivity mode, session presence, exact server capabilities, and subject shape; render-time controls use the current render environment while callbacks use layout-published committed context/environment references. Opaque context identity binds dialogs, multi-request mutations, transfers, and async completion to account, session token identity, and mode. Capability changes disable and guard without replacing workflow identity. Account-owned transfers remain observable only in their account, and direct-download request ownership includes abort and unmount cleanup before browser save.

Batch copy/move execution is owned by `features/operations/copyMove`. Its controller consumes already-valid destination targets through narrow execution and refresh ports, preserves source order, accumulates ordinary failures, stops on terminal or superseded context, refreshes exactly once after nonterminal execution, and returns typed outcomes. `App` remains the composition owner for picker state, admission, busy indication, messages, and selection/focus reconciliation. The touched `/api/move` and `/api/copy` boundary has strict shared request/success schemas; Worker and browser additionally require response action and canonical source, destination, parent, and optional item identity to match the request.

Batch-delete execution and retry ownership lives in `features/operations/delete`, separately from copy/move because delete deliberately stops at the first ordinary failure. Its opaque workflow identity binds immutable submitted targets to an original-order unresolved queue; deterministic execution orders descendants before ancestors while accepted progress removes only the current target and lets `App` reconcile exact/descendant selection once. Terminal or superseded work stops before another request, and refresh occurs only after full success. `App` retains dialog visibility, busy indication, exact copy, and rendering. The strict `/api/delete` contract rejects the account root, malformed input, and response identity mismatches before Worker execution or browser trust.

## Offline-sync workspace and runtime

`features/offline/sync/workspace` is the composition owner for the offline-sync feature. It freezes the account/path/cache namespace/session revision/browser-mode context, derives the established search/browse archive roots and labels, invokes the existing `useOfflineSync` lifecycle exactly once, constructs its narrow ports, and projects `OfflineSyncConfirmStageProps`. The hook remains the sole owner of attempt identity, estimate abort, dialog/busy state, confirm deduplication, dismissal, retry, replacement, unmount, and late-result invalidation.

`platform/offline/browserOfflineSyncRuntime.ts` is the sole browser adapter for this slice. It forwards the existing normalized list/download API calls, creates abort handles and secure transfer IDs, reads Blob text using the established fallback, and classifies/redacts existing API errors. It contains no retry/timer policy, generic service locator, feature import, persistence policy, or WebDAV call. `AppServices` constructs one adapter and `App` passes public authority, selection, retention, transfers, coordination, and runtime ports while mounting the projected Stage directly. The old `createOfflineSyncComposition` is retired to `.tmp/trashbin/` after the switch.

The ownership boundary intentionally stops before explicit-offline mode, retention repositories, operation authority, selection, transfer ledger/tray, browsing, account/session, navigation, preview, wake lock, and shell state. Cache writes and retained-root publication continue to use existing account/cache namespace and operation-currentness guards; browser credentials never enter Stage props, URLs, logs, or persistence, and no WebDAV/Nextcloud data is removed.

## Security boundaries
- Trust boundary 1: browser ↔ Worker via connect/session bootstrap requests carrying browser-ownership headers and a signed account-bound session token.
- Trust boundary 2: Worker ↔ Nextcloud via Basic auth using user-supplied credentials held server-side for the current app runtime.
- All direct WebDAV requests stay inside the Worker boundary.
- `APP_UNLOCK_CODE` is validated server-side and never returned to the browser.
- Browser-side caches and sessions are partitioned by account namespace to prevent cross-account bleed.
- Account removal is a persisted `revoke -> purge` workflow: pending accounts are quiesced before revocation, Worker authority must be durably revoked before browser data is purged, and failure at either stage remains retryable rather than publishing local-only completion. The browser purge is client-only and covers normal/retained opened-file entries, browsing cache, favourites, and known legacy namespace forms; it must preserve other account namespaces and never delete WebDAV/Nextcloud data.
- The Worker CORS policy allows `DELETE` only through the established exact-origin policy. The browser continues to send browser-ownership headers; account/session routes remain Worker authority and the browser never calls WebDAV.

## Storage foundation note
- This pass establishes a strong runtime account foundation and browser-safe persistence model.
- Local Node-worker development now persists connected accounts in an encrypted `.tmp/local-dev/worker-state.json` file by default, keyed from the local session secret so restarts preserve account continuity without moving raw credentials into browser storage.
- Deployed Cloudflare runtime now persists the same encrypted connected-account payload in the `DAVORA_ACCOUNT_STORE` Durable Object. Packet 11a made this necessary because pure in-memory Worker maps were insufficient in deployed runtime: `POST /api/accounts` and the immediate `POST /api/session` can hit different isolates, and Cloudflare does not guarantee isolate-sticky request handling or durable in-memory state.
- Browser persistence keeps only non-secret account metadata, browser-ownership tokens, and session tokens; it never stores raw app passwords.

## Backend state policy
- The current backend state is intentionally minimal: only the Worker-side connected-account material needed to preserve correct account-bound session behavior across deployed isolate hops is persisted server-side.
- Packet 11a chose a Durable Object because it was the smallest working deployed fix: it reuses the existing AES-GCM encrypted payload format keyed by `SESSION_SECRET`, leaves local-dev file persistence unchanged, and avoids pushing raw credentials into browser storage or redesigning the session model.
- `DAVORA_ACCOUNT_STORE` persists one encrypted V2 snapshot containing account records and owner/account-scoped revocation tombstones. V1 account-only snapshots are accepted only for migration to V2; later writes preserve the V2 shape. Connect/remove/clear-all replace the complete encrypted snapshot rather than appending history.
- Removal is persistence-first: the next snapshot removes the account and records its tombstone before runtime state is published. Hydration restores tombstones so stale authority cannot reappear after restart; matching reconnect is rejected and repeated owner-authorized delete remains idempotent. Tombstones have no automatic TTL/pruning: they are retained until an explicit authorized clear-all operation writes an empty account-and-revocation snapshot. A failed durable write leaves the preceding runtime and durable snapshot authoritative and retryable.
- Current bounds are only the ones the implementation actually has today: no app-level max account count, age-based retention window, or per-account history exists; the practical ceiling is the single encrypted snapshot model plus underlying Durable Object storage/write limits. `SESSION_TOKEN_SECRET` is an optional separate signing key for session-only invalidation. `ACCOUNT_STATE_SECRET` enables an explicit one-time migration from legacy `SESSION_SECRET`; afterward state encryption and token signing are separated. An unreadable snapshot is never silently treated as empty state.
- The user is skeptical of backend state/storage. Any future backend-state addition must clear a higher bar in docs before implementation: record the exact failure being solved, explain why browser-local/stateless/request-scoped alternatives are insufficient, justify why the proposed server-side state is the minimum safe fix, and describe its cleanup/retention limits explicitly.

## Validation strategy
- Unit/integration tests cover shared helpers, Worker auth/config logic, account validation, account-bound sessions, WebDAV translation, and browser UI state.
- Playwright covers desktop, mobile, offline browser checks, focused preview flow, contextual mutation dialogs, zero-state onboarding, account switching, and reconnect/remove flows against mock mode.
- Real validation provisions only `.davora-agent-test` via direct WebDAV setup/cleanup, then exercises the real Worker through the in-app account connect + session + list/file/search/move/copy/create-folder/upload/delete behavior inside that sandbox.
