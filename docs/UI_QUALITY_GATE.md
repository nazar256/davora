# UI Quality Gate

Davora UI work is not approved by “looks improved” feedback anymore. Approval requires a reviewer to compare the change against the redesign brief, the checked-in evidence, and this gate.

## 1. Required inputs before any UI approval
- `AGENTS.md` — the current operational handoff, latest active deploy, no-commit instruction, and open review gate.
- `docs/FILE_MANAGER_REDESIGN_BRIEF.md` — the design source of truth.
- `docs/UX_REVIEW.md` — scenario record plus screenshot walkthrough.
- `docs/TESTING.md` — validation commands and current outcomes.
- `docs/HANDOVER.md` — future-agent operating guidance.
- Checked-in screenshots in `docs/screenshots/`.

If those are stale, incomplete, or inconsistent with the actual UI, the pass is **not** ready for approval.

`AGENTS.md` must be checked before interpreting screenshots or deploy URLs. If screenshots ever include a local-only follow-up that is newer than the live Pages/Worker deployment, docs must say so explicitly and the pass must not be described as deployed until the full validation/deploy path has run.

### Browser-rendered evidence rule
Any UI/UX judgment such as “clearer”, “cleaner”, “more cramped”, “dominant”, “confusing”, or “ready to ship” must be backed by browser-rendered evidence from the current build.

Accepted evidence is limited to at least one of:
- current checked-in screenshots captured from the browser;
- a Playwright/browser run that exercises the claimed UI state;
- a live Chrome/DevTools/browser walkthrough of the relevant surface.

Code diffs, JSX/CSS inspection, static source reads, or reviewer intuition alone do **not** count as UI evidence. A read-only reviewer who does not have browser-rendered evidence must not mark a visual/interface claim as PASS or approved; the correct outcome is `NEEDS_BROWSER_EVIDENCE`.

## 2. Design review checklist (must be executed explicitly)
A reviewer must answer each item with PASS/FAIL and be able to cite where the evidence came from.

### Hierarchy and intentionality
1. The center file surface is obviously primary on desktop.
2. Navigation and context rails read as secondary support surfaces.
3. The main folder heading, breadcrumbs, search, and current-folder actions feel like one coherent browse system.
4. Search results still communicate where the result lives.
5. The layout avoids “box soup” and does not feel like a pile of equivalent cards.
6. Navigation controls (breadcrumbs vs. action bars) are reviewed side-by-side to ensure no redundant controls (e.g., avoiding separate "Up one level" buttons when breadcrumbs already cover navigation).

### Selection and actions
7. Selection-specific actions remain contextual and do not dominate when nothing is selected.
8. Destructive actions still require explicit focused confirmation.
9. The right rail helps the main task instead of pulling attention away from the file list; on idle browse views, it should not show a generic workspace-details panel unless there is an active selection or batch-selection context.

### Preview quality
10. Opening a file feels like a mode change.
11. The preview makes file identity unmistakable.
12. Content stays visually dominant over metadata inside preview.
13. Unsupported or degraded preview states stay honest without collapsing the workspace.

### Operational honesty
14. Offline/stale/error/permission states remain readable in the same layout.
15. Recoverable failures expose a visible recovery action close to the affected surface.
16. v1 capabilities are preserved without pretending the product supports out-of-scope views.

### Responsive proof
17. Mobile keeps the file surface first and usable without wading through support panels.
18. Mobile preview still feels focused rather than cramped.
19. The checked-in screenshot set explains the shipped UI to someone who does not run the app.

## 3. QA and evidence workflow for UI changes
### Required commands
Run these from the repo root after UI edits:
1. `rtk npm run typecheck`
2. `rtk npm test`
3. `rtk npm run build`
4. `rtk npm run test:e2e`

Use `rtk npm run test:screenshots` only when refreshing artifacts without rerunning the full browser suite.

For non-UI runtime fixes, do not refresh screenshots solely for documentation churn. Record why the change has no visual surface in `docs/UX_REVIEW.md` and keep runtime proof in `docs/TESTING.md`.

### Required screenshot artifacts
All of these must exist and be current when UI work changes the experience:
- `docs/screenshots/davora-browse-preview.png`
- `docs/screenshots/davora-focused-preview.png`
- `docs/screenshots/davora-mutation-controls.png`
- `docs/screenshots/davora-settings-dialog.png`
- `docs/screenshots/davora-unlock-screen.png`
- `docs/screenshots/davora-error-state.png`
- `docs/screenshots/davora-mobile-browse.png`
- `docs/screenshots/davora-mobile-navigation.png`
- `docs/screenshots/davora-mobile-partial-transfer.png`
- `docs/screenshots/davora-mobile-focused-preview.png`

