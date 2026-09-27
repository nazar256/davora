import { expect, test, type Page } from "@playwright/test";
import { connectAccount, createGate, selectFileListEntry } from "./support/workspace";

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

async function measureNoticeGeometry(page: Page) {
  return page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>(".state-banner-slot .banner-state");
    const panel = document.querySelector<HTMLElement>(".file-list-panel");
    if (!notice || !panel) {
      return null;
    }
    const bounds = notice.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const probe = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) {
        return { insideNotice: false, surface: "none" };
      }
      return {
        insideNotice: hit === notice || notice.contains(hit),
        surface: `${hit.tagName.toLowerCase()}.${Array.from(hit.classList).join(".")}`
      };
    };
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return {
      notice: { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left },
      panel: { top: panelBounds.top, right: panelBounds.right, bottom: panelBounds.bottom, left: panelBounds.left },
      probes: [
        probe(centerX, centerY),
        probe(bounds.left + 3, centerY),
        probe(bounds.right - 3, centerY),
        probe(centerX, bounds.top + 2),
        probe(centerX, bounds.bottom - 2)
      ],
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
}

async function expectNoticeReadable(page: Page, context: string) {
  const geometry = await measureNoticeGeometry(page);
  expect(geometry, `${context}: cached notice must render`).not.toBeNull();
  if (!geometry) {
    return;
  }
  const { notice, panel, probes, viewport } = geometry;
  expect(notice.top, `${context}: notice top inside viewport`).toBeGreaterThanOrEqual(0);
  expect(notice.bottom, `${context}: notice bottom inside viewport`).toBeLessThanOrEqual(viewport.height + 1);
  expect(notice.left, `${context}: notice left inside viewport`).toBeGreaterThanOrEqual(-1);
  expect(notice.right, `${context}: notice right inside viewport`).toBeLessThanOrEqual(viewport.width + 1);
  expect(notice.bottom, `${context}: notice must not intersect the file list`).toBeLessThanOrEqual(panel.top + 1);
  for (const probe of probes) {
    expect(probe.insideNotice, `${context}: notice must not be painted under ${probe.surface}`).toBe(true);
  }
}

test("PER-74 responsive visual QA keeps core browser controls within representative viewports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One browser project exercises the explicit viewport matrix.");
  await connectAccount(page, "PER-74 responsive workspace");

  const viewports = [
    { name: "narrow mobile", width: 320, height: 640 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "short desktop", width: 1440, height: 900 }
  ];

  for (const themeMode of ["light", "dark"] as const) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate((mode) => {
        const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
        localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode: mode }));
      }, themeMode);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeMode);
      await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const appBar = document.querySelector(".app-bar") as HTMLElement;
        const fileList = document.querySelector(".file-list-panel") as HTMLElement;
        const appBarBox = appBar.getBoundingClientRect();
        const fileListBox = fileList.getBoundingClientRect();
        const visibleControls = Array.from(appBar.querySelectorAll("button"))
          .map((control) => control.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }));
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          appBar: { left: appBarBox.left, right: appBarBox.right, top: appBarBox.top, bottom: appBarBox.bottom },
          fileList: { left: fileListBox.left, right: fileListBox.right, top: fileListBox.top, bottom: fileListBox.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          visibleControls
        };
      });

      expect(geometry.documentOverflow, `${themeMode} ${viewport.name} document overflow`).toBeLessThanOrEqual(1);
      for (const [surface, box] of [["app bar", geometry.appBar], ["file list", geometry.fileList]] as const) {
        expect(box.left, `${themeMode} ${viewport.name} ${surface} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${themeMode} ${viewport.name} ${surface} right edge`).toBeLessThanOrEqual(geometry.viewport.width + 1);
        expect(box.top, `${themeMode} ${viewport.name} ${surface} top edge`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `${themeMode} ${viewport.name} ${surface} bottom edge`).toBeLessThanOrEqual(geometry.viewport.height + 1);
      }
      for (const control of geometry.visibleControls) {
        expect(control.left, `${themeMode} ${viewport.name} toolbar control left edge`).toBeGreaterThanOrEqual(0);
        expect(control.right, `${themeMode} ${viewport.name} toolbar control right edge`).toBeLessThanOrEqual(geometry.viewport.width + 1);
        if (viewport.width <= 900) {
          expect(control.width, `${themeMode} ${viewport.name} toolbar control width`).toBeGreaterThanOrEqual(44);
          expect(control.height, `${themeMode} ${viewport.name} toolbar control height`).toBeGreaterThanOrEqual(44);
        }
      }

      if (viewport.width <= 900) {
        const listWidthBefore = await page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width);
        await page.getByRole("button", { name: /Open navigation menu/i }).click();
        const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
        await expect(drawer).toBeVisible();
        await expect.poll(async () => (await drawer.boundingBox())?.x ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(0);
        const drawerBox = await drawer.boundingBox();
        expect(drawerBox).not.toBeNull();
        expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
        expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(viewport.width + 1);
        await drawer.getByRole("button", { name: /Close navigation menu/i }).click();
        await expect.poll(async () => page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width)).toBe(listWidthBefore);
      }
    }
  }
});

