import { expect, test } from "@playwright/test";
import { connectAccount, openSettings } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("theme preference persists across startup and remains usable on desktop and mobile", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ themeMode: "dark" }));
  });
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#07101f");

  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("theme-test");
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill("Theme test");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  const settingsButton = page.getByRole("button", { name: /Profile & settings/i });
  const clickVisibleSettingsButton = async () => {
    for (let index = 0; index < await settingsButton.count(); index += 1) {
      if (await settingsButton.nth(index).isVisible()) {
        await settingsButton.nth(index).click();
        return true;
      }
    }
    return false;
  };
  if (!await clickVisibleSettingsButton()) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    expect(await clickVisibleSettingsButton()).toBe(true);
  }

  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const themeGroup = settingsDialog.getByRole("group", { name: /Theme/i });
  await expect(themeGroup.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await themeGroup.getByRole("button", { name: "System" }).focus();
  await page.keyboard.press("Tab");
  await expect(themeGroup.getByRole("button", { name: "Light" })).toBeFocused();
  expect(await themeGroup.getByRole("button", { name: "Light" }).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await themeGroup.getByRole("button", { name: "System" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#07101f");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f9fd");

  await themeGroup.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f9fd");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("profile and settings groups account, cache, and file-size controls", async ({ page }, testInfo) => {
  await connectAccount(page, "Settings workspace");
  await openSettings(page);

  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByText(/settings-workspace/i)).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: /Offline cache/i })).toBeVisible();
  await expect(settingsDialog.locator(".cache-summary")).toContainText(/cached file/i);
  if (testInfo.project.name === "desktop-chrome") {
    await page.getByLabel("File size display in file list").selectOption("mb");
    await expect(page.locator(".browse-status-note")).toHaveText(/File sizes now use MB/i);
  }
  await expect(settingsDialog.getByLabel("File size display")).toHaveCount(0);
  await expect(settingsDialog.getByText(new RegExp(`Current mode for cache-related sizes: ${testInfo.project.name === "desktop-chrome" ? "MB" : "Human readable"}`, "i"))).toBeVisible();
  await expect(settingsDialog.getByLabel("Opened-file cache limit presets")).toHaveCount(0);
  await settingsDialog.getByLabel("Opened-file cache limit slider").evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "512";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settingsDialog.getByLabel("Opened-file cache limit in MB").fill("2048");
  await settingsDialog.getByLabel("Opened-file cache limit in MB").press("Enter");
  await settingsDialog.getByLabel("Max file size eligible for browser cache in MB").fill("32");
  await settingsDialog.getByLabel("Max file size eligible for browser cache in MB").press("Enter");
  await expect(settingsDialog.getByLabel("Max file size eligible for browser cache in MB")).toHaveValue("32");
  await settingsDialog.getByRole("button", { name: /Clear cache/i }).click();
  await expect(page.locator(".browse-status-note")).toHaveText(/Offline cache cleared/i);
});

test("desktop shell hides the account selector behind profile and settings", async ({ page }) => {
  await connectAccount(page, "Desktop shell workspace");
  await expect(page.locator(".app-bar").getByRole("heading", { name: /^Davora$/i })).toHaveCount(0);
  await expect(page.getByLabel("Active account")).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByRole("dialog", { name: /Profile and settings/i }).getByLabel("Active account")).toHaveValue(/.+/);
});

test("mobile settings dialog uses a done action with clean close behavior", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
  await connectAccount(page, "Settings workspace");
  await openSettings(page);

  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByRole("button", { name: /^Done$/i })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /^Close$/i })).toHaveCount(0);
  await settingsDialog.getByRole("button", { name: /^Done$/i }).click();
  await expect(settingsDialog).toHaveCount(0);
});
