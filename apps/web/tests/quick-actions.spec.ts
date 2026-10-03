import { expect, test } from "@playwright/test";
import { connectAccount, selectFileListEntry } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

const quickActionsFab = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Quick actions", exact: true });

test("quick actions render only on narrow viewports and expand upward with three items", async ({ page }, testInfo) => {
  await connectAccount(page, "Quick actions workspace");

  const fab = quickActionsFab(page);
  if (testInfo.project.name !== "mobile-chrome") {
    await expect(fab).toHaveCount(0);
    return;
  }

  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute("aria-expanded", "false");

  const fabBox = await fab.boundingBox();
  expect(fabBox).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(fabBox!.x + fabBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(fabBox!.y + fabBox!.height).toBeLessThanOrEqual(viewport!.height);
  expect(fabBox!.width).toBeGreaterThanOrEqual(44);
  expect(fabBox!.height).toBeGreaterThanOrEqual(44);

  await fab.click();
  await expect(fab).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: /Quick actions/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("menuitem", { name: /Upload files/i })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Upload folder/i })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /New folder/i })).toBeVisible();

  const menuBox = await menu.boundingBox();
  const expandedFabBox = await fab.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(expandedFabBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(expandedFabBox!.y + 1);
});

test("quick actions close on Escape, scrim tap, and system Back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  await connectAccount(page, "Quick actions dismissal workspace");

  const fab = quickActionsFab(page);
  const menu = page.getByRole("menu", { name: /Quick actions/i });

  await fab.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(fab).toBeFocused();

  await fab.click();
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: /Dismiss quick actions/i }).click();
  await expect(menu).toHaveCount(0);

  await fab.click();
  await expect(menu).toBeVisible();
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(fab).toHaveAttribute("aria-expanded", "false");
});

test("quick actions upload files and folder through the existing pipeline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  await connectAccount(page, "Quick actions upload workspace");

  const fab = quickActionsFab(page);
  const menu = page.getByRole("menu", { name: /Quick actions/i });

  await fab.click();
  const fileChooserEvent = page.waitForEvent("filechooser");
  await menu.getByRole("menuitem", { name: /Upload files/i }).click();
  await expect(menu).toHaveCount(0);
  const fileChooser = await fileChooserEvent;
  await fileChooser.setFiles({ name: "quick.txt", mimeType: "text/plain", buffer: Buffer.from("quick") });
  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 1 file into \//i);
  await expect(page.getByRole("button", { name: /Open file quick.txt/i })).toBeVisible();

  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible()) {
    await closeItemActions.click();
  }
  await expect(fab).toBeVisible();
  await fab.click();
  const folderChooserEvent = page.waitForEvent("filechooser");
  await menu.getByRole("menuitem", { name: /Upload folder/i }).click();
  await expect(menu).toHaveCount(0);
  const folderChooser = await folderChooserEvent;
  await folderChooser.setFiles("tests/fixtures/folder-upload/Mixtape");
  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 2 files from 1 folder into \//i);
  await expect(page.getByRole("button", { name: /Open folder Mixtape/i })).toBeVisible();
});

test("quick actions new folder opens the existing create-folder dialog", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  await connectAccount(page, "Quick actions folder workspace");

  await quickActionsFab(page).click();
  const menu = page.getByRole("menu", { name: /Quick actions/i });
  await menu.getByRole("menuitem", { name: /New folder/i }).click();
  await expect(menu).toHaveCount(0);

  const dialog = page.getByRole("dialog", { name: /Create folder/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Folder name").fill("Quick Folder");
  await dialog.getByRole("button", { name: /Create folder/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open folder Quick Folder/i })).toBeVisible();
});

test("quick actions hide while competing surfaces are active", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  await connectAccount(page, "Quick actions collision workspace");

  const fab = quickActionsFab(page);
  await expect(fab).toBeVisible();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await expect(drawer).toBeVisible();
  await expect(fab).toHaveCount(0);
  await drawer.getByRole("button", { name: /Close navigation menu/i }).click();
  await expect(fab).toBeVisible();

  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);
  await expect(fab).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  await toolbar.getByRole("button", { name: /^Clear$/i }).click();
  await expect(fab).toBeVisible();
});

test("quick actions stay hidden in explicit offline mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  await connectAccount(page, "Quick actions offline workspace");

  const fab = quickActionsFab(page);
  await expect(fab).toBeVisible();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await drawer.getByRole("button", { name: /^Go offline$/i }).click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await drawer.getByRole("button", { name: /Close navigation menu/i }).click();

  await expect(fab).toHaveCount(0);
  await expect(page.locator(".quick-actions")).toHaveCount(0);
});

test("quick actions keep the last file row reachable above the control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Quick actions are mobile-only.");
  const names = Array.from({ length: 30 }, (_, index) => `Row ${String(index + 1).padStart(2, "0")}`);
  await page.route("**/api/files?path=&listing=complete-v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { completeness: "complete",
          path: "",
          items: names.map((name) => ({
            path: name,
            name,
            isFolder: true,
            lastModified: "2026-05-29T08:18:00.000Z"
          }))
        }
      })
    });
  });
  await connectAccount(page, "Quick actions scroll workspace", { waitForWorkspace: false });
  await expect(page.getByRole("button", { name: /Open folder Row 01/i })).toBeVisible();

  const fab = quickActionsFab(page);
  await expect(fab).toBeVisible();

  const panel = page.locator(".file-list-panel");
  const lastRow = page.getByRole("button", { name: /Open folder Row 30/i });
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(lastRow).toBeVisible();

  const geometry = await page.evaluate(() => {
    const fabElement = document.querySelector(".quick-actions-fab");
    const rows = Array.from(document.querySelectorAll(".file-list-panel [role='button'], .file-list-panel li"));
    const last = rows[rows.length - 1];
    if (!(fabElement instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      return null;
    }
    const fabBox = fabElement.getBoundingClientRect();
    const rowBox = last.getBoundingClientRect();
    return { fabTop: fabBox.top, rowBottom: rowBox.bottom, viewportHeight: window.innerHeight };
  });
  expect(geometry).not.toBeNull();
  if (!geometry) return;
  expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.fabTop);
});
