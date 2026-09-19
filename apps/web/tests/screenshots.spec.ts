import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

// Keep the historical entrypoint stable while ownership lives in the
// surface-specific screenshot authorities.
import "./accounts-settings-screenshots";
import "./browsing-navigation-screenshots";
import "./offline-transfer-screenshots";
import "./operations-dialog-screenshots";
import "./preview-media-screenshots";

const screenshotsTestDirectory = path.dirname(fileURLToPath(import.meta.url));
const surfaceModules = [
  "accounts-settings-screenshots.ts",
  "browsing-navigation-screenshots.ts",
  "offline-transfer-screenshots.ts",
  "operations-dialog-screenshots.ts",
  "preview-media-screenshots.ts"
] as const;
const movedSources = surfaceModules.map((moduleName) => ({
  moduleName,
  source: readFileSync(path.resolve(screenshotsTestDirectory, moduleName), "utf8")
}));
const movedSource = movedSources.map(({ source }) => source).join("\n");
const movedTitles = [
  "captures the first-run zero state",
  "captures account-root connection defaults",
  "captures the connected account workspace",
  "captures the PER-71 desktop browser in light and dark themes",
  "captures the PER-71 mobile browser, drawer, and selection in both themes",
  "captures PER-72 image, PDF, video, and folder audio surfaces in both themes",
  "captures account switching context",
  "captures the profile and settings dialog",
  "captures the compact settings theme selector in light and dark modes",
  "captures PER-73 mobile forms, sheets, confirmations, and status panels in both themes",
  "captures the PER-74 responsive browser and loading-empty state matrix in both themes",
  "captures recursive offline sync management",
  "captures explicit offline mode with a pruned local-only tree",
  "captures the cached-data notice above the mobile file list",
  "captures background offline sync progress",
  "captures recursive offline sync retry preserving folder scope",
  "captures unlock-required account state",
  "captures error state",
  "captures reconnect-required account state",
  "captures the mobile browse-first workspace",
  "captures the mobile sticky toolbar after list scroll",
  "captures the mobile details sheet",
  "captures the mobile delete confirmation without typed-name gate",
  "captures the mobile navigation drawer",
  "captures mobile favourites quick access in the navigation drawer",
  "captures the mobile profile settings sheet without background bleed",
  "captures the mobile pull-to-refresh gesture indicator",
  "captures a mobile partial transfer with failed child path",
  "captures the mobile focused image preview"
] as const;

test("screenshot ownership keeps all root scenarios in the surface authority", () => {
  expect(readFileSync(path.resolve(screenshotsTestDirectory, "screenshots.spec.ts"), "utf8"))
    .not.toMatch(/test\("captures/u);
  for (const title of movedTitles) {
    expect(movedSources.reduce((count, { source }) => count + source.split(`test("${title}"`).length - 1, 0), title).toBe(1);
  }
  for (const { moduleName, source } of movedSources) {
    expect(source.split(/\r?\n/u).length, `${moduleName} size`).toBeLessThanOrEqual(350);
  }
  for (const artifact of [
    "davora-zero-state.png", "davora-account-root-default.png", "davora-connected-workspace.png", "davora-account-switcher.png",
    "davora-settings-dialog.png", "davora-settings-theme-light.png", "davora-settings-theme-dark.png", "davora-unlock-screen.png",
    "davora-error-state.png", "davora-reconnect-state.png", "davora-offline-sync-management.png", "davora-mobile-explicit-offline-mode.png",
    "davora-mobile-cached-notice.png",
    "davora-offline-sync-background.png", "davora-screen-wake-lock.png", "davora-offline-sync-retry-folder.png", "davora-mobile-partial-transfer.png",
    "davora-mobile-focused-preview.png", "davora-mobile-details-sheet.png", "davora-mobile-delete-confirmation.png", "davora-mobile-navigation.png",
    "davora-mobile-favourites.png", "davora-mobile-settings-dialog.png", "davora-mobile-pull-refresh-gesture.png", "davora-mobile-browse.png",
    "davora-mobile-sticky-toolbar.png", "davora-mobile-search-expanded.png", "davora-mobile-row-selection-toggle.png", "davora-mobile-selection-actions.png",
    "davora-media-image-", "davora-media-pdf-", "davora-media-video-", "davora-media-audio-folder-", "davora-browser-desktop-",
    "davora-browser-mobile-", "davora-browser-selection-mobile-", "davora-browser-drawer-mobile-", "davora-qa-browser-", "davora-qa-loading-",
    "davora-qa-empty-", "davora-dialog-connect-mobile-", "davora-dialog-actions-mobile-", "davora-dialog-details-mobile-", "davora-dialog-destination-mobile-",
    "davora-dialog-delete-mobile-", "davora-dialog-keep-offline-mobile-", "davora-dialog-settings-mobile-", "davora-dialog-transfer-mobile-"
  ]) {
    expect(movedSource, artifact).toContain(artifact);
  }
});