### Required written evidence updates
Update these docs whenever the pass changes shipped UI behavior, review expectations, or proof structure:
- `AGENTS.md`
- `README.md`
- `docs/UX_REVIEW.md`
- `docs/TESTING.md`
- `docs/HANDOVER.md`
- `docs/ACCEPTANCE.md` when acceptance criteria or process evidence changed

## 4. Reviewer responsibilities
The independent reviewer should verify:
- the UI matches the redesign brief rather than merely differing from the old version;
- the checklist above is actually satisfiable from the evidence;
- screenshots show the current UI, not stale artifacts;
- browser flows cover the claimed desktop/mobile/degraded behaviors;
- docs explain what changed and how to evaluate it.

A reviewer should call out missing evidence as a real issue, not a paperwork nit.
If the reviewer only inspected code or docs and did not inspect browser-rendered evidence, they are not authorized to sign off UI/UX quality claims.

## 5. Handover / future-agent guardrail
Future agents must not repeat the weak approval mistake of accepting a UI pass because it is “closer” or “cleaner.”

Before claiming a Davora UI pass is done:
1. Re-read the redesign brief.
2. Re-run the required validation commands.
3. Refresh screenshot evidence.
4. Update the docs listed above.
5. Ask an independent reviewer to evaluate the actual evidence and checklist, not just the code diff.
6. If the evidence is weak, incomplete, or ambiguous, keep refining.

“Directionally better” is not sufficient. Davora UI approval is evidence-backed signoff against a checked-in brief.

2026-07-06 PER-5 reopened mobile layout evidence: targeted mobile Playwright now asserts the file-list panel fills most of the viewport and does not overflow below it; `docs/screenshots/davora-mobile-browse.png` was refreshed; screenshots 14/14 active and PWA 6/6 passed before deploy.
2026-07-06 PER-40 streaming media evidence: `docs/screenshots/davora-media-streaming.png` was generated by Playwright and attached to Linear. It proves the visible video preview state and streaming-only user copy; the paired Playwright assertion proves the media element uses `/api/file/stream`, avoids `/api/file/original` for the over-limit video, and surfaces bounded retry/backoff/manual retry on playback errors. Screenshots 15/15 active and PWA 6/6 passed before deploy.
2026-07-06 PER-39 recursive offline sync evidence: `docs/screenshots/davora-offline-sync-management.png` was generated by Playwright and will be attached to Linear. It proves the visible Profile & settings management state after keeping a folder offline; paired App/cache tests prove storage confirmation, recursive folder expansion, cache-limit exemption, local-only removal, retry, and preservation of kept-offline blobs/folder snapshots across normal cache clearing. Screenshots 16 active / 16 skipped and PWA 6/6 passed before deploy.
2026-07-08 PER-39 cache-accounting follow-up evidence: `docs/screenshots/davora-offline-sync-management.png` was refreshed by Playwright and attached to Linear as `14faa7e2-d03d-4d71-9b50-fde4e32b38fe`. It proves the visible normal Offline cache summary can show `0 cached files • 0 B used`; paired App/opened-file-cache tests prove kept-offline items are still listed separately and excluded from the evictable cache counter/used bytes.
2026-07-08 PER-44 inline PDF preview evidence: `docs/screenshots/davora-browse-preview.png` was refreshed by Playwright and proves `Archive/guide.pdf` renders inside the preview using the embedded browser PDF viewer rather than the generic browser-support card. Paired desktop+mobile Playwright coverage proves the PDF frame uses a blob URL and Open PDF in new tab/Download remain available.

2026-07-09 reopened PER-44 mobile/PWA PDF preview evidence: `docs/screenshots/davora-mobile-pdf-preview.png` was captured by Playwright after replacing the mobile browser PDF placeholder path with an in-app pdf.js canvas renderer. The proof shows readable PDF page content, the real `guide.pdf` filename, and compact Details/Open PDF/Download/Back actions without UUID-like labels or toolbar overlap.
2026-07-09 PER-44 PDF controls evidence: `docs/screenshots/davora-mobile-pdf-preview.png` was refreshed after adding multi-page PDF controls. The proof now shows `Page 2 of 2`, visible previous/next/zoom/Fit width/Fit page controls, and page-two content in the scrollable in-app canvas preview. Paired Playwright coverage proves mouse-wheel page tracking, button page switching, fit controls, and simulated pinch zoom; PWA coverage proves the pdf.js `.mjs` worker is precached.
2026-07-08 PER-45 experimental HEIC preview evidence: `docs/screenshots/davora-heic-fallback.png` was generated by Playwright and proves the disabled-by-default `.heic` path renders an honest fallback with original-file actions. Paired App and HEIC worker tests prove enabled local decode wiring, guard/error fallback behavior, cache-toggle behavior, and timeout recovery.

