import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDirectory = path.resolve(__dirname, "../../../docs/screenshots");
const screenshotsEnabled = process.env.CAPTURE_SCREENSHOTS === "true";
const frozenNow = Date.now();

test.skip(!screenshotsEnabled, "Run this spec only when refreshing checked-in screenshot artifacts.");

test.beforeAll(() => {
  mkdirSync(screenshotDirectory, { recursive: true });
});

test.beforeEach(async ({ request, baseURL, page }, testInfo) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  await page.addInitScript((fixedNow) => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        super(...(args.length > 0 ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    Object.defineProperties(FrozenDate, {
      parse: { value: RealDate.parse },
      UTC: { value: RealDate.UTC }
    });
    globalThis.Date = FrozenDate as DateConstructor;
  }, frozenNow);

  if (testInfo.project.name === "desktop-chrome") {
    await page.setViewportSize({ width: 1440, height: 1600 });
  }
});

async function connectAccount(page: Page, label = "Workspace alpha", options: { waitForWorkspace?: boolean } = {}) {
  const { waitForWorkspace = true } = options;
  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /Connect account/i }).click();
  if (waitForWorkspace) {
    await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();
  }
}

async function saveScreenshot(page: Page, fileName: string) {
  const options = {
    path: path.join(screenshotDirectory, fileName),
    fullPage: true,
    animations: "disabled" as const,
    caret: "hide" as const
  };
  try {
    await page.screenshot(options);
  } catch {
    await page.waitForTimeout(250);
    await page.screenshot(options);
  }
}

test("captures the first-run zero state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await saveScreenshot(page, "davora-zero-state.png");
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

test("captures the browse preview workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview guide.pdf/i })).toBeVisible();
  await expect(page.getByTitle(/PDF preview guide.pdf/i)).toBeVisible();
  await saveScreenshot(page, "davora-browse-preview.png");
});

test("captures the focused preview overlay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview photo.png/i })).toBeVisible();
  await expect(page.locator("img.media-preview-image").or(page.getByText(/Image preview is unavailable right now/i))).toBeVisible();
  await saveScreenshot(page, "davora-focused-preview.png");
});

test("captures mutation controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Show details for roadmap.txt/i }).click();
  await expect(page.getByRole("complementary").getByRole("button", { name: /^Open$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mutation-controls.png");
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
  await expect(page.getByText(/Unable to load this folder\./i)).toBeVisible();
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

test("captures the mobile browse-first workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Show details for roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Details for roadmap.txt/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-browse.png");
});
