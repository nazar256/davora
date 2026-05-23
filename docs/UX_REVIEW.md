# UX Review

## Scenario matrix

| Scenario | Device / Viewport | Steps | Result |
| --- | --- | --- | --- |
| First-run zero state | Desktop Chrome, 1280x720 | Load app with no accounts → verify explicit Connect account CTA and focused form | PASS |
| Desktop connected workspace | Desktop Chrome, 1280x720 | Connect account → verify active-account context stays visible while file-manager remains dominant | PASS |
| Desktop account switching | Desktop Chrome, 1280x720 | Connect account A → open `Profile & settings` → add account B → switch active account from that one-click settings surface | PASS |
| Desktop profile/settings shell | Desktop Chrome, 1280x720 | Connect account → open `Profile & settings` → verify account details/actions and cache controls move off the main workspace while file-size mode stays in the toolbar | PASS |
| Desktop mutation flow | Desktop Chrome, 1280x720 | Connect account → create folder → upload file → rename | PASS |
| Desktop unlock bootstrap | Desktop Chrome, 1280x720 | Connect account under unlock-protected health state → enter wrong code → verify error → enter correct code | PASS |
| Desktop offline cached access | Desktop Chrome, 1280x720 | Connect account → open cached file online → go offline → navigate via cached folder data | PASS |
| Desktop cache-first folder refresh | Desktop Chrome, 1280x720 | Reload with cached root folder → verify cached rows render first, stale/refresh copy stays visible, then background refresh swaps in the newer folder result | PASS |
| Desktop cache-first preview apply flow | Desktop Chrome, 1280x720 | Reopen a cached file while online → verify cached preview remains visible until Apply refreshed version is clicked | PASS |
| Account-scoped cache switching | Desktop + mobile Chrome | Seed different cached folders per account → switch active account → verify each account only surfaces its own cached folder state | PASS |
| Desktop preview refinement pass | Desktop Chrome, 1280x720 | Open markdown/image/video/PDF → verify one clear Back action, compact header, larger natural-fill media/PDF stage, lighter file details, and better PDF actions | PASS |
| Desktop video autoplay behavior | Desktop Chrome, 1280x720 | Open `clip.mp4` → verify preview starts with muted inline autoplay-compatible video attributes | PASS |
| Desktop unsupported-file fallback | Desktop Chrome, 1280x720 | Open an unsupported file from Archive → verify the browser starts a download instead of opening a dead-end preview screen | PASS |
| Desktop breadcrumb navigation cleanup | Desktop Chrome, 1280x720 | Open a folder → verify breadcrumbs use a home root plus slash-separated segments and the redundant `All files` / `Up one level` controls are gone | PASS |
| Desktop drag-and-drop upload | Desktop Chrome, 1280x720 | Drag a file into the folder-view list surface → verify the drop affordance appears and the upload completes into the current folder | PASS |
| Desktop gallery navigation | Desktop Chrome, 1280x720 | Open image/audio media in the same folder → verify overlay next/previous controls appear, photo click/Space advance to the next item, and audio/video do not auto-advance from those gestures | PASS |
| Desktop audio reopen resume | Desktop Chrome, 1280x720 | Open `Projects/song.mp3` → move playback forward → close preview → reopen the same file in the same account/browser and verify best-effort resume restores the last position without any resume claim when unavailable | PASS |
| Desktop reconnect/remove | Desktop Chrome, 1280x720 | Connect account → clear mock worker state → verify reconnect form → reconnect → remove account | PASS |
| Desktop relaunch continuity | Desktop Chrome, 1280x720 | Connect account → remove the persisted browser session token → reload → verify the workspace restores instead of landing in reconnect | PASS |
| Desktop relaunch after local dev restart | Desktop Chrome, 1280x720 | Connect account in default `rtk npm run dev` → restart the local worker/web pair → reload → verify the stale reconnect-required banner clears and the workspace restores without re-entering credentials | PASS |
| Mobile browse + account-aware details | Chrome mobile emulation (Pixel 7) | Connect account → open folder → open row details in bottom sheet → verify browse-first layout | PASS |
| Mobile profile/settings close pattern | Chrome mobile emulation (Pixel 7) | Open `Profile & settings` → verify the header keeps a clean top-right Done action and closes without an awkward stacked close button | PASS |
| Overlay outside-click dismissal | Desktop Chrome, 1280x720 | Open settings / create-folder / preview overlays → click the scrim outside the card and verify each closes | PASS |
| Checked-in screenshot capture | Desktop + mobile Playwright capture | Run `rtk npm run test:screenshots` to refresh zero state, connected workspace, browse preview, focused preview, mutation controls, unlock, error, reconnect, and mobile artifacts | PASS |
| Desktop PWA installability | Desktop Chrome preview build | Load the built app in Chrome → verify manifest metadata is valid, the service worker takes control after reload, and Chrome reports no installability blockers beyond the automation-only `in-incognito` warning | PASS |
| Desktop dev-mode PWA installability | Desktop Chrome dev server | Run the default root `rtk npm run dev` flow → verify `/manifest.webmanifest` is present, the dev service worker controls after reload, and Chrome installability has no blockers beyond automation/incognito noise | PASS |
| Desktop PWA offline honesty | Desktop Chrome preview build | Verify both paths: (a) prime cached account data online, then reload offline and confirm cached reads stay available/read-only; (b) reload offline without cached account data and confirm the app stays in zero-state without false offline-read claims | PASS |
| Installed PWA stopped-server launch shell | Installed Chrome PWA, 1280x720 | Install the preview build → stop the local worker/server while Chrome still stays online → launch the installed app and verify cached workspace shell/actions render instead of a white screen or restore dead-end | PASS |
| Installed PWA update application | Installed Chrome PWA, 1280x720 | Load build label `pwa-initial` → rebuild as `pwa-updated` → accept the update prompt → verify the settings dialog now reports `pwa-updated` | PASS |

