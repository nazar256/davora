import { expect, test } from "@playwright/test";

import { connectScreenshotAccount as connectAccount, saveScreenshot, saveViewportScreenshot, selectMobileFileListEntry, setThemeMode, setupScreenshotSuite } from "./support/screenshots";

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Run this spec only when refreshing checked-in screenshot artifacts.");
setupScreenshotSuite();

test("captures the PER-71 desktop browser in light and dark themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "PER-71 desktop workspace");

  for (const mode of ["Light", "Dark"] as const) {
    await setThemeMode(page, mode);
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await page.mouse.move(1, 1);
    await saveScreenshot(page, `davora-browser-desktop-${mode.toLowerCase()}.png`);
  }
});

test("captures the PER-71 mobile browser, drawer, and selection in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "PER-71 mobile workspace");
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close transfer status/i }).click();
  await expect(page.getByLabel("Projects is available offline")).toBeVisible();

  for (const mode of ["Light", "Dark"] as const) {
    const suffix = mode.toLowerCase();
    await page.evaluate((themeMode) => {
      const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
      localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode }));
    }, suffix);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", suffix);
    await expect(page.getByLabel("Projects is available offline")).toBeVisible();
    await page.mouse.move(1, 1);
    await saveScreenshot(page, `davora-browser-mobile-${suffix}.png`);

    await selectMobileFileListEntry(page, /Open folder Projects/i);
    const selectionToolbar = page.getByRole("toolbar", { name: /Selection actions/i });
    await expect(selectionToolbar).toBeVisible();
    await page.mouse.move(1, 1);
    await saveScreenshot(page, `davora-browser-selection-mobile-${suffix}.png`);
    await selectionToolbar.getByRole("button", { name: /^Clear$/i }).click();

    const listWidthBefore = await page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width);
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/^Folder$/)).toHaveCount(0);
    await expect(drawer.getByText(/^File$/)).toHaveCount(0);
    await saveScreenshot(page, `davora-browser-drawer-mobile-${suffix}.png`);
    await drawer.getByRole("button", { name: /Close navigation menu/i }).click();
    await expect.poll(async () => page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width)).toBe(listWidthBefore);
  }
});

test("captures the PER-74 responsive browser and loading-empty state matrix in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One browser project captures the explicit viewport matrix.");
  test.setTimeout(120_000);
  await connectAccount(page, "PER-74 visual QA workspace");

  const viewports = [
    { name: "narrow", width: 320, height: 640 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 }
  ];

  for (const mode of ["light", "dark"] as const) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate((themeMode) => {
        const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
        localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode }));
      }, mode);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await page.mouse.move(1, 1);
      await saveViewportScreenshot(page, `davora-qa-browser-${viewport.name}-${mode}.png`);
    }

    await page.setViewportSize({ width: 360, height: 640 });
    let releaseFolderRequest: (() => void) | undefined;
    const folderRequestGate = new Promise<void>((resolve) => {
      releaseFolderRequest = resolve;
    });
    await page.route("**/api/files?path=Design", async (route) => {
      await folderRequestGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { path: "Design", items: [] } })
      });
    });
    await page.evaluate((themeMode) => {
      const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
      localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode }));
      Object.keys(localStorage)
        .filter((key) => key.startsWith("davora-cache:v2:folder:") && key.endsWith("6:Design"))
        .forEach((key) => localStorage.removeItem(key));
    }, mode);
    await page.reload();
    await expect(page.getByRole("button", { name: /Open folder Design/i })).toBeVisible();
    await page.getByRole("button", { name: /Open folder Design/i }).click();
    await expect(page.getByText("Loading folder...", { exact: true })).toBeVisible();
    await saveViewportScreenshot(page, `davora-qa-loading-${mode}.png`);
    releaseFolderRequest?.();
    await expect(page.getByText("This folder is empty.", { exact: true })).toBeVisible();
    await saveViewportScreenshot(page, `davora-qa-empty-${mode}.png`);
    await page.unroute("**/api/files?path=Design");
    const homeButton = page.getByRole("button", { name: /Go to home folder/i });
    if (await homeButton.isVisible().catch(() => false)) {
      await homeButton.click();
    } else {
      await page.getByRole("button", { name: /Go up one folder level/i }).click();
    }
  }
});

