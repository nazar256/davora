import { expect, test } from "@playwright/test";
import { connectAccount, getVisibleSelectionToolbar, openSettings, selectFileListEntry } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("responsive viewport transitions preserve the folder, account, selection, and details state", async ({ page }) => {
  const responsiveQuery = "(max-width: 900px)";
  const accountLabel = "Responsive viewport workspace";
  await page.setViewportSize({ width: 901, height: 900 });
  await expect.poll(() => page.evaluate((query) => window.matchMedia(query).matches, responsiveQuery)).toBe(false);
  await connectAccount(page, accountLabel);
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page).toHaveURL(/path=Projects/);
  const selectedRoadmap = page.getByRole("checkbox", { name: /Select roadmap.txt file/i });
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await expect(page.locator(".details-panel")).toBeVisible();
  await selectedRoadmap.check();
  await expect(selectedRoadmap).toBeChecked();

  const expectRetainedState = async (width: number, narrow: boolean) => {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate((query) => window.matchMedia(query).matches, responsiveQuery)).toBe(narrow);
    await expect(page).toHaveURL(/path=Projects/);
    await expect(selectedRoadmap).toBeChecked();
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toHaveCount(0);
    await expect(page.locator(".browse-status-note")).toContainText(accountLabel);
  };

  await expect(page.getByPlaceholder("Search files and folders")).toBeVisible();
  await expect(page.getByLabel("Sort files and folders")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open search/i })).toHaveCount(0);

  await expectRetainedState(900, true);
  await expect(page.getByRole("button", { name: /Open search/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open sort options/i })).toBeVisible();
  await expect(page.locator(".details-panel")).toContainText("1 item selected");

  await expectRetainedState(901, false);
  await expect(page.getByPlaceholder("Search files and folders")).toBeVisible();
  await expect(page.getByLabel("Sort files and folders")).toBeVisible();
  await expect(page.locator(".details-panel")).toContainText("1 item selected");

  await expectRetainedState(900, true);
  await expect(page.locator(".details-panel")).toContainText("1 item selected");
  await expectRetainedState(899, true);
  await expect(page.locator(".details-panel")).toContainText("1 item selected");
});

test("browser back closes app surfaces before leaving the file-manager workspace", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.includes("mobile");
  await connectAccount(page, "Back workspace", { waitForWorkspace: false });
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  await page.goBack();
  if (!isMobile) {
    await expect(page.getByRole("heading", { name: /Home/i })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(preview).toBeVisible();

  await page.goBack();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  if (isMobile) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
  }
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();

  await page.goBack();
  await expect(settingsDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
});

test("mobile Back follows search, drawer, details, and transfer dismissal order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile navigation-surface ordering characterization.");
  await connectAccount(page, "Mobile Back ordering workspace");

  await page.getByRole("button", { name: /Open search/i }).click();
  await expect(page.getByRole("button", { name: /Close search/i })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /Close search/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await expect(drawer).toHaveClass(/open/);
  await page.goBack();
  await expect(page.getByRole("complementary", { name: /Navigation menu/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  const details = page.getByRole("region", { name: /Details for Projects/i });
  await expect(details).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("region", { name: /Details for Projects/i })).toHaveCount(0);

  await page.getByRole("button", { name: /^Transfers$/i }).click();
  const transferDialog = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferDialog).toBeVisible();
  await page.goBack();
  await expect(transferDialog).toHaveCount(0);
});

test("URL syncs current folder path and clears on return to root", async ({ page }) => {
  await connectAccount(page, "URL sync workspace", { waitForWorkspace: false });
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  // Verify URL has path param after navigating to folder
  await expect(page).toHaveURL(/path=Projects/);

  // Navigate back using browser back and verify URL clears
  await page.goBack();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("desktop and mobile search opens, changes, and clears without leaving the current folder", async ({ page }, testInfo) => {
  await connectAccount(page, "Search controls workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page).toHaveURL(/path=Projects/);

  const isMobile = testInfo.project.name === "mobile-chrome";
  if (isMobile) {
    await page.getByRole("button", { name: /Open search/i }).click();
  }

  const searchInput = isMobile
    ? page.getByPlaceholder("Search files", { exact: true })
    : page.getByPlaceholder("Search files and folders");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("roadmap");
  await expect(searchInput).toHaveValue("roadmap");
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file demo\.json/i })).toHaveCount(0);

  if (isMobile) {
    // Mobile's compact search chrome has no separate clear button; clearing the input restores the folder list before close.
    await searchInput.fill("");
    await expect(searchInput).toHaveValue("");
    await page.getByRole("button", { name: /Close search/i }).click();
    await expect(searchInput).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: /Clear search/i }).click();
    await expect(searchInput).toHaveValue("");
  }
  await expect(page).toHaveURL(/path=Projects/);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file demo\.json/i })).toBeVisible();
});

