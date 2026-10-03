import { expect, test } from "@playwright/test";

import { saveViewportScreenshot } from "./support/screenshots";
import { connectAccount, selectFileListEntry } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

// The mock workspace root contains the Archive, Design, and Projects folders.
const selectAllCheckbox = (page: import("@playwright/test").Page) =>
  page.getByRole("checkbox", { name: /all items in this folder/i });
const selectedRows = (page: import("@playwright/test").Page) =>
  page.locator(".file-list-items .item-row.batch-selected");
const selectionRegion = (page: import("@playwright/test").Page, count: number) =>
  page.getByRole("region", { name: `Selection details for ${count} items` });

test("PER-91 desktop select-all selects and clears every entry in the current folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop list-header control.");

  await connectAccount(page, "Select all workspace");

  const header = selectAllCheckbox(page);
  await expect(header).toBeVisible();
  await expect(header).toBeEnabled();
  await expect(header).not.toBeChecked();

  await header.click();

  await expect(header).toBeChecked();
  await expect(header).toHaveAccessibleName(/Deselect all items in this folder/i);
  await expect(selectedRows(page)).toHaveCount(3);
  await expect(page.locator(".file-list-items .item-batch-checkbox:checked")).toHaveCount(3);
  await expect(selectionRegion(page, 3)).toBeVisible();
  await expect(selectionRegion(page, 3)).toContainText("3 folders");

  // Membership is path-based, so re-sorting keeps every row selected.
  await page.getByLabel("Sort files and folders").selectOption("name-desc");
  await expect(page.locator(".file-list-items .item-name").first()).toHaveText("Projects");
  await expect(selectedRows(page)).toHaveCount(3);
  await expect(header).toBeChecked();

  await header.click();

  await expect(header).not.toBeChecked();
  await expect(header).toHaveAccessibleName(/Select all items in this folder/i);
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(selectionRegion(page, 3)).toBeHidden();
});

test("PER-91 desktop select-all stays flat, reports a partial state, and preserves other-folder memberships", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop list-header control.");

  await page.route("**/api/search?**", async (route) => route.fulfill({
    json: {
      data: { completeness: "complete",
        query: "roadmap",
        path: "",
        items: [
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, score: 1 }
        ]
      }
    }
  }));

  await connectAccount(page, "Select all scoped workspace");

  // A search result selected while searching keeps a membership outside the
  // current folder after the search is cleared.
  await page.getByPlaceholder("Search files and folders").fill("roadmap");
  await expect(page.locator(".file-list-items .item-name")).toHaveText(["roadmap.txt"]);
  await selectFileListEntry(page, /Select roadmap.txt file/i, /Open file roadmap.txt/i);
  await expect(selectionRegion(page, 1)).toBeVisible();
  await page.getByRole("button", { name: /Clear search/i }).click();
  await expect(selectionRegion(page, 1)).toBeVisible();

  const header = selectAllCheckbox(page);
  // The out-of-folder membership does not count toward this folder's state.
  await expect(header).not.toBeChecked();

  await selectFileListEntry(page, /Select Design folder/i, /Open folder Design/i);
  await expect(header).toHaveAttribute("aria-checked", "mixed");
  await expect(await header.evaluate((element: HTMLInputElement) => element.indeterminate)).toBe(true);

  await header.click();

  // Membership is flat: the three root folders join without descendants.
  await expect(selectionRegion(page, 4)).toBeVisible();
  await expect(selectionRegion(page, 4)).toContainText("3 folders");
  await expect(header).toBeChecked();

  // Deselect-all removes only this folder's paths; the search-scoped
  // membership survives.
  await header.click();
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(selectionRegion(page, 1)).toBeVisible();
});

test("PER-91 desktop select-all disables during search and in empty folders", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop list-header control.");

  await page.route("**/api/search?**", async (route) => route.fulfill({
    json: {
      data: { completeness: "complete",
        query: "roadmap",
        path: "",
        items: [
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, score: 1 }
        ]
      }
    }
  }));
  await page.route("**/api/files?path=Projects&listing=complete-v1", async (route) => route.fulfill({
    json: { data: { completeness: "complete", path: "Projects", items: [] } }
  }));

  await connectAccount(page, "Select all search workspace");

  const header = selectAllCheckbox(page);
  await expect(header).toBeEnabled();

  // Search results are recursive, so the folder-scoped control is disabled;
  // per-result checkboxes keep working.
  await page.getByPlaceholder("Search files and folders").fill("roadmap");
  await expect(page.locator(".file-list-items .item-name")).toHaveText(["roadmap.txt"]);
  await expect(header).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Select roadmap.txt file/i })).toBeEnabled();

  await page.getByRole("button", { name: /Clear search/i }).click();
  await expect(header).toBeEnabled();

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByText(/This folder is empty|No items/i).first()).toBeVisible();
  await expect(header).toBeDisabled();
});

test("PER-91 mobile batch bar selects and clears every entry in the current folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile batch-bar control.");

  await connectAccount(page, "Select all mobile workspace");

  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);

  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText("1 item selected");

  const selectAll = toolbar.getByRole("button", { name: "Select all" });
  await expect(selectAll).toBeEnabled();
  await selectAll.click();

  await expect(toolbar).toContainText("3 items selected");
  await expect(selectedRows(page)).toHaveCount(3);
  await expect(toolbar.getByRole("button", { name: "Deselect all" })).toBeVisible();

  if (process.env.CAPTURE_SCREENSHOTS) {
    await saveViewportScreenshot(page, "davora-mobile-select-all.png");
  }

  await toolbar.getByRole("button", { name: "Deselect all" }).click();

  await expect(selectedRows(page)).toHaveCount(0);
  await expect(toolbar).toBeHidden();
});
