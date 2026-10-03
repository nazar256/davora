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
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
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

async function selectMobileFileListEntry(page: Page, openButtonName: RegExp) {
  const openButton = page.getByRole("button", { name: openButtonName });
  const handle = await openButton.elementHandle();
  expect(handle).not.toBeNull();
  await handle!.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await handle!.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
}

test("captures mutation controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await expect(page.getByRole("complementary").getByRole("button", { name: /^Open$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mutation-controls.png");
});

test("captures mobile folder destination picker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Destination picker workspace");
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Projects",
          items: [
            { path: "Projects/Документи 100%", name: "Документи 100%", isFolder: true, lastModified: new Date().toISOString() },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", lastModified: new Date().toISOString() }
          ]
        }
      })
    });
  });
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: "Open actions for roadmap.txt" }).click();
  await page.getByRole("button", { name: /Copy or move/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(dialog.getByRole("button", { name: /Open destination folder Документи 100%/i })).toBeVisible();
  await dialog.getByRole("button", { name: /Open destination folder Документи 100%/i }).click();
  await expect(dialog.getByLabel("Destination name")).toHaveValue("roadmap.txt");
  await expect(dialog.getByLabel("Copy destination path")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Copy here/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Move here/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-destination-picker.png");
});

test("captures compact PER-68 destination picker at small mobile height", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await page.setViewportSize({ width: 360, height: 640 });
  const longFileName = "Документи-and-a-very-long-copy-move-target-name-100%.txt";
  await connectAccount(page, "PER-68 evidence workspace");
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "Projects",
          items: [
            { path: "Projects/Архів 100% довга назва", name: "Архів 100% довга назва", isFolder: true },
            { path: `Projects/${longFileName}`, name: longFileName, isFolder: false, size: 1048576, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/files?path=Projects%2F*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { completeness: "complete", path: "Projects/Архів 100% довга назва", items: [] } })
    });
  });
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  await page.getByRole("button", { name: /Copy or move/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await dialog.getByRole("button", { name: /Open destination folder Архів 100% довга назва/i }).click();
  await expect(dialog.locator(".destination-resolved")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Refresh destination folders/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Manual path$/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Cancel$/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Move here$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-compact-destination-picker.png");
});

test("captures PER-84 mobile multi-item copy or move action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "PER-84 proof is mobile-specific.");
  await page.setViewportSize({ width: 360, height: 640 });
  await connectAccount(page, "PER-84 proof workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();
  await selectMobileFileListEntry(page, /Open folder Projects/i);
  await page.getByRole("checkbox", { name: /Select alpha.txt file/i }).click();

  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: /^Copy or move selected$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-batch-copy-move.png");
});
