import { expect, test, type Page } from "@playwright/test";
// The approved public import boundary retains createGate for ownership parity; selected tests do not call it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { connectAccount, createGate, openSettings, selectFileListEntry } from "./support/workspace";


async function expectNoEnabledButton(page: Page, name: RegExp): Promise<void> {
  await expect.poll(async () => page.getByRole("button", { name }).evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled))).toBe(true);
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("offline mode keeps account-scoped cached content visible and disables mutations", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await connectAccount(page, "Offline workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Back to files/i }).click();

  await context.setOffline(true);
  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await expect(page.getByText(/Showing cached data while offline/i)).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.locator(".browse-status-note")).toHaveText(/Offline snapshot/i);
  await expectNoEnabledButton(page, /Create folder/i);
});

test("active background sync holds one screen wake lock and releases it on desktop and mobile", async ({ page }) => {
  await page.addInitScript(() => {
    const sentinel = Object.assign(new EventTarget(), {
      released: false,
      async release() {
        if (sentinel.released) {
          return;
        }
        sentinel.released = true;
        (window as Window & { __davoraWakeLockReleases?: number }).__davoraWakeLockReleases = 1;
        sentinel.dispatchEvent(new Event("release"));
      }
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        async request(type: string) {
          const state = window as Window & { __davoraWakeLockRequests?: string[] };
          state.__davoraWakeLockRequests = [...(state.__davoraWakeLockRequests ?? []), type];
          return sentinel;
        }
      }
    });
  });

  let releaseDownload!: (body: string) => void;
  const downloadResponse = new Promise<string>((resolve) => {
    releaseDownload = resolve;
  });
  let resolveDownloadStarted!: () => void;
  const downloadStarted = new Promise<void>((resolve) => {
    resolveDownloadStarted = resolve;
  });
  await page.route("**/api/download?path=Projects%2Froadmap.txt", async (route) => {
    resolveDownloadStarted();
    const body = await downloadResponse;
    await route.fulfill({ status: 200, contentType: "text/plain", body });
  });

  await connectAccount(page, "Wake lock browser workspace");
  expect(await page.evaluate(() => typeof (navigator as Navigator & { wakeLock?: { request?: unknown } }).wakeLock?.request)).toBe("function");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();

  await expect.poll(() => page.evaluate(() => (window as Window & { __davoraWakeLockRequests?: string[] }).__davoraWakeLockRequests)).toEqual(["screen"]);

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settings.getByText("Active while media or transfers are running.")).toBeVisible();
  await settings.getByRole("button", { name: /Close|Done/i }).click();

  await downloadStarted;
  releaseDownload("offline roadmap");

  await expect.poll(() => page.evaluate(() => (window as Window & { __davoraWakeLockReleases?: number }).__davoraWakeLockReleases ?? 0)).toBe(1);

  await openSettings(page);
  await expect(settings.getByText("Ready for media playback and transfers.")).toBeVisible();
});

test("offline sync partial failure retries the existing transfer to completion", async ({ page }) => {
  let badDownloadAttempts = 0;
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
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\nretry ok" });
  });
  await page.route("**/api/download?path=Projects%2Fgood.txt", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });

  await connectAccount(page, "Offline retry execution workspace");
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  const initialDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(initialDialog.getByText(/Synced recursively/i)).toBeVisible();
  await initialDialog.getByRole("button", { name: /Start sync/i }).click();

  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  const partialTransfer = transferStatus.locator(".transfer-tray-item-partial");
  await expect(partialTransfer).toHaveCount(1);
  await expect(partialTransfer.getByText(/^Partial/)).toBeVisible();
  await expect(partialTransfer.getByText("1 file failed to sync.")).toBeVisible();
  const failedFiles = partialTransfer.getByRole("list", { name: /Failed files for Projects/i });
  await expect(failedFiles.getByText("Projects/bad.pdf", { exact: true })).toBeVisible();
  await expect(failedFiles.getByText("Failed to fetch", { exact: true })).toBeVisible();
  await partialTransfer.getByRole("button", { name: /Retry failed sync/i }).click();

  const retryDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(retryDialog).toHaveCount(0);

  await expect.poll(() => badDownloadAttempts).toBe(2);
  await expect(transferStatus.locator(".transfer-tray-item")).toHaveCount(1);
  const completedTransfer = transferStatus.locator(".transfer-tray-item-done");
  await expect(completedTransfer).toHaveCount(1);
  await expect(completedTransfer.getByText("Projects", { exact: true })).toBeVisible();
  await expect(completedTransfer.getByText(/^Done/)).toBeVisible();
  await expect(partialTransfer).toHaveCount(0);
  await expect(transferStatus.getByRole("list", { name: /Failed files for Projects/i })).toHaveCount(0);
  await expect(transferStatus.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
  await expect(transferStatus.getByRole("button", { name: /Retry failed sync/i })).toHaveCount(0);
  await expect(page.getByLabel("Projects is available offline")).toBeVisible();
});