2026-07-08 PER-42 background keep-offline sync evidence: `docs/screenshots/davora-offline-sync-background.png` was generated by Playwright and proves the keep-offline modal closes into a readable Background transfers popover while the Projects browser remains visible. PWA revalidation passed after the transfer-tray z-index correction, confirming preview/settings modals are not blocked by the app bar.

2026-07-09 PER-42 reopened recursive retry evidence: `docs/screenshots/davora-offline-sync-retry-folder.png` was generated by Playwright and proves retry preserves the original folder selection after a recursive sync child failure. The confirmation shows `Projects`, recursive folder treatment, and the full file count instead of the failed `bad.pdf` child as the retry target.

2026-07-08 PER-43 mobile settings sheet evidence: `docs/screenshots/davora-mobile-settings-dialog.png` was generated by Playwright and proves the mobile Profile & settings surface is opaque, top-docked, and free of readable background bleed above the header. The same validation kept PWA checks green after raising the settings scrim above the pull-to-refresh indicator.

2026-07-08 PER-41 pull-to-refresh gesture evidence: `docs/screenshots/davora-mobile-pull-refresh-gesture.png` was generated by Playwright and proves the mobile pull-to-refresh affordance is a lightweight gesture/status line with transparent background, no border, and no pointer events rather than a disabled-looking pill or panel. It is rendered below the app bar and is suppressed while modal/sheet surfaces are open.

2026-07-10 PER-50 mobile action/details sheet evidence: `docs/screenshots/davora-mobile-details-sheet.png` was generated by Playwright and attached to Linear as `fa2aa52f-fc32-463e-ae31-eff4c1b1a836`. It proves the mobile selected-item sheet uses an explicit `Details` state with no fake drag handle, clear `Actions`/`Close` controls, predictable metadata scrolling, and visible file actions.
2026-07-10 PER-52 mobile delete confirmation evidence: `docs/screenshots/davora-mobile-delete-confirmation.png` was generated by Playwright and attached to Linear as `ca3897cf-2cbc-4167-899b-ca2518f3c155`. It proves the single-item delete dialog has permanent server-delete wording, shows a long non-Latin target path, omits the old typed-name field, and exposes only `Cancel` and destructive `Delete` actions.
2026-07-10 PER-51 media autoplay evidence: `docs/screenshots/davora-media-autoplay-blocked.png` was generated by Playwright and attached to Linear as `58c388d2-631f-4b66-aafc-b89928875823`. It proves the blocked-autoplay fallback is visible with a manual `Play media` action, while paired App and desktop Playwright instrumentation prove audio/video previews call `play()` on open and pause on close or media switch.
2026-07-10 PER-49 mobile sticky-toolbar evidence: `docs/screenshots/davora-mobile-sticky-toolbar.png` was generated by Playwright and attached to Linear as `a77cb58b-d447-451d-9387-1fab8c1e6af3`. It proves the compact mobile toolbar remains visible after the long file list scrolls near the bottom; paired Playwright coverage proves the file-list panel owns scroll, browser window scroll stays at 0, and pull-to-refresh is gated while the list is scrolled.
2026-07-10 PER-46 reopened copy-or-move destination picker evidence: `docs/screenshots/davora-mobile-destination-picker.png` was generated by Playwright and attached to Linear as `3b70b9c4-fbd4-41ba-a419-4b3dab7bb5fb`. It proves the mobile selected-item action now opens a `Copy or move item` folder browser destination picker with non-Latin folder browsing, original `roadmap.txt` destination name, manual-path escape hatch, resolved destination copy, and both `Copy here` and `Move here` actions.
2026-07-09 PER-47 mobile preview toolbar evidence: `docs/screenshots/davora-mobile-preview-actions.png` was generated by Playwright at 320px mobile width and proves the reported Details/Fit/Open original/Download/Back action set renders as separated, tappable rows without overlap. Paired browser coverage measures the actual rendered action boxes and verifies safe clipping for the long `Open original` label.
2026-07-10 PER-48 image/PDF zoom evidence: `docs/screenshots/davora-mobile-preview-zoom.png` was generated by Playwright and proves the mobile preview exposes an active 100% original-size image zoom mode. Paired desktop+mobile Playwright coverage verifies image Ctrl/Cmd+wheel, image pinch, PDF Ctrl/Cmd+wheel, PDF touch pan, PDF pinch, PDF page controls, and the no-jump first-gesture zoom baseline from Fit/Fill.
