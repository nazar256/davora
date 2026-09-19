import { expect, test } from "@playwright/test";
import { connectAccount, createGate, openSettings } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("unsupported files download directly instead of opening a dead preview", async ({ page }) => {
  await connectAccount(page, "Download workspace");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Open file image.bin/i }).click();

  const download = await downloadPromise;
  await expect(page.getByRole("dialog", { name: /Preview image.bin/i })).toHaveCount(0);
  await expect(page.locator(".browse-status-note")).toHaveText("Starting browser download for /Archive/image.bin from Download workspace because this file type opens outside preview.");
  expect(download.suggestedFilename()).toBe("image.bin");
});

test("details action downloads a selected file on desktop and mobile", async ({ page }) => {
  await connectAccount(page, "Details download workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();

  const details = page.getByRole("region", { name: /Details for roadmap\.txt/i });
  await expect(details).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await details.getByRole("button", { name: /^Download$/i }).click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("roadmap.txt");
});

test("late focused download cannot save after account replacement", async ({ page }, testInfo) => {
  const requestStarted = createGate();
  const releaseDownload = createGate();
  let routeSettled = false;
  let routeAborted = false;
  let alphaRequestFailed = false;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/download?path=Projects%2Froadmap.txt")) {
      alphaRequestFailed = true;
    }
  });
  await page.route("**/api/download?path=Projects%2Froadmap.txt", async (route) => {
    requestStarted.release();
    await releaseDownload.promise;
    try {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "late roadmap" });
    } catch {
      // Account replacement may abort the browser request before the route is fulfilled.
      routeAborted = true;
    } finally {
      routeSettled = true;
    }
  });

  await connectAccount(page, "Alpha late download workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("region", { name: /Details for roadmap\.txt/i }).getByRole("button", { name: /^Download$/i }).click();
  await requestStarted.promise;

  if (testInfo.project.name === "mobile-chrome") {
    await expect(page.getByRole("region", { name: /Details for roadmap\.txt/i })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("region", { name: /Details for roadmap\.txt/i })).toHaveCount(0);
  }

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const addDialog = page.getByRole("dialog", { name: /Add account/i });
  await addDialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await addDialog.getByLabel("Username").fill("beta-late-download");
  await addDialog.getByLabel("App password").fill("beta-password");
  await addDialog.getByLabel("Label").fill("Beta late download workspace");
  await addDialog.getByRole("button", { name: /Add account/i }).click();

  await openSettings(page);
  const replacementSettings = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = replacementSettings.getByLabel("Active account");
  await activeAccountSelect.selectOption({ label: "Beta late download workspace" });
  await expect(activeAccountSelect.locator("option:checked")).toHaveText("Beta late download workspace");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  const unexpectedDownload = page.waitForEvent("download", { timeout: 1_500 });
  releaseDownload.release();
  await expect(unexpectedDownload).rejects.toThrow(/Timeout/);
  await expect.poll(() => routeSettled).toBe(true);
  await expect.poll(() => routeAborted || alphaRequestFailed).toBe(true);
});