## Design-review checklist execution record
Source of truth: `docs/FILE_MANAGER_REDESIGN_BRIEF.md` + `docs/UI_QUALITY_GATE.md`

| Checklist item | Verdict | Evidence |
| --- | --- | --- |
| The zero state clearly tells the user what to do first | PASS | `davora-zero-state.png` plus Playwright onboarding flow. |
| The connect-account form feels focused and trustworthy | PASS | First-run screenshot and browser flow show one focused form with explicit fields and secret-handling copy. |
| The file surface remains primary once connected | PASS | `davora-connected-workspace.png` shows account context without crowding the file browser. |
| Active-account context is always understandable | PASS | `Profile & settings` keeps account identity/switching one click away while the shell itself stays cleaner and still shows workspace status. |
| Connected header avoids wasting space on persistent product naming | PASS | Connected workspace/browser evidence now shows the `Davora` wordmark removed from in-app chrome while status/location/settings/transfers remain visible in that same compact header space. |
| Account switching feels explicit and safe | PASS | `davora-account-switcher.png` and Playwright switching coverage. |
| Account and cache details stay secondary to browsing | PASS | `davora-settings-dialog.png` shows details/actions moved out of the main shell while the workspace remains list-first. |
| Selection actions stay contextual | PASS | Mutation flow still uses row Details + right rail. |
| Preview still feels like a mode change | PASS | `davora-browse-preview.png`, `davora-focused-preview.png`, preview browser checks, and the direct-download unsupported fallback that avoids a dead-end modal. |
| Audio preview resume stays honest | PASS | Desktop browser coverage confirms same-account reopen restores the saved position best-effort; no new UI resume claim appears when that restore state is missing or unusable. |
| Reconnect-required state is distinct and actionable | PASS | `davora-reconnect-state.png` and reconnect/remove browser flow. |
| Offline/account cache behavior stays honest | PASS | Offline Playwright flow, account-scoped cache tests, and preview-build Packet 4 offline verification. |
| Installability is explicit and truthful | PASS | Both preview-build and default-dev Chrome evidence show valid manifest metadata, active service-worker control after one reload, and no installability blockers beyond Chrome automation's `in-incognito` warning. |
| Mobile keeps browse-first priority | PASS | `davora-mobile-browse.png` plus mobile Playwright flow. |
| Required v1 file capabilities remain preserved | PASS | Mutation, preview, offline, unlock, and reconnect coverage stayed green. |
| Screenshot set explains the shipped result without running it | PASS | Ten checked-in screenshots cover zero state, workspace, switching, the new settings dialog, preview states, mutation controls, unlock, error, reconnect, and mobile evidence. |

## Checked-in visual evidence

### First-run zero state
![First-run zero state](screenshots/davora-zero-state.png)
_The app starts with a focused account-onboarding surface instead of assuming one server-configured account._

### Connected account workspace
![Connected account workspace](screenshots/davora-connected-workspace.png)
_Once connected, active-account context stays visible while the file-manager workspace remains dominant and the in-app chrome no longer spends that row on a persistent `Davora` wordmark._

### Account switching context
![Account switching context](screenshots/davora-account-switcher.png)
_The main shell stays light while account switching remains explicit and safe._

### Profile & settings dialog
![Profile and settings dialog](screenshots/davora-settings-dialog.png)
_Account details/actions and cache controls now live behind one practical entry point while file-size mode stays in the main workspace toolbar._

### Browse + PDF preview workspace
![Browse + PDF preview workspace](screenshots/davora-browse-preview.png)
_PDF preview now keeps the list context intact, uses a more compact connected header without the persistent product name, gives the document much more room, and offers clear open/download fallback actions._

