import { expect, test } from "@playwright/test";

import { connectScreenshotAccount as connectAccount, saveScreenshot, setupScreenshotSuite } from "./support/screenshots";

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Run this spec only when refreshing checked-in screenshot artifacts.");
setupScreenshotSuite();

test("captures the mobile details sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  const longFileName = "quarterly-archive-export-with-long-location-name-and-metadata.txt";
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            {
              path: `Projects/Client/Finance/Quarterly/Exports/2026/July/${longFileName}`,
              name: longFileName,
              isFolder: false,
              size: 1048576,
              mimeType: "text/plain",
              lastModified: "2026-07-09T18:30:00.000Z"
            }
          ]
        }
      })
    });
  });
  await connectAccount(page, "Mobile details workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  const sheet = page.getByRole("region", { name: `Details for ${longFileName}` });
  await sheet.getByRole("button", { name: /View details/i }).click();
  await expect(sheet).toHaveClass(/details-panel-sheet-details-open/);
  await expect(sheet.getByRole("button", { name: /Back to actions/i })).toBeVisible();
  await expect(sheet.locator(".context-metadata dt").filter({ hasText: /^Location$/ })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-details-sheet.png");
});

test("captures the mobile delete confirmation without typed-name gate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  const longFileName = "Документи-and-a-very-long-delete-target-name-100%.txt";
  const longPath = `Projects/${longFileName}`;
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            {
              path: longPath,
              name: longFileName,
              isFolder: false,
              size: 70,
              mimeType: "text/plain",
              lastModified: "2026-07-10T09:30:00.000Z"
            }
          ]
        }
      })
    });
  });
  await connectAccount(page, "Delete confirmation workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  await page.getByRole("region", { name: `Details for ${longFileName}` }).getByRole("button", { name: /^Delete$/i }).click();

  const dialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(longPath)).toBeVisible();
  await expect(dialog.getByLabel(/Name to confirm/i)).toHaveCount(0);
  await saveScreenshot(page, "davora-mobile-delete-confirmation.png");
});