test("keep offline can start while the estimate is still calculating and reuses that enumeration", async ({ page }) => {
  let releaseListing!: () => void;
  const listingGate = new Promise<void>((resolve) => {
    releaseListing = resolve;
  });
  let projectsListingRequests = 0;
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => {
    projectsListingRequests += 1;
    await listingGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Projects",
          items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 10, mimeType: "text/plain" }]
        }
      })
    });
  });

  await connectAccount(page, "Early sync start workspace");
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();

  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(confirmDialog.getByText("Calculating…", { exact: true })).toHaveCount(2);
  const startButton = confirmDialog.getByRole("button", { name: /^Start sync$/i });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(confirmDialog).toBeHidden();

  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("Projects", { exact: true })).toBeVisible();

  releaseListing();
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  expect(projectsListingRequests).toBe(1);
});

test("retained roots preserve shared files when one root is removed and ordinary cache is cleared", async ({ page }) => {
  await connectAccount(page, "Overlapping retained roots workspace");

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close transfer status/i }).click();

  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible().catch(() => false)) {
    await closeItemActions.click();
  }
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close transfer status/i }).click();

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const cachePanel = settingsDialog.locator(".cache-panel");
  const offlineRoots = cachePanel.locator(".offline-files-item");
  await expect(offlineRoots).toHaveCount(2);
  await expect(cachePanel.getByRole("button", { name: /Remove offline copy for Projects from this device/i })).toBeVisible();
  await expect(cachePanel.getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeVisible();

  const localMutationMethods: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      localMutationMethods.push(request.method());
    }
  });

  await cachePanel.getByRole("button", { name: /Remove offline copy for Projects from this device/i }).click();
  await expect(offlineRoots).toHaveCount(1);
  await expect(offlineRoots).toContainText("roadmap.txt");
  await expect(cachePanel.getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeVisible();
  await settingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByLabel("roadmap.txt is available offline")).toBeVisible();

  await openSettings(page);
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const reopenedCachePanel = reopenedSettingsDialog.locator(".cache-panel");
  await reopenedCachePanel.getByRole("button", { name: /^Clear cache$/i }).click();
  await expect(page.locator(".browse-status-note")).toHaveText(/Offline cache cleared/i);
  await expect(reopenedCachePanel.locator(".offline-files-item")).toHaveCount(1);
  await expect(reopenedCachePanel.locator(".offline-files-item")).toContainText("roadmap.txt");
  await reopenedSettingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByLabel("roadmap.txt is available offline")).toBeVisible();
  expect(localMutationMethods).not.toContain("DELETE");
});

test("explicit offline mode persists, prunes navigation, opens local files, and makes zero API requests after reload", async ({ page }) => {
  await connectAccount(page, "Explicit offline workspace");
  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);
  await page.getByRole("button", { name: /^Keep offline$/i }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close/i }).click();

  const navigationMenu = page.getByLabel("Navigation menu", { exact: true });
  const ensureNavigationMenuOpen = async () => {
    if (!await navigationMenu.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Open navigation menu/i }).click();
    }
    await expect(navigationMenu).toBeVisible();
  };

  await ensureNavigationMenuOpen();
  await page.getByRole("button", { name: /^Go offline$/i }).click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Archive/i })).toHaveCount(0);
  await ensureNavigationMenuOpen();
  await expect(navigationMenu.getByRole("button", { name: /Create folder/i })).toBeDisabled();
  await navigationMenu.getByRole("button", { name: /Close navigation menu/i }).click();

  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });

  await page.reload();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("browser offline recovers after reconnect while explicit offline mode remains dominant", async ({ page, context }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });

  await connectAccount(page, "Connectivity recovery workspace");
  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);
  await page.getByRole("button", { name: /^Keep offline$/i }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close/i }).click();

  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible().catch(() => false)) {
    await closeItemActions.click();
  }
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await expect(page.getByText(/Showing cached data while offline/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  const recoveryRequestStart = apiRequests.length;
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await expect.poll(() => apiRequests.slice(recoveryRequestStart).some((url) => url.includes("/api/files?path=Projects"))).toBe(true);
  await expect(page.getByText(/Showing cached data while offline/i)).toHaveCount(0);

  const navigationMenu = page.getByLabel("Navigation menu", { exact: true });
  if (!await navigationMenu.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
  }
  await expect(navigationMenu).toBeVisible();
  await navigationMenu.getByRole("button", { name: /^Go offline$/i }).click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();

  const explicitOfflineRequestCount = apiRequests.length;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  expect(apiRequests.length).toBe(explicitOfflineRequestCount);
});