test("captures the mobile browse-first workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open search/i }).click();
  await expect(page.getByRole("textbox", { name: /Search files/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-search-expanded.png");
  await page.getByRole("button", { name: /Close search/i }).click();
  const roadmapOpenButton = page.getByRole("button", { name: /Open file roadmap.txt/i });
  const roadmapOpenButtonHandle = await roadmapOpenButton.elementHandle();
  expect(roadmapOpenButtonHandle).not.toBeNull();
  await roadmapOpenButtonHandle!.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await roadmapOpenButtonHandle!.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.getByRole("button", { name: /Select song.mp3 file/i }).click();
  await expect(page.getByRole("toolbar", { name: /Selection actions/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-row-selection-toggle.png");
  await saveScreenshot(page, "davora-mobile-selection-actions.png");
  await page.getByRole("button", { name: /^Clear$/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await expect(page.getByRole("region", { name: /Details for roadmap.txt/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-browse.png");
});

test("captures the mobile sticky toolbar after list scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  const longNames = Array.from({ length: 42 }, (_, index) => `Archive ${String(index + 1).padStart(2, "0")}`);
  await page.route("**/api/files?path=", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [{ path: "Long", name: "Long", isFolder: true, lastModified: "2026-05-29T08:18:00.000Z" }]
        }
      })
    });
  });
  await page.route("**/api/files?path=Long", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Long",
          items: longNames.map((name, index) => ({
            path: `Long/${name}.txt`,
            name: `${name}.txt`,
            isFolder: false,
            size: 128 + index,
            lastModified: new Date(Date.UTC(2026, 4, 1 + index, 8, 15, 0)).toISOString()
          }))
        }
      })
    });
  });

  await connectAccount(page, "Sticky toolbar workspace", { waitForWorkspace: false });
  await page.getByRole("button", { name: /Open folder Long/i }).click();
  await expect(page.getByRole("button", { name: /Open actions for Archive 42\.txt/i })).toBeVisible();
  const scrolledPanelTop = await page.locator(".file-list-panel").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    return element.scrollTop;
  });
  expect(scrolledPanelTop).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /Open navigation menu/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open search/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open sort options/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Transfers$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-sticky-toolbar.png");
});

test("captures the mobile navigation drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await expect(page.getByRole("complementary", { name: /Navigation menu/i })).toBeVisible();
  await expect(page.getByLabel(/Upload files from navigation menu/i)).toBeAttached();
  await saveScreenshot(page, "davora-mobile-navigation.png");
});

test("captures mobile favourites quick access in the navigation drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Favourites workspace");
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Add to Favourites/i }).click();
  await page.getByRole("button", { name: /Close item actions/i }).click();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("region", { name: /Details for roadmap.txt/i }).getByRole("button", { name: /Add to Favourites/i }).click();
  await page.getByRole("button", { name: /Close item actions/i }).click();
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await expect(drawer.getByRole("button", { name: /Open favourite folder Projects/i })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Open favourite file roadmap.txt/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-favourites.png");
});

test("captures the PER-85 mobile quick-actions menu in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "PER-85 quick actions workspace");

  const fab = page.getByRole("button", { name: "Quick actions", exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((themeMode) => {
      const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
      localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode }));
    }, mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
    await expect(fab).toBeVisible();
    await page.mouse.move(1, 1);
    await saveScreenshot(page, `davora-mobile-quick-actions-${mode}.png`);

    await fab.click();
    const menu = page.getByRole("menu", { name: /Quick actions/i });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(3);
    await saveScreenshot(page, `davora-mobile-quick-actions-open-${mode}.png`);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
});

test("captures the mobile pull-to-refresh gesture indicator", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Mobile pull refresh workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  const workspace = page.locator(".workspace-layout");
  await workspace.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 180, clientY: 0 }] });
  await workspace.dispatchEvent("touchmove", { touches: [{ identifier: 1, clientX: 180, clientY: 130 }] });
  const indicator = page.getByRole("status").filter({ hasText: /Release to refresh/i });
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(indicator).toHaveCSS("border-top-width", "0px");
  await expect(indicator).toHaveCSS("pointer-events", "none");
  await saveScreenshot(page, "davora-mobile-pull-refresh-gesture.png");
});

test("captures the PER-54 folder sort reset confirmation in both themes", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chrome";
  await connectAccount(page, "PER-54 folder sort workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  if (isMobile) {
    await page.getByRole("button", { name: /Open sort options/i }).click();
    await page.getByRole("button", { name: "Name Z-A", exact: true }).click();
  } else {
    await page.getByLabel("Sort files and folders").selectOption("name-desc");
  }

  for (const mode of ["Light", "Dark"] as const) {
    const suffix = mode.toLowerCase();
    await setThemeMode(page, mode);
    if (isMobile) {
      const sortPanel = page.getByRole("group", { name: "Sort options", exact: true });
      if (!await sortPanel.isVisible().catch(() => false)) {
        await page.getByRole("button", { name: /Open sort options/i }).click();
      }
      await sortPanel.getByRole("button", { name: "Reset folder sort settings" }).click();
      await expect(sortPanel.getByText("Clear saved sort for 1 folder?")).toBeVisible();
      await page.mouse.move(1, 1);
      await saveScreenshot(page, `davora-folder-sort-reset-mobile-${suffix}.png`);
      await sortPanel.getByRole("button", { name: "Cancel", exact: true }).click();
    } else {
      const resetButton = page.getByRole("button", { name: /Reset saved folder sort settings/i });
      await expect(resetButton).toBeEnabled();
      await resetButton.click();
      const confirm = page.getByRole("group", { name: /Confirm clearing folder sort settings/i });
      await expect(confirm.getByText("Clear saved sort for 1 folder?")).toBeVisible();
      await page.mouse.move(1, 1);
      await saveScreenshot(page, `davora-folder-sort-reset-desktop-${suffix}.png`);
      await confirm.getByRole("button", { name: "Cancel" }).click();
    }
  }
});
