import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const screenshotDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/screenshots");
const frozenNow = Date.now();

export function setupScreenshotSuite(): void {
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
}

export async function connectScreenshotAccount(page: Page, label = "Workspace alpha", options: { waitForWorkspace?: boolean } = {}): Promise<void> {
  const { waitForWorkspace = true } = options;
  await page.goto("/");
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /Connect account/i }).click();
  if (waitForWorkspace) await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
}

export async function setThemeMode(page: Page, mode: "Light" | "Dark"): Promise<void> {
  const settingsButtons = page.getByRole("button", { name: /Profile & settings/i });
  let opened = false;
  for (let index = 0; index < await settingsButtons.count(); index += 1) {
    if (await settingsButtons.nth(index).isVisible()) {
      await settingsButtons.nth(index).click();
      opened = true;
      break;
    }
  }
  if (!opened) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Profile & settings/i }).click();
  }
  const dialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await dialog.getByRole("group", { name: /Theme/i }).getByRole("button", { name: mode }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode.toLowerCase());
  await dialog.getByRole("button", { name: /^(Close|Done)$/i }).click();
}

export async function saveScreenshot(page: Page, fileName: string): Promise<void> {
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

export async function saveViewportScreenshot(page: Page, fileName: string): Promise<void> {
  await page.screenshot({
    path: path.join(screenshotDirectory, fileName),
    fullPage: false,
    animations: "disabled",
    caret: "hide"
  });
}

export async function selectMobileFileListEntry(page: Page, openButtonName: RegExp): Promise<void> {
  const openButton = page.getByRole("button", { name: openButtonName });
  const handle = await openButton.elementHandle();
  expect(handle).not.toBeNull();
  await handle!.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await handle!.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
}