test("mobile Back closes search while retaining the folder path and selection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile search/Back selection coverage.");
  await connectAccount(page, "Mobile search Back workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await selectFileListEntry(page, /Select roadmap.txt file/i, /Open file roadmap.txt/i);
  const initialSelectionToolbar = await getVisibleSelectionToolbar(page);
  expect(initialSelectionToolbar).toBeDefined();
  await expect(initialSelectionToolbar!.getByText(/1 item selected/i)).toBeVisible();

  await page.getByRole("button", { name: /Open search/i }).click();
  const searchInput = page.getByPlaceholder("Search files", { exact: true });
  await searchInput.fill("roadmap");
  await expect(searchInput).toHaveValue("roadmap");
  await page.goBack();

  await expect(page.getByRole("button", { name: /Close search/i })).toHaveCount(0);
  await expect(page).toHaveURL(/path=Projects/);
  const retainedSelectionToolbar = await getVisibleSelectionToolbar(page);
  expect(retainedSelectionToolbar).toBeDefined();
  await expect(retainedSelectionToolbar!.getByText(/1 item selected/i)).toBeVisible();
});

test("nested folder URL navigation and browser Back stay within the file manager", async ({ page }) => {
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [{ path: "Projects/Plans", name: "Plans", isFolder: true }]
        }
      })
    });
  });
  await page.route("**/api/files?path=Projects%2FPlans", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects/Plans",
          items: [{ path: "Projects/Plans/roadmap.txt", name: "roadmap.txt", isFolder: false }]
        }
      })
    });
  });

  await connectAccount(page, "Nested URL workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open folder Plans/i }).click();
  await expect(page).toHaveURL(/path=Projects%2FPlans/);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/path=Projects(?:$|&)/);
  await expect(page.getByRole("button", { name: /Open folder Plans/i })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
});

test("mobile pull-to-refresh requests only the current folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile pull-to-refresh coverage.");
  const requestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/files") {
      requestedPaths.push(url.searchParams.get("path") ?? "");
    }
  });

  await connectAccount(page, "Current folder refresh workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  const requestsBeforeRefresh = requestedPaths.slice();

  const panel = page.locator(".file-list-panel");
  await panel.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY))
    .toBe("none");
  await expect
    .poll(() => panel.evaluate((element) => getComputedStyle(element).overscrollBehaviorY))
    .toBe("contain");
  const workspace = page.locator(".workspace-layout");
  await workspace.dispatchEvent("touchstart", { touches: [{ identifier: 4, clientX: 180, clientY: 0 }] });
  await workspace.dispatchEvent("touchmove", { touches: [{ identifier: 4, clientX: 180, clientY: 140 }] });
  await expect(page.locator(".pull-to-refresh-indicator")).toBeVisible();
  await workspace.dispatchEvent("touchend", { changedTouches: [{ identifier: 4, clientX: 180, clientY: 140 }] });

  await expect.poll(() => requestedPaths.length).toBe(requestsBeforeRefresh.length + 1);
  expect(requestedPaths.slice(requestsBeforeRefresh.length)).toEqual(["Projects"]);
  await expect(page).toHaveURL(/path=Projects/);
});

test("breadcrumbs use a home root with slash separators and replace redundant navigation buttons", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chrome", "Mobile uses the compact app bar and navigation drawer instead of breadcrumbs.");
  await connectAccount(page, "Navigation workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();

  const breadcrumbs = page.getByRole("navigation", { name: /Breadcrumbs/i });
  await expect(breadcrumbs.getByRole("button", { name: /Go to home folder/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Go to all files/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Go up one folder level/i })).toHaveCount(0);
  await expect(breadcrumbs.getByText("/").first()).toBeVisible();
  await breadcrumbs.getByRole("button", { name: /Go to home folder/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
});
