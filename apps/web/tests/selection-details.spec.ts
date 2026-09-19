import { expect, test } from "@playwright/test";
import { connectAccount } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("mobile item actions and details sheet avoids fake handles and nested sheet scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
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
  await connectAccount(page, "Action details workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();

  const sheet = page.getByRole("region", { name: `Details for ${longFileName}` });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("button", { name: /Dismiss item actions/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /View details/i })).toBeVisible();

  const handleContent = await sheet.evaluate((element) => getComputedStyle(element, "::before").content);
  expect(handleContent).toBe("none");

  await sheet.getByRole("button", { name: /View details/i }).click();
  await expect(sheet).toHaveClass(/details-panel-sheet-details-open/);
  await expect(sheet.getByRole("button", { name: /Back to actions/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Close item actions/i })).toBeVisible();
  await expect(sheet.locator(".context-metadata dt").filter({ hasText: /^Location$/ })).toBeVisible();

  const scrollModel = await sheet.evaluate((element) => {
    const metadata = element.querySelector(".context-metadata") as HTMLElement | null;
    const panelStyle = getComputedStyle(element);
    const metadataStyle = metadata ? getComputedStyle(metadata) : undefined;
    return {
      panelOverflowY: panelStyle.overflowY,
      metadataOverflowY: metadataStyle?.overflowY ?? "",
      metadataCanScroll: metadata ? metadata.scrollHeight >= metadata.clientHeight : false
    };
  });
  expect(scrollModel.panelOverflowY).toBe("hidden");
  expect(scrollModel.metadataOverflowY).toBe("auto");
  expect(scrollModel.metadataCanScroll).toBe(true);

  await sheet.getByRole("button", { name: /Back to actions/i }).click();
  await expect(sheet).not.toHaveClass(/details-panel-sheet-details-open/);
  await page.getByRole("button", { name: /Dismiss item actions/i }).click();
  await expect(sheet).toBeHidden();
});
