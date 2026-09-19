# ADR 004: Folder home-screen shortcuts use account-aware deep links; experimental folder apps use a dynamic blob manifest

## Status
Accepted

## Context
PER-56 asks for one-tap access to frequently used folders from the Android home screen. Two platform paths exist:

- Chrome's "Add to Home screen" for a non-installable or already-installed site creates a **URL shortcut** — it needs a stable link that restores both the folder and the owning account.
- A real per-folder **app entry** needs a distinct web app identity (`id`) and `start_url`, which a single static `/manifest.webmanifest` cannot express.

The existing URL format already synchronizes `?path=`; the `?account=` parameter was written but never consumed, so a link opened under a different active account silently loaded the path in the wrong workspace.

## Decision
- Folder deep links carry `?path=<folder>&account=<account id>` and nothing else — no credentials, session tokens, or public share links.
- On load, `?account=` selects the preferred active account during registry decode. When the linked account is unknown or unavailable, the folder path is suppressed, the workspace stays at root, and a "linked account is unavailable" status is announced.
- The manual flow is the default: a "Folder shortcut" item action (folders only) opens a dialog whose copyable link is the deep link. The user adds it to the home screen through the browser menu.
- An experimental "Shortcut as app" path sits behind `experimentalFolderAppShortcutsEnabled` (off by default). It claims the single captured `beforeinstallprompt` event via an explicit owner (`"app"` vs `"folder-shortcut"`), temporarily points `document`'s `<link rel="manifest">` at a blob-hosted manifest whose `id`/`start_url` is the folder deep link, prompts, then restores the static manifest link and revokes the object URL — on outcome, dismissal, or unmount.
- Manifest `scope`, `start_url`, `id`, and icon `src` values are absolute URLs: relative references cannot resolve inside a `blob:` manifest (verified by real-Chromium `Page.getAppManifest` errors).

## Consequences
- Folder shortcuts work on stock Android Chrome without any install-prompt support: the copied link plus "Add to Home screen" always succeeds.
- Only one install capture exists per page; the folder flow must claim it and always release it, so the ordinary app install affordance keeps ownership when the folder flow is not active.
- The blob manifest is attached only for the duration of the install prompt; the static PWA manifest remains the ambient install identity.
- The experimental path remains a no-op while the setting is disabled.
- A StrictMode replay of the account-reset mount effect no longer counts as an account switch; the first-mount deep-link restore is not wiped by the replayed `switch-clear`.