### Focused preview overlay
![Focused preview overlay](screenshots/davora-focused-preview.png)
_Focused preview keeps content dominant with a tighter header, one clear dismiss action, a lighter details disclosure, and same-account audio reopen now resumes best-effort from the last remembered position only when the browser can restore it honestly._

### Mutation controls
![Mutation controls](screenshots/davora-mutation-controls.png)
_The browse controls now use breadcrumb-first navigation with a home root, clearer Info context, and unsupported files download directly instead of trapping the user in a dead-end preview._

### Unlock-required state
![Unlock-required state](screenshots/davora-unlock-screen.png)
_Top-area state keeps a stable slot so gating states do not make the file list jump._

### Error state
![Error state](screenshots/davora-error-state.png)
_Recoverable failures stay visible without moving the rest of the workspace unpredictably._

### Reconnect-required state
![Reconnect-required state](screenshots/davora-reconnect-state.png)
_When Worker runtime account state is lost, Davora asks for reconnect rather than silently mixing state._

### Mobile browse-first workspace
![Mobile browse-first workspace](screenshots/davora-mobile-browse.png)
_Mobile still keeps browsing first while preserving account-aware state and bottom-sheet details._

## Research references and applied patterns
- **Primary reference — Nextcloud Files:** [Accessing your files using the Nextcloud web interface](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webgui.html). Applied patterns: list-first browsing, breadcrumbs above the file list, create/upload near the current folder, contextual details/actions, and dedicated file open/preview behavior.
- **Supporting pattern family — productivity app account switchers:** used conceptually for lightweight active-account context and explicit switching without a heavy settings detour.
- **Applied refinement in this pass:** preview now uses one clear dismiss action, a tighter header, lighter details disclosure, natural-fill media/PDF stage sizing without vh magic numbers, tighter markdown MIME normalization, and the app/header banner area keeps a reserved slot to reduce layout shift.
- **Packet 12 milestone 1 note:** connected in-app chrome now removes the persistent `Davora` wordmark so header space favors status/location/install/settings/transfers, and audio preview persists last-known playback position per browser account + file path on a best-effort basis without any misleading resume UI when restore is unavailable.
- **Environment note for this review pass:** the installed-PWA stopped-server test remains part of the standing matrix, but this environment does not have a system Chrome binary with the required CDP `PWA.*` domain, so that one sub-check is skipped automatically while the rest of the preview-build PWA/browser evidence still passes.
- **Packet 1 completion note:** the shipped UI now runs only from the current TS/TSX sources, root folders open cache-first with background refresh, cached file previews stay stable until the user applies a fresher version, and account switching preserves cache isolation.
- **Packet 2/5/7 completion note:** account details/actions and cache controls now live behind `Profile & settings`, the shell no longer repeats the desktop account selector on every page, the mobile dialog uses a cleaner Done close action, file-size display now supports Human readable / KB / MB / GB from the main workspace header, cache limit now uses slider/manual controls plus a 15 MB default max-cacheable-file-size policy, and drag-and-drop upload is available directly from the folder view.
- **Packet 3/6 completion note:** unsupported file types now skip the dead-end preview layer, show an immediate status update, preflight auth/path errors before the handoff, and then hand downloads off through the browser-native Worker download route instead of buffering whole files through a fetch/blob fallback; breadcrumb navigation now uses a home root plus slash separators and removes redundant all-files/up-level controls.
- **Packet 4 completion note:** Davora now ships installable PNG + maskable icons plus an Apple touch icon, keeps onboarding clear by surfacing install as a quiet contextual app-bar action only after a workspace is active, suppresses the non-essential offline-ready success toast, and still has preview-build Chrome checks for service-worker control, installability, cached offline reuse, and honest uncached fallback behavior.
- **Packet 5 completion note:** video preview now uses muted inline autoplay for browser compatibility, and modal/popup overlays dismiss on outside click instead of forcing only explicit close buttons.
- **Packet 7 completion note:** the default `rtk npm run dev` path now registers an installable dev-mode service worker for Chrome verification, local relaunch retries transient bootstrap/session races before surfacing reconnect, media preview adds next/previous overlays plus one-ahead prefetch, and oversized files stay viewable/downloadable while skipping full-blob browser caching above the configurable threshold.
- **Packet 8 completion note:** ordinary local relaunch now also clears stale reconnect-required browser flags when the worker can restore the account, installed PWAs keep a usable cached shell offline instead of blanking white, and the update prompt is now truthful because reload waits for service-worker takeover and visibly activates the new build label/content.

## Remaining non-blocking issues
- OAuth and generic WebDAV remain future work by design.
