import { expect, test } from "@playwright/test";
import { connectAccount, openSettings } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("browsing sort and hidden search filtering preserve their distinct ordering", async ({ page }, testInfo) => {
  await page.route("**/api/files?**", async (route) => route.fulfill({
    json: {
      data: {
        path: "",
        items: [
          { path: "Projects", name: "Projects", isFolder: true },
          { path: ".hidden-folder", name: ".hidden-folder", isFolder: true },
          { path: "Archive", name: "Archive", isFolder: true }
        ]
      }
    }
  }));
  await page.route("**/api/search?**", async (route) => route.fulfill({
    json: {
      data: {
        query: "ordered",
        path: "",
        items: [
          { path: "zeta.txt", name: "zeta.txt", isFolder: false, score: 0.2 },
          { path: ".hidden.txt", name: ".hidden.txt", isFolder: false, score: 1 },
          { path: "alpha.txt", name: "alpha.txt", isFolder: false, score: 0.9 }
        ]
      }
    }
  }));

  await connectAccount(page, "Browsing policy workspace");
  const rowNames = page.locator(".file-list-items .item-name");
  await expect(rowNames).toHaveText(["Archive", "Projects"]);

  const isMobile = testInfo.project.name === "mobile-chrome";
  if (isMobile) {
    await page.getByRole("button", { name: /Open sort options/i }).click();
    await page.getByRole("button", { name: "Name Z-A" }).click();
    await page.getByRole("button", { name: /Open search/i }).click();
  } else {
    await page.getByLabel("Sort files and folders").selectOption("name-desc");
  }
  await expect(rowNames).toHaveText(["Projects", "Archive"]);

  const searchInput = isMobile
    ? page.getByPlaceholder("Search files", { exact: true })
    : page.getByPlaceholder("Search files and folders");
  await searchInput.fill("ordered");
  await expect(rowNames).toHaveText(["zeta.txt", "alpha.txt"]);

  if (isMobile) {
    await page.getByRole("button", { name: /Close search/i }).click();
  }
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByLabel("Show hidden files and folders").check();
  await settingsDialog.getByRole("button", { name: /Close|Done/i }).click();

  await expect(rowNames).toHaveText(["zeta.txt", ".hidden.txt", "alpha.txt"]);
});

test("favourites provide quick access to files and folders from the navigation drawer", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chrome";
  await connectAccount(page, "Favourites workspace");

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Add to Favourites/i }).click();
  const closeActions = page.getByRole("button", { name: /Close item actions/i });
  if (isMobile && await closeActions.isVisible()) {
    await closeActions.click();
  }
  await page.getByRole("button", { name: /Open folder Projects/i }).click();

  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("region", { name: /Details for roadmap.txt/i }).getByRole("button", { name: /Add to Favourites/i }).click();
  if (isMobile && await closeActions.isVisible()) {
    await closeActions.click();
  }

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  const favourites = drawer.getByRole("region", { name: /Favourites/i });
  await expect(favourites.getByRole("button", { name: /Open favourite folder Projects/i })).toBeVisible();
  await expect(favourites.getByRole("button", { name: /Open favourite file roadmap.txt/i })).toBeVisible();

  await favourites.getByRole("button", { name: /Open favourite folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Open favourite file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Back to files/i }).click();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Remove roadmap.txt from Favourites/i }).click();
  await expect(page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Open favourite file roadmap.txt/i })).toHaveCount(0);
});