test("desktop shell expands with the window beyond the old 1440px cap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop-only layout regression.");
  await connectAccount(page, "PER-95 wide desktop workspace");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  for (const width of [1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        viewport: window.innerWidth,
        shell: rect(".shell")?.width ?? 0,
        appBar: rect(".app-bar")?.width ?? 0,
        fileList: rect(".file-list-panel")?.width ?? 0
      };
    });

    expect(geometry.viewport).toBe(width);
    expect(geometry.documentOverflow, `${width}px document overflow`).toBeLessThanOrEqual(1);
    expect(geometry.shell, `${width}px shell width`).toBeGreaterThanOrEqual(width - 30);
    expect(geometry.shell, `${width}px shell width`).toBeLessThanOrEqual(width);
    expect(geometry.appBar, `${width}px app bar width`).toBeGreaterThan(1440);
    expect(geometry.fileList, `${width}px file list width`).toBeGreaterThan(1440);
    expect(geometry.appBar, `${width}px app bar width`).toBeLessThanOrEqual(width);
    expect(geometry.fileList, `${width}px file list width`).toBeLessThanOrEqual(width);
  }
});

test("PER-97 portrait workspace fills the viewport and renders a single selection action surface", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Portrait-wide layout regression.");
  await connectAccount(page, "PER-97 portrait workspace");

  for (const viewport of [
    { name: "portrait desktop", width: 1270, height: 1954 },
    { name: "portrait tablet", width: 1024, height: 1366 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".file-list-panel");
      if (!panel) {
        return null;
      }
      const bounds = panel.getBoundingClientRect();
      return {
        documentHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        panelBottom: bounds.bottom,
        panelMaxHeight: getComputedStyle(panel).maxHeight
      };
    });

    expect(geometry, `${viewport.name}: file list must render`).not.toBeNull();
    if (!geometry) {
      continue;
    }
    expect(geometry.documentHorizontalOverflow, `${viewport.name} document overflow`).toBeLessThanOrEqual(1);
    expect(geometry.panelMaxHeight, `${viewport.name} portrait list cap removed`).toBe("none");
    expect(geometry.panelBottom, `${viewport.name} file list bottom`).toBeGreaterThan(geometry.viewport.height * 0.9);
    expect(geometry.panelBottom, `${viewport.name} file list bottom inside viewport`).toBeLessThanOrEqual(geometry.viewport.height + 1);
  }

  await selectFileListEntry(page, /Select Projects folder/i, /Open folder Projects/i);
  await expect(page.getByRole("button", { name: /^Download selected$/i })).toHaveCount(1);
  await expect(page.locator(".browse-header").getByText(/item selected|folder selected/i)).toHaveCount(0);
  await expect(page.locator(".browse-header").getByRole("button", { name: /selected/i })).toHaveCount(0);
});

test("mobile file list fills the available viewport height", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only layout regression.");
  await page.route("**/api/files?path=", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [
            { path: "Documents", name: "Documents", isFolder: true, lastModified: "2026-05-29T08:18:00.000Z" }
          ]
        }
      })
    });
  });
  await page.route("**/api/files?path=Documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Documents",
          items: ["Оля", "ФОП", "Юра", "agents", "AppManager", "bills", "Finances", "jobs", "keys"].map((name, index) => ({
            path: `Documents/${name}`,
            name,
            isFolder: true,
            lastModified: new Date(Date.UTC(2026, 4, 1 + index, 8, 15, 0)).toISOString()
          }))
        }
      })
    });
  });
  await connectAccount(page, "Mobile list workspace", { waitForWorkspace: false });
  await expect(page.getByRole("button", { name: /Open folder Documents/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Documents/i }).click();
  await expect(page.getByRole("button", { name: /Open actions for keys/i })).toBeVisible();

  const layout = await page.evaluate(() => {
    const panel = document.querySelector(".file-list-panel") as HTMLElement | null;
    if (!panel) {
      return null;
    }
    const bounds = panel.getBoundingClientRect();
    return {
      bottomGap: window.innerHeight - bounds.bottom,
      panelHeight: bounds.height,
      viewportHeight: window.innerHeight
    };
  });

  expect(layout).not.toBeNull();
  if (!layout) {
    return;
  }
  expect(layout.panelHeight).toBeGreaterThan(layout.viewportHeight * 0.8);
  expect(layout.bottomGap).toBeGreaterThanOrEqual(0);
  expect(layout.bottomGap).toBeLessThan(64);
});

