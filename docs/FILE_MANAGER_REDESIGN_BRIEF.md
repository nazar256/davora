# Davora File Manager Redesign Brief

- Status: active design source of truth for the file-manager + account-foundation UX
- Date: 2026-05-21
- Product surface: `apps/web`
- Primary reference: [Nextcloud Files web interface](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webgui.html)
- Supporting comparators: [Google Drive details/activity side panel](https://support.google.com/drive/answer/2409045?hl=en), modern account switcher/onboarding patterns from productivity PWAs
- Companion process gate: `docs/UI_QUALITY_GATE.md`

## 1. Product intent
Davora should feel like a confident modern file manager with explicit multi-account control, not a developer demo with credentials stapled on.

The redesign must make browsing the dominant job to be done while account onboarding and switching stay clear and safe:
- connect a Nextcloud account inside the app without hidden server-launch setup;
- orient quickly in the folder tree for the active account;
- scan files comfortably;
- open a file into a focused preview experience;
- switch accounts without losing trust in what data belongs to which account;
- stay trustworthy when the Worker is offline, stale, requires reconnect, or returns a recoverable error.

The target is **Nextcloud Files with Davora’s v1 scope and operational honesty**, plus a lightweight in-app account model.

## 2. Mandatory process for every redesign/refinement pass
Every UI pass must follow this loop:
1. Use this brief as the explicit source of truth before changing code.
2. Read `docs/UI_QUALITY_GATE.md` before approval-sensitive UI work.
3. Implement/refine the UI against the brief, not against vague taste.
4. When helpful for design decisions, checked-in HTML/CSS-style mock screens or prototype artifacts are allowed, but they must support—not replace—the working implementation.
5. Prefer reusable existing primitives or well-established patterns where they reduce risk; do not introduce a new UI library without a concrete payoff.
6. Run browser validation on desktop, mobile, and every degraded/account state touched by the pass.
7. Refresh checked-in screenshot evidence.
8. Execute the design-review checklist from the quality gate, item by item.
9. Update the UX/testing/handover docs that explain the shipped result.

## 3. Primary references and extracted patterns
### Primary reference: Nextcloud Files
Patterns Davora should borrow directly:
- list-first browsing surface;
- breadcrumb navigation tied to the current folder;
- current-folder creation/upload affordances near the file list;
- contextual item actions/details rather than permanently expanded heavy controls;
- opening a file into a dedicated preview/open state instead of keeping preview equal in weight to the list.

### Supporting comparators
Patterns Davora should borrow carefully:
- keep file details/supporting metadata in a lighter side panel so the central browsing surface remains dominant;
- account switching should behave like a compact identity/control surface, not a separate settings maze;
- first-run onboarding should be a focused zero-state with a primary CTA and a simple form, not a generic settings screen.

## 4. Information architecture and layout hierarchy target
### Desktop / large screens
1. **App header**: product identity, online/offline badge, and one-click entry to account/settings actions without repeating account controls on every page.
2. **State banner**: loading/offline/stale/error/permission/reconnect messaging directly under the header.
3. **Zero state or workspace**:
   - **Zero state** when no accounts exist: a focused connect-account surface with one clear CTA.
   - **Workspace** when an account is active: dominant browsing plane plus right context rail.
4. **Primary file surface**: the dominant browsing plane; contains folder title, search, breadcrumbs, root/up orientation controls, current-folder actions, and file rows.
5. **Right context rail**: selected-item details plus contextual actions and lightweight operational support cards, including active-account support when useful.
6. **Preview layer**: opens above the workspace as a focused modal/full-screen experience.
7. **Mutation dialogs**: open above the workspace; never live permanently as inline destructive clutter.

### Mobile / narrow screens
1. Header with active-account context visible.
2. State banner.
3. Zero-state onboarding or file surface first.
4. Context support panels stacked underneath the file surface or as sheets.
5. Preview becomes a true full-screen layer.

## 5. Account UX target
- First run must show an explicit empty state with **Connect account** CTA.
- The connect-account form must collect:
  - base URL (scheme + domain);
  - username;
  - app password;
  - optional label.
- The active account must remain understandable while browsing, but repeated account/profile controls should stay behind one click when that keeps the file surface cleaner.
- Account switching must be explicit and feel safe: the user should always know which account they are viewing.
- Reconnect-required accounts must explain what happened and how to fix it.
- Remove-account actions must be explicit and must not look like sign-out from the whole app.
- Account UX should feel native to the shell, not bolted on as a hidden settings panel.

## 6. Preview behavior target
- Opening a file must feel like an intentional mode change.
- The preview should use a focused modal/full-screen overlay with:
  - clear file identity;
  - close/back affordance;
  - download affordance when available;
  - supporting metadata in a secondary panel/card;
  - the content stage visually dominant over metadata.
- Closing preview must return the user to the same browsing context and active account.
- Unsupported file types must degrade honestly inside the preview surface instead of collapsing the overall workspace.

## 7. Contextual action behavior target
- **Create folder** and **Upload file** belong to the current folder context near the file list header.
- **Rename/move**, **Copy**, and **Delete** belong to the current selection and should live in the context rail when an item is selected.
- File/folder rows must make **open** and **select for details/actions** unambiguous.
- The item name/open affordance should be the only navigation/open trigger, while a separate explicit control can select that row for context actions.
- Destructive actions must require focused confirmation in a dialog.
- Offline mode must disable mutations explicitly and visibly, not silently.

## 8. Spacing, visual hierarchy, and component principles
- The file list is the primary visual plane and must carry the strongest contrast and largest share of width.
- Account context should be present but secondary to browsing once an account is active.
- Secondary support surfaces must read quieter than the file list and must not duplicate existing navigation.
- Use consistent roomy spacing; prefer an 8/12/16/24 rhythm over cramped controls.
- Avoid stacked “box soup.” Top-level surfaces should be few, clear, and purposeful.
- Keep typography simple: small uppercase eyebrows for labels, strong section titles, muted supporting copy.
- Selection state must be obvious without becoming noisy.
- Search results should preserve folder context so matching items still feel grounded in the workspace.
- Recoverable failures should offer recovery actions where the failure is understood, not only in a distant status banner.

## 9. Mobile and responsive principles
- On narrow screens, do not force the user to scroll through support panels before they can browse files.
- Keep search, current-folder actions, and account context reachable without relying on hover.
- Collapse metadata grids into single-column cards.
- The preview should use full viewport height/width on mobile.
- Path/breadcrumb presentation may wrap, but the current location and active account must remain understandable.
- Mobile evidence must prove that browse-first priority remains intact, not just that the layout still renders.

## 10. Degraded, offline, and error-state presentation principles
- Never blank the entire app for a recoverable file/folder failure.
- Show state banners in a stable position so the user can diagnose status without losing context.
- Cached/stale data should remain viewable when available for the same account.
- When offline, communicate the split clearly: reads/previews from cache may work; writes do not.
- Permission errors should be distinct from generic unexpected failures.
- Reconnect-required account state should be distinct from ordinary offline mode.
- Recovery affordances must stay visible in the same workspace.

## 11. Explicit acceptance checklist for visual/UX quality
A pass is only acceptable if a human reviewer can say **yes** to all of these:
1. The file list is clearly the dominant surface on desktop when an account is active.
2. The active account is easy to identify without competing with the file surface.
3. The zero state clearly tells the user what to do first.
4. The connect-account form feels focused and trustworthy, not improvised.
5. Search, breadcrumbs, and current-folder actions feel grouped as one browsing system.
6. Search results still make file location/context understandable.
7. Selection-specific actions appear contextual rather than permanently occupying prime space.
8. Opening a file feels focused and intentional.
9. The preview header makes the opened file unmistakable.
10. The right context rail supports the main task instead of competing with it.
11. File rows make open vs details/actions clearly understandable.
12. Empty, degraded, reconnect, and permission states stay helpful and actionable inside the same layout.
13. Mobile preserves browse-first priority and usable preview/account behavior.
14. The result still preserves all required v1 capabilities for the active account.
15. Checked-in screenshots make the target and the shipped result understandable to a reviewer without running the app.

## 12. Non-goals and scope guardrails
This pass must **not** expand product scope beyond the account foundation and required file-manager behavior.

Explicit non-goals for this pass:
- no OAuth;
- no generic WebDAV account types beyond Nextcloud;
- no multi-user or sharing features;
- no favorites/recent/tags/deleted-files product views;
- no multi-select or bulk action system;
- no drag-and-drop move/upload requirement;
- no native-mobile app work;
- no full routing/history overhaul beyond the current single-page model.

## 13. Review artifacts required for signoff
- implementation aligned to this brief;
- refreshed screenshots in `docs/screenshots/`, including zero state, connected workspace, account switching/context, mutation state, reconnect/error state, and mobile evidence;
- updated `README.md`, `docs/UX_REVIEW.md`, `docs/TESTING.md`, and `docs/HANDOVER.md` when shipped behavior or review expectations changed;
- validation run covering typecheck, tests, build, and browser/e2e evidence;
- executed checklist evidence captured in `docs/UI_QUALITY_GATE.md` or the pass-specific UX review notes;
- updated handover/state/session documents referencing this brief.
