import { expect, test } from "@playwright/test";

import { connectScreenshotAccount as connectAccount, saveScreenshot, saveViewportScreenshot, selectMobileFileListEntry, setThemeMode, setupScreenshotSuite } from "./support/screenshots";

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Run this spec only when refreshing checked-in screenshot artifacts.");
setupScreenshotSuite();

test("captures the first-run zero state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await saveScreenshot(page, "davora-zero-state.png");
});

test("captures account-root connection defaults", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  await expect(page.getByRole("heading", { name: /Connect Nextcloud account/i })).toBeVisible();
  await expect(page.getByLabel("Root folder")).toHaveValue("");
  await expect(page.getByLabel("Root folder")).toHaveAttribute("placeholder", "Account root (/)");
  await saveScreenshot(page, "davora-account-root-default.png");
});

test("captures the connected account workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await saveScreenshot(page, "davora-connected-workspace.png");
});

test("captures account switching context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("workspace-beta");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Workspace beta");
  await dialog.getByRole("button", { name: /Add account/i }).click();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await reopenedSettingsDialog.getByLabel("Active account").selectOption({ label: "Workspace beta" });
  await expect(reopenedSettingsDialog.getByLabel("Active account")).toHaveValue(/.+/);
  await saveScreenshot(page, "davora-account-switcher.png");
});

test("captures the profile and settings dialog", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  await expect(page.getByRole("dialog", { name: /Profile and settings/i })).toBeVisible();
  await saveScreenshot(page, "davora-settings-dialog.png");
});

test("captures the compact settings theme selector in light and dark modes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Theme gallery workspace");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const themeGroup = settingsDialog.getByRole("group", { name: /Theme/i });
  await themeGroup.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(settingsDialog.getByRole("group", { name: /Theme/i })).toBeVisible();
  await saveScreenshot(page, "davora-settings-theme-light.png");
  await themeGroup.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await saveScreenshot(page, "davora-settings-theme-dark.png");
});

