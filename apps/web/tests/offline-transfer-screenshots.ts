import { expect, test } from "@playwright/test";
import { createGate } from "./support/workspace";

import {
  connectScreenshotAccount as connectAccount,
  saveScreenshot,
  selectMobileFileListEntry,
  setupScreenshotSuite
} from "./support/screenshots";

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Run this spec only when refreshing checked-in screenshot artifacts.");
setupScreenshotSuite();

test("captures recursive offline sync management", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Offline sync workspace");
  await page.getByLabel(/Select Projects folder/i).check();
  await page.getByRole("button", { name: /^Keep offline$/i }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(confirmDialog.getByText(/Synced recursively/i)).toBeVisible();
  await expect(confirmDialog.getByText(/Kept-offline files are excluded from normal automatic cache eviction and remain until you remove them from this device/i)).toBeVisible();
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByRole("button", { name: /Remove offline copy for Projects from this device/i })).toBeVisible();
  await saveScreenshot(page, "davora-offline-sync-management.png");
});

test("captures explicit offline mode with a pruned local-only tree", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Explicit offline workspace");
  await selectMobileFileListEntry(page, /Open folder Projects/i);
  await page.getByRole("button", { name: /^Keep offline$/i }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close/i }).click();
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("button", { name: /^Go offline$/i }).click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Archive/i })).toHaveCount(0);
  await expect(page.getByText(/Only files stored on this device are shown/i)).toBeVisible();
  await saveScreenshot(page, "davora-mobile-explicit-offline-mode.png");
});

test("captures the cached-data notice above the mobile file list", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Cached notice workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const notice = page.locator(".state-banner-slot .banner-state");
  await expect(notice).toContainText(/cached data while offline/i);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-cached-notice.png");
});

test("captures background offline sync progress", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.addInitScript(() => {
    const sentinel = Object.assign(new EventTarget(), {
      released: false,
      async release() {
        if (sentinel.released) {
          return;
        }
        sentinel.released = true;
        sentinel.dispatchEvent(new Event("release"));
      }
    });
    Object.defineProperty(window, "__wakeLockRequests", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          (window as unknown as { __wakeLockRequests: number }).__wakeLockRequests += 1;
          return sentinel;
        }
      }
    });
  });
  let releaseDownload: ((body: string) => void) | undefined;
  await page.route("**/api/download?path=Projects%2Froadmap.txt", async (route) => {
    const body = await new Promise<string>((resolve) => {
      releaseDownload = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body
    });
  });

  await connectAccount(page, "Offline background workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("roadmap.txt")).toBeVisible();
  await expect(transferStatus.getByText(/Offline sync/i)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wakeLockRequests: number }).__wakeLockRequests)).toBeGreaterThan(0);
  await expect(page.locator(".wake-lock-status")).toHaveCount(0);
  await saveScreenshot(page, "davora-offline-sync-background.png");

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByText(/Active while media or transfers are running/i)).toBeVisible();
  await saveScreenshot(page, "davora-screen-wake-lock.png");
  await settingsDialog.getByRole("button", { name: /^Close$/i }).click();
  await expect(settingsDialog).toBeHidden();

  releaseDownload?.("offline roadmap");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wakeLockRequests: number }).__wakeLockRequests)).toBeGreaterThan(0);
});

test("captures recursive offline sync retry preserving folder scope", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  let badDownloadAttempts = 0;
  const retryResponse = createGate();
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Projects",
          items: [
            { path: "Projects/bad.pdf", name: "bad.pdf", isFolder: false, size: 10, mimeType: "application/pdf" },
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 10, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/download?path=Projects%2Fbad.pdf", async (route) => {
    badDownloadAttempts += 1;
    if (badDownloadAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "temporary_failure", message: "Failed to fetch" } })
      });
      return;
    }
    await retryResponse.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\nretry ok"
    });
  });
  await page.route("**/api/download?path=Projects%2Fgood.txt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "ok"
    });
  });

  try {
    await connectAccount(page, "Offline retry workspace");
    await page.getByRole("button", { name: /Open actions for Projects/i }).click();
    await page.getByRole("button", { name: /^Keep offline$/i }).click();
    const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
    await expect(confirmDialog.getByText("Projects")).toBeVisible();
    await expect(confirmDialog.getByText(/Synced recursively/i)).toBeVisible();
    await confirmDialog.getByRole("button", { name: /Start sync/i }).click();

    const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
    await expect(transferStatus.getByText("Projects/bad.pdf", { exact: true })).toBeVisible();
    await expect(transferStatus.getByRole("button", { name: /Retry failed sync/i })).toBeVisible();
    await transferStatus.getByRole("button", { name: /Retry failed sync/i }).click();

    await expect.poll(() => badDownloadAttempts).toBe(2);
    await expect(confirmDialog).toHaveCount(0);
    await expect(transferStatus.locator(".transfer-tray-item")).toHaveCount(1);
    const retryingTransfer = transferStatus.locator(".transfer-tray-item-transferring");
    await expect(retryingTransfer).toHaveCount(1);
    await expect(retryingTransfer.getByText("Projects", { exact: true })).toBeVisible();
    await expect(transferStatus.getByRole("list", { name: /Failed files for Projects/i })).toHaveCount(0);
    await expect(transferStatus.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
    await expect(transferStatus.getByRole("button", { name: /Retry failed sync/i })).toHaveCount(0);
    await saveScreenshot(page, "davora-offline-sync-retry-folder.png");

    retryResponse.release();
    await expect(transferStatus.locator(".transfer-tray-item-done")).toHaveCount(1);
    await expect(transferStatus.locator(".transfer-tray-item")).toHaveCount(1);
    await expect(page.getByLabel("Projects is available offline")).toBeVisible();
    expect(badDownloadAttempts).toBe(2);
  } finally {
    retryResponse.release();
  }
});

test("captures a mobile partial transfer with failed child path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Projects",
          items: [
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 12, mimeType: "text/plain" },
            { path: "Projects/bad%file.txt", name: "bad%file.txt", isFolder: false, size: 8, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/download?path=Projects%2Fbad%25file.txt", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ data: { code: "invalid_path", message: "Path contains invalid percent-encoding." } })
    });
  });
  await page.route("**/api/download?path=Projects%2Fgood.txt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "ok"
    });
  });
  await connectAccount(page, "Workspace alpha");
  const projectsOpenButton = page.getByRole("button", { name: /Open folder Projects/i });
  const projectsOpenButtonHandle = await projectsOpenButton.elementHandle();
  expect(projectsOpenButtonHandle).not.toBeNull();
  await projectsOpenButtonHandle!.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await projectsOpenButtonHandle!.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.getByRole("toolbar", { name: /Selection actions/i }).getByRole("button", { name: /^Download$/i }).click();
  await page.getByRole("button", { name: /^Transfers$/i }).click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("projects.zip")).toBeVisible();
  await expect(transferStatus.getByText("Partial")).toBeVisible();
  await expect(transferStatus.getByText(/Downloaded 1 of 2 files; 1 failed/i)).toBeVisible();
  await expect(transferStatus.getByText("Projects/bad%file.txt")).toBeVisible();
  await saveScreenshot(page, "davora-mobile-partial-transfer.png");
});
