# UI Quality Gate

Davora UI work is not approved by “looks improved” feedback anymore. Approval requires a reviewer to compare the change against the redesign brief, the checked-in evidence, and this gate.

## 1. Required inputs before any UI approval
- `docs/FILE_MANAGER_REDESIGN_BRIEF.md` — the design source of truth.
- `docs/UX_REVIEW.md` — scenario record plus screenshot walkthrough.
- `docs/TESTING.md` — validation commands and current outcomes.
- `docs/HANDOVER.md` — future-agent operating guidance.
- Checked-in screenshots in `docs/screenshots/`.

If those are stale, incomplete, or inconsistent with the actual UI, the pass is **not** ready for approval.

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
9. The right rail helps the main task instead of pulling attention away from the file list.

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

### Required screenshot artifacts
All of these must exist and be current when UI work changes the experience:
- `docs/screenshots/davora-browse-preview.png`
- `docs/screenshots/davora-focused-preview.png`
- `docs/screenshots/davora-mutation-controls.png`
- `docs/screenshots/davora-settings-dialog.png`
- `docs/screenshots/davora-unlock-screen.png`
- `docs/screenshots/davora-error-state.png`
- `docs/screenshots/davora-mobile-browse.png`

### Required written evidence updates
Update these docs whenever the pass changes shipped UI behavior, review expectations, or proof structure:
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