test("captures PER-73 mobile forms, sheets, confirmations, and status panels in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile PER-73 evidence only.");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 640 });
  const longFileName = "Документи-and-a-very-long-action-target-name-100%.txt";
  const longPath = `Projects/${longFileName}`;
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/Архів 100%", name: "Архів 100%", isFolder: true, lastModified: "2026-07-14T10:00:00.000Z" },
            { path: longPath, name: longFileName, isFolder: false, size: 1048576, mimeType: "text/plain", lastModified: "2026-07-14T10:00:00.000Z" }
          ]
        }
      })
    });
  });
  await page.route("**/api/files?path=Projects%2F*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { path: "Projects/Архів 100%", items: [] } })
    });
  });
  await page.route(`**/api/download?path=${encodeURIComponent(longPath)}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/plain", body: "PER-73 offline proof" });
  });

  for (const mode of ["light", "dark"] as const) {
    await page.goto("/");
    await page.evaluate((themeMode) => {
      localStorage.setItem("davora-ui-settings", JSON.stringify({ themeMode }));
    }, mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await page.getByRole("button", { name: /^Connect account$/i }).click();
    await expect(page.getByText(/^Nextcloud$/i)).toBeVisible();
    await expect(page.getByLabel("Root folder")).toHaveValue("");
    await saveViewportScreenshot(page, `davora-dialog-connect-mobile-${mode}.png`);
  }

  await connectAccount(page, "PER-73 evidence workspace");
  for (const mode of ["Light", "Dark"] as const) {
    const suffix = mode.toLowerCase();
    await setThemeMode(page, mode);
    const homeButton = page.getByRole("button", { name: /Go to home folder/i });
    if (await homeButton.isVisible().catch(() => false)) {
      await homeButton.click();
    }
    await page.getByRole("button", { name: /Open folder Projects/i }).click();
    await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
    const sheet = page.getByRole("region", { name: `Details for ${longFileName}` });
    const ensureSheetVisible = async () => {
      if (await sheet.isVisible().catch(() => false)) {
        return;
      }
      const closeActions = page.getByRole("button", { name: `Close actions for ${longFileName}` });
      if (await closeActions.isVisible().catch(() => false)) {
        await closeActions.click();
      }
      if (!await sheet.isVisible().catch(() => false)) {
        await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
      }
      await expect(sheet).toBeVisible();
    };
    await saveViewportScreenshot(page, `davora-dialog-actions-mobile-${suffix}.png`);

    await sheet.getByRole("button", { name: /View details/i }).click();
    await expect(sheet).toHaveClass(/details-panel-sheet-details-open/);
    await saveViewportScreenshot(page, `davora-dialog-details-mobile-${suffix}.png`);
    await sheet.getByRole("button", { name: /Back to actions/i }).click();

    await sheet.getByRole("button", { name: /Copy or move/i }).click();
    const destinationDialog = page.getByRole("dialog", { name: /Copy or move item/i });
    await destinationDialog.getByRole("button", { name: /Open destination folder Архів 100%/i }).click();
    await expect(destinationDialog.getByRole("button", { name: /^Copy here$/i })).toBeVisible();
    await expect(destinationDialog.getByRole("button", { name: /^Move here$/i })).toBeVisible();
    await saveViewportScreenshot(page, `davora-dialog-destination-mobile-${suffix}.png`);
    await destinationDialog.getByRole("button", { name: /^Cancel$/i }).click();
    await ensureSheetVisible();

    await sheet.getByRole("button", { name: /^Delete$/i }).click();
    const deleteDialog = page.getByRole("dialog", { name: /Delete item/i });
    await expect(deleteDialog.getByRole("textbox")).toHaveCount(0);
    await saveViewportScreenshot(page, `davora-dialog-delete-mobile-${suffix}.png`);
    await deleteDialog.getByRole("button", { name: /^Cancel$/i }).click();
    await ensureSheetVisible();

    await sheet.getByRole("button", { name: /^Keep offline$/i }).click();
    const offlineDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
    await expect(offlineDialog.getByRole("button", { name: /^Start sync$/i })).toBeVisible();
    await saveViewportScreenshot(page, `davora-dialog-keep-offline-mobile-${suffix}.png`);
    await offlineDialog.getByRole("button", { name: /^Cancel$/i }).click();
    await ensureSheetVisible();
    await sheet.getByRole("button", { name: /Close item actions/i }).click();

    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByRole("button", { name: /Profile & settings/i }).click();
    const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
    await expect(settingsDialog.getByRole("group", { name: /Theme/i })).toBeVisible();
    await saveViewportScreenshot(page, `davora-dialog-settings-mobile-${suffix}.png`);
    await settingsDialog.getByRole("button", { name: /^Done$/i }).click();

    const goHomeButton = page.getByRole("button", { name: /Go to home folder/i });
    if (await goHomeButton.isVisible().catch(() => false)) {
      await goHomeButton.click();
    } else {
      const goUpButton = page.getByRole("button", { name: /Go up one folder level/i });
      if (await goUpButton.isVisible().catch(() => false)) {
        await goUpButton.click();
      }
    }
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await selectMobileFileListEntry(page, /Open folder Projects/i);
    await page.getByRole("toolbar", { name: /Selection actions/i }).getByRole("button", { name: /^Keep offline$/i }).click();
    const selectionOfflineDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
    await selectionOfflineDialog.getByRole("button", { name: /^Start sync$/i }).click();
    const transferDialog = page.getByRole("dialog", { name: /Transfer status/i });
    await expect(transferDialog.getByText(/^Done/)).toBeVisible();
    await saveViewportScreenshot(page, `davora-dialog-transfer-mobile-${suffix}.png`);
    await transferDialog.getByRole("button", { name: /Close transfer status/i }).click();
    const clearSelection = page.getByRole("toolbar", { name: /Selection actions/i }).getByRole("button", { name: /^Clear$/i });
    if (await clearSelection.isVisible().catch(() => false)) {
      await clearSelection.click();
    }
    if (suffix === "light") {
      await page.getByRole("button", { name: /Open navigation menu/i }).click();
      await page.getByRole("button", { name: /Profile & settings/i }).click();
      const cleanupDialog = page.getByRole("dialog", { name: /Profile and settings/i });
      await cleanupDialog.getByRole("button", { name: /Remove offline copy for Projects from this device/i }).click();
      await cleanupDialog.getByRole("button", { name: /^Done$/i }).click();
    }
  }
});

test("captures unlock-required account state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          app: "davora",
          configLoaded: true,
          backend: "mock",
          rootPath: ".davora-agent-test",
          unlockRequired: true,
          connectionMode: "in_app",
          supportedAccountTypes: ["nextcloud"]
        }
      })
    });
  });
  await connectAccount(page, "Workspace alpha", { waitForWorkspace: false });
  await expect(page.getByRole("heading", { name: /Unlock required/i })).toBeVisible();
  await saveScreenshot(page, "davora-unlock-screen.png");
});

test("captures error state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.route("**/api/files?path=", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          code: "unexpected_error",
          message: "Unable to load folder."
        }
      })
    });
  });
  await connectAccount(page, "Workspace alpha", { waitForWorkspace: false });
  await expect(page.getByText(/Couldn't load this folder\. Its contents are unknown/i)).toBeVisible();
  await saveScreenshot(page, "davora-error-state.png");
});

test("captures reconnect-required account state", async ({ page, request, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: /Reconnect Workspace alpha/i })).toBeVisible();
  await saveScreenshot(page, "davora-reconnect-state.png");
});

test("captures the mobile profile settings sheet without background bleed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Mobile settings workspace");
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /Done/i })).toBeVisible();
  const dialogBox = await settingsDialog.boundingBox();
  expect(dialogBox?.y ?? 999).toBeLessThanOrEqual(1);
  await saveScreenshot(page, "davora-mobile-settings-dialog.png");
});