test("mobile file list scroll keeps the compact toolbar visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only sticky toolbar regression.");
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
  await expect(page.getByRole("button", { name: /Open folder Long/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Long/i }).click();
  await expect(page.getByRole("button", { name: /Open actions for Archive 42\.txt/i })).toBeVisible();

  const before = await page.locator(".app-bar").boundingBox();
  expect(before).not.toBeNull();
  const panel = page.locator(".file-list-panel");
  const scrolledPanelTop = await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    return element.scrollTop;
  });
  expect(scrolledPanelTop).toBeGreaterThan(0);

  const after = await page.locator(".app-bar").boundingBox();
  expect(after).not.toBeNull();
  if (!before || !after) {
    return;
  }

  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: /Open navigation menu/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open search/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open sort options/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Transfers$/i })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const workspace = page.locator(".workspace-layout");
  await workspace.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 180, clientY: 0 }] });
  await workspace.dispatchEvent("touchmove", { touches: [{ identifier: 1, clientX: 180, clientY: 130 }] });
  await expect(page.locator(".pull-to-refresh-indicator")).toHaveCount(0);

  await panel.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await workspace.dispatchEvent("touchstart", { touches: [{ identifier: 2, clientX: 180, clientY: 0 }] });
  await workspace.dispatchEvent("touchmove", { touches: [{ identifier: 2, clientX: 180, clientY: 130 }] });
  await expect(page.locator(".pull-to-refresh-indicator")).toBeVisible();
  await workspace.dispatchEvent("touchend", { changedTouches: [{ identifier: 2, clientX: 180, clientY: 130 }] });
});

test("PER-5 cached offline notice stays readable above the file list", async ({ page, context }, testInfo) => {
  const reportNames = Array.from({ length: 40 }, (_, index) => `Report ${String(index + 1).padStart(2, "0")}.txt`);
  const rootFolders = ["Documents", ...Array.from({ length: 14 }, (_, index) => `Folder ${String(index + 1).padStart(2, "0")}`)];
  await page.route("**/api/files?path=", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: rootFolders.map((name, index) => ({
            path: name,
            name,
            isFolder: true,
            lastModified: new Date(Date.UTC(2026, 4, 1 + index, 8, 15, 0)).toISOString()
          }))
        }
      })
    });
  });
  await page.route("**/api/files?path=Documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Documents",
          items: reportNames.map((name, index) => ({
            path: `Documents/${name}`,
            name,
            isFolder: false,
            size: 100 + index,
            lastModified: new Date(Date.UTC(2026, 4, 1 + index, 8, 15, 0)).toISOString()
          }))
        }
      })
    });
  });

  await connectAccount(page, "PER-5 cached notice", { waitForWorkspace: false });
  await expect(page.getByRole("button", { name: /Open folder Documents/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Documents/i }).click();
  await expect(page.getByRole("button", { name: /Open file Report 40\.txt/i })).toBeVisible();

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  const notice = page.locator(".state-banner-slot .banner-state");
  await expect(notice).toContainText(/cached data while offline/i);
  await expectNoticeReadable(page, "root folder offline notice");

  await page.getByRole("button", { name: /Open folder Documents/i }).click();
  await expect(notice).toContainText(/cached data while offline/i);
  await expect(page.getByRole("button", { name: /Open file Report 40\.txt/i })).toBeVisible();
  await expectNoticeReadable(page, "nested folder offline notice");

  await page.locator(".file-list-panel").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expectNoticeReadable(page, "offline notice after scrolling the list");

  if (testInfo.project.name === "mobile-chrome") {
    await page.locator(".file-list-panel").evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const workspace = page.locator(".workspace-layout");
    await workspace.dispatchEvent("touchstart", { touches: [{ identifier: 3, clientX: 180, clientY: 0 }] });
    await workspace.dispatchEvent("touchmove", { touches: [{ identifier: 3, clientX: 180, clientY: 130 }] });
    await workspace.dispatchEvent("touchend", { changedTouches: [{ identifier: 3, clientX: 180, clientY: 130 }] });
    await expect(page.locator(".pull-to-refresh-indicator")).toHaveCount(0);
    await expectNoticeReadable(page, "offline notice while pull-to-refresh is suppressed");
  }
});

test("PER-5 routine cached refresh uses header status and never moves file rows", async ({ page }, testInfo) => {
  let holdRefresh = false;
  const gate = createGate();
  await page.route("**/api/files?path=Projects", async (route) => {
    if (holdRefresh) {
      await gate.promise;
    }
    await route.continue();
  });

  await connectAccount(page, "PER-5 routine refresh");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  holdRefresh = true;
  await page.getByRole("button", { name: /Open folder Projects/i }).click();

  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await expect(page.locator(".state-banner-slot .banner-state")).toHaveCount(0);
  if (testInfo.project.name === "mobile-chrome") {
    await expect(page.getByRole("status", { name: /Refreshing cached folder/i })).toBeVisible();
  } else {
    await expect(page.locator(".browser-status")).toContainText(/Refreshing/i);
  }

  const rowTopWhileRefreshing = await page.locator(".item-row").first().evaluate((element) => element.getBoundingClientRect().top);
  gate.release();
  await expect(page.locator(".state-banner-slot .banner-state")).toHaveCount(0);
  if (testInfo.project.name === "mobile-chrome") {
    await expect(page.getByRole("status", { name: /Refreshing cached folder/i })).toHaveCount(0);
  } else {
    await expect(page.locator(".browser-status")).toContainText(/Ready/i);
  }
  const rowTopAfterRefresh = await page.locator(".item-row").first().evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(rowTopAfterRefresh - rowTopWhileRefreshing)).toBeLessThanOrEqual(1);
});
