import { expect, test } from "@playwright/test";
import { connectAccount, createGate, openSettings } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("cache-first folder load shows cached data before background refresh completes", async ({ page }) => {
  await connectAccount(page, "Folder cache workspace");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  const folderRefresh = createGate();
  await page.route("**/api/files?path=", async (route) => {
    await folderRefresh.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [{ path: "Projects refreshed", name: "Projects refreshed", isFolder: true }]
        }
      })
    });
  });

  await page.reload();

  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.locator(".browse-status-note")).toHaveText("Showing cached folder for / in Folder cache workspace while checking for changes.");
  await expect(page.getByRole("button", { name: /Open folder Projects refreshed/i })).toHaveCount(0);

  folderRefresh.release();

  await expect(page.getByRole("button", { name: /Open folder Projects refreshed/i })).toBeVisible();
  await expect(page.locator(".browse-status-note")).toHaveText("Refreshed / in Folder cache workspace");
});

test("cache-first file open keeps cached preview until refreshed version is applied", async ({ page }) => {
  await connectAccount(page, "Preview cache workspace");
  await openSettings(page);
  const cacheSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  await cacheSettings.getByLabel(/Cached preview update check interval unit/i).selectOption("seconds");
  await cacheSettings.getByLabel(/Cached preview update check interval value/i).fill("1");
  await cacheSettings.getByLabel(/Cached preview update check interval value/i).press("Enter");
  await cacheSettings.getByRole("button", { name: /Close|Done/i }).click();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const initialPreview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(initialPreview.getByText(/normalized API/i)).toBeVisible();
  await initialPreview.getByRole("button", { name: /Back to files/i }).click();
  await expect(initialPreview).toHaveCount(0);

  await page.waitForTimeout(1_100);

  const previewRefresh = createGate();
  await page.route("**/api/file?path=Projects%2Froadmap.txt", async (route) => {
    await previewRefresh.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/roadmap.txt",
            name: "roadmap.txt",
            isFolder: false,
            size: 70,
            mimeType: "text/plain",
            viewer: "text",
            content: "fresh preview from network",
            encoding: "utf8",
            truncated: false,
            bytesRead: 26
          }
        }
      })
    });
  });

  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(preview.getByText(/normalized API/i)).toBeVisible();
  await expect(preview.getByRole("button", { name: /Apply refreshed version/i })).toHaveCount(0);

  previewRefresh.release();

  await expect(preview.getByText(/A fresher version is ready/i)).toBeVisible();
  await expect(preview.getByText(/normalized API/i)).toBeVisible();
  await expect(preview.getByText(/fresh preview from network/i)).toHaveCount(0);

  await preview.getByRole("button", { name: /Apply refreshed version/i }).click();
  await expect(preview.getByText(/fresh preview from network/i)).toBeVisible();
});

test("cached folders stay scoped to the active account when switching accounts", async ({ page }) => {
  await connectAccount(page, "Alpha workspace");
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("beta-user");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Beta workspace");
  await dialog.getByRole("button", { name: /Add account/i }).click();

  await expect(page.locator(".browse-status-note")).toHaveText("Viewing / in Beta workspace");

  await page.waitForFunction(() => {
    const rawState = localStorage.getItem("davora-account-state") ?? '{"accounts":[]}';
    const parsed = JSON.parse(rawState) as { accounts?: Array<{ account?: { cacheNamespace?: string } }> };
    return Array.isArray(parsed.accounts) && parsed.accounts.length === 2 && parsed.accounts.every((record) => record.account?.cacheNamespace);
  });

  const state = await page.evaluate(() => {
    const rawState = localStorage.getItem("davora-account-state") ?? '{"accounts":[]}';
    const parsed = JSON.parse(rawState) as { accounts: Array<{ account: { displayName: string; cacheNamespace: string } }> };
    return {
      alphaCacheNamespace: parsed.accounts.find((record) => record.account.displayName === "Alpha workspace")?.account.cacheNamespace,
      betaCacheNamespace: parsed.accounts.find((record) => record.account.displayName === "Beta workspace")?.account.cacheNamespace
    };
  });

  if (!state.alphaCacheNamespace || !state.betaCacheNamespace) {
    throw new Error("Expected cache namespaces for both accounts");
  }

  const refreshGates = [createGate(), createGate()];
  let rootRequestCount = 0;
  await page.route("**/api/files*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("path") !== "") {
      await route.continue();
      return;
    }

    const gate = refreshGates[Math.min(rootRequestCount, refreshGates.length - 1)]!;
    rootRequestCount += 1;
    await gate.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [{ path: "Projects", name: "Projects", isFolder: true }]
        }
      })
    });
  });

  await page.evaluate(({ alphaCacheNamespace, betaCacheNamespace }) => {
    const encodePart = (value: string) => `${value.length}:${value}`;
    const folderCacheKey = (cacheNamespace: string) =>
      `davora-cache:v2:folder:${encodePart(cacheNamespace)}${encodePart("")}`;
    localStorage.setItem(folderCacheKey(alphaCacheNamespace), JSON.stringify({
      cachedAt: "2026-05-21T12:00:00.000Z",
      value: [{ path: "Alpha cached", name: "Alpha cached", isFolder: true }]
    }));
    localStorage.setItem(folderCacheKey(betaCacheNamespace), JSON.stringify({
      cachedAt: "2026-05-21T12:05:00.000Z",
      value: [{ path: "Beta cached", name: "Beta cached", isFolder: true }]
    }));
    const keys = Object.keys(localStorage);
    if (!keys.includes(folderCacheKey(alphaCacheNamespace)) || !keys.includes(folderCacheKey(betaCacheNamespace))) {
      throw new Error("Expected v2 folder cache keys.");
    }
  }, state);

  await openSettings(page);
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = reopenedSettingsDialog.getByLabel("Active account");
  await activeAccountSelect.selectOption({ label: "Alpha workspace" });
  await reopenedSettingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Alpha cached/i })).toBeVisible();
  await expect(page.locator(".browse-status-note")).toHaveText("Showing cached folder for / in Alpha workspace while checking for changes.");
  await expect(page.getByRole("button", { name: /Open folder Beta cached/i })).toHaveCount(0);

  await openSettings(page);
  const betaSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const betaAccountSelect = betaSettingsDialog.getByLabel("Active account");
  await betaAccountSelect.selectOption({ label: "Beta workspace" });
  await betaSettingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Beta cached/i })).toBeVisible();
  await expect(page.locator(".browse-status-note")).toHaveText("Showing cached folder for / in Beta workspace while checking for changes.");
  await expect(page.getByRole("button", { name: /Open folder Alpha cached/i })).toHaveCount(0);

  for (const gate of refreshGates) {
    gate.release();
  }
});
