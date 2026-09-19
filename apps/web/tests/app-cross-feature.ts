import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAccount, openSettings, selectFileListEntry } from "./support/workspace";






async function dispatchBeforeInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "dismissed") {
  await page.evaluate(async (nextOutcome) => {
    const installEvent = new Event("beforeinstallprompt");
    Object.defineProperty(installEvent, "prompt", {
      value: async () => undefined
    });
    Object.defineProperty(installEvent, "userChoice", {
      value: Promise.resolve({ outcome: nextOutcome })
    });
    window.dispatchEvent(installEvent);
  }, outcome);
}

test("PER-71 browser surfaces stay compact, themed, and truthful about offline availability", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chrome";
  await connectAccount(page, "PER-71 browser workspace");

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  const projectActions = page.getByRole("region", { name: /Details for Projects/i });
  await projectActions.getByRole("button", { name: /^Keep offline$/i }).click();
  await page.getByRole("dialog", { name: /Keep offline confirmation/i }).getByRole("button", { name: /Start sync/i }).click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText(/^Done/)).toBeVisible();
  await transferStatus.getByRole("button", { name: /Close transfer status/i }).click();
  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible().catch(() => false)) {
    await closeItemActions.click();
  }

  await expect(page.getByLabel("Projects is available offline")).toBeVisible();
  const archiveRow = page.getByRole("button", { name: /Open folder Archive/i }).locator("xpath=ancestor::div[contains(@class,'item-row')]");
  await expect(archiveRow.locator(".offline-availability")).toHaveCount(0);
  await expect(page.locator(".lucide-cloud, .lucide-cloud-download")).toHaveCount(0);
  await expect(page.locator(".bottom-tab-bar, .file-type-filter-chips")).toHaveCount(0);
  await expect(page.getByText(/Google Drive|Dropbox|OneDrive/i)).toHaveCount(0);

  for (const themeMode of ["light", "dark"] as const) {
    await page.evaluate((mode) => {
      const current = JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}");
      localStorage.setItem("davora-ui-settings", JSON.stringify({ ...current, themeMode: mode }));
    }, themeMode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeMode);
    await expect(page.getByLabel("Projects is available offline")).toBeVisible();
    const surface = await page.locator(".file-list-panel").evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      overflow: element.scrollWidth - element.clientWidth
    }));
    expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.color).not.toBe(surface.background);
    expect(surface.overflow).toBeLessThanOrEqual(1);
  }

  if (!isMobile) {
    const toolbarGeometry = await page.locator(".browse-header").evaluate((header) => {
      const uploadFolder = header.querySelector(".upload-label input[aria-label='Upload folder']")?.closest(".upload-label");
      const headerBox = header.getBoundingClientRect();
      const uploadBox = uploadFolder?.getBoundingClientRect();
      return {
        headerOverflow: header.scrollWidth - header.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        uploadRight: uploadBox?.right ?? Number.POSITIVE_INFINITY,
        headerRight: headerBox.right
      };
    });
    expect(toolbarGeometry.headerOverflow).toBeLessThanOrEqual(1);
    expect(toolbarGeometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(toolbarGeometry.uploadRight).toBeLessThanOrEqual(toolbarGeometry.headerRight + 1);
  }

  if (isMobile) {
    const listWidthBefore = await page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width);
    for (const control of [
      page.getByRole("button", { name: /Open navigation menu/i }),
      page.getByRole("button", { name: /Open search/i }),
      page.getByRole("button", { name: /Open sort options/i }),
      page.getByRole("button", { name: /^Transfers$/i }),
      page.getByRole("button", { name: /Open actions for Archive/i })
    ]) {
      const box = await control.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/^Folder$/)).toHaveCount(0);
    await expect(drawer.getByText(/^File$/)).toHaveCount(0);
    await drawer.getByRole("button", { name: /Close navigation menu/i }).click();
    await expect.poll(async () => page.locator(".file-list-panel").evaluate((element) => element.getBoundingClientRect().width)).toBe(listWidthBefore);

    await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
    const selectionToolbar = page.getByRole("toolbar", { name: /Selection actions/i });
    await expect(selectionToolbar).toBeVisible();
    const checkboxHitArea = await page.getByRole("checkbox", { name: /Deselect Archive folder/i }).locator("xpath=..").boundingBox();
    expect(checkboxHitArea?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(checkboxHitArea?.height ?? 0).toBeGreaterThanOrEqual(44);
    const actionBoxes = await selectionToolbar.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    }));
    actionBoxes.forEach((box) => {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    });
    for (let left = 0; left < actionBoxes.length; left += 1) {
      for (let right = left + 1; right < actionBoxes.length; right += 1) {
        const a = actionBoxes[left]!;
        const b = actionBoxes[right]!;
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
  }
});



test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});



test("account and mutation dialogs preserve scrim and Back dismissal parity", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Serialized desktop surface-dismissal characterization.");
  await connectAccount(page, "Dismissal parity workspace");

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /^Add account$/i }).click();
  const addDialog = page.getByRole("dialog", { name: /Add account/i });
  await expect(addDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(addDialog).toHaveCount(0);

  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /^Add account$/i }).click();
  const addDialogByBack = page.getByRole("dialog", { name: /Add account/i });
  await expect(addDialogByBack).toBeVisible();
  await page.goBack();
  await expect(addDialogByBack).toHaveCount(0);

  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /^Remove$/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Dismissal parity workspace/i });
  await expect(removeDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(removeDialog).toHaveCount(0);

  await openSettings(page);
  await page.getByRole("dialog", { name: /Profile and settings/i }).getByRole("button", { name: /^Remove$/i }).click();
  const removeDialogByBack = page.getByRole("dialog", { name: /Remove Dismissal parity workspace/i });
  await page.goBack();
  await expect(removeDialogByBack).toHaveCount(0);

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /^Keep offline$/i }).click();
  const offlineDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(offlineDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(offlineDialog).toHaveCount(0);

  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /^Delete$/i }).click();
  const deleteDialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(deleteDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(deleteDialog).toHaveCount(0);

  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Copy or move/i }).click();
  const destinationDialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(destinationDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(destinationDialog).toHaveCount(0);

  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /Copy or move/i }).click();
  const destinationDialogByBack = page.getByRole("dialog", { name: /Copy or move item/i });
  await page.goBack();
  await expect(destinationDialogByBack).toHaveCount(0);
});















test("PER-73 mobile forms, sheets, and dialogs keep primary actions reachable at 360x640", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only PER-73 UX check.");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 640 });
  const longFileName = `${"Документи-архів-".repeat(18)}100%.txt`;
  const longPath = `Projects/${longFileName}`;
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/Архів 100%", name: "Архів 100%", isFolder: true, lastModified: "2026-07-14T10:00:00.000Z" },
            { path: longPath, name: longFileName, isFolder: false, size: 1048576, mimeType: "text/plain", lastModified: "2026-07-14T10:00:00.000Z" }
          ]
        }
      })
    });
  });
  await page.route("**/api/files?path=Projects%2F*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { path: "Projects/Архів 100%", items: [] } })
    });
  });
  await page.route(`**/api/download?path=${encodeURIComponent(longPath)}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/plain", body: "PER-73 offline proof" });
  });

  const expectInViewport = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
  };

  await page.goto("/");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByText(/^Nextcloud$/i)).toBeVisible();
  await expect(page.getByText(/Google Drive|Dropbox|OneDrive/i)).toHaveCount(0);
  await expect(page.getByLabel("Root folder")).toHaveValue("");
  await expect(page.getByLabel("Root folder")).toHaveAttribute("placeholder", "Account root (/)");
  await expectInViewport(page.getByRole("button", { name: /^Connect account$/i }));
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill("per-73-mobile");
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill("PER-73 mobile workspace");
  await page.getByRole("button", { name: /^Connect account$/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  const sheet = page.getByRole("region", { name: `Details for ${longFileName}` });
  const ensureSheetVisible = async () => {
    if (await sheet.isVisible().catch(() => false)) {
      return;
    }
    const closeActions = page.getByRole("button", { name: `Close actions for ${longFileName}` });
    if (await closeActions.isVisible().catch(() => false)) {
      await closeActions.click();
    }
    if (!await sheet.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
    }
    await expect(sheet).toBeVisible();
  };
  await expect(sheet).toBeVisible();
  for (const buttonName of [/^Open$/i, /^Download$/i, /^Keep offline$/i, /^Delete$/i]) {
    await expect(sheet.getByRole("button", { name: buttonName })).toHaveCSS("min-height", "44px");
  }

  await sheet.getByRole("button", { name: /Copy or move/i }).click();
  const destinationDialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await destinationDialog.getByRole("button", { name: /Open destination folder Архів 100%/i }).click();
  await expect(destinationDialog.getByText("No folders in this destination.")).toHaveCSS("color", "rgb(82, 99, 131)");
  await expect(destinationDialog.locator(".destination-folder-list")).toHaveCSS("background-color", "rgb(249, 251, 255)");
  const destinationActions = [
    destinationDialog.getByRole("button", { name: /^Cancel$/i }),
    destinationDialog.getByRole("button", { name: /^Copy here$/i }),
    destinationDialog.getByRole("button", { name: /^Move here$/i })
  ];
  for (const action of destinationActions) {
    await expectInViewport(action);
    await expect(action).toHaveCSS("min-height", "44px");
  }
  const destinationBoxes = await Promise.all(destinationActions.map((action) => action.boundingBox()));
  expect(destinationBoxes[0]!.x + destinationBoxes[0]!.width).toBeLessThanOrEqual(destinationBoxes[1]!.x);
  expect(destinationBoxes[1]!.x + destinationBoxes[1]!.width).toBeLessThanOrEqual(destinationBoxes[2]!.x);
  await destinationActions[0].click();
  await ensureSheetVisible();

  await sheet.getByRole("button", { name: /View details/i }).click();
  const detailsScrollModel = await sheet.evaluate((element) => {
    const metadata = element.querySelector(".context-metadata") as HTMLElement;
    return {
      outerOverflow: getComputedStyle(element).overflowY,
      metadataOverflow: getComputedStyle(metadata).overflowY
    };
  });
  expect(detailsScrollModel).toEqual({ outerOverflow: "hidden", metadataOverflow: "auto" });
  await expectInViewport(sheet.getByRole("button", { name: /Back to actions/i }));
  await expectInViewport(sheet.getByRole("button", { name: /Close item actions/i }));
  await sheet.getByRole("button", { name: /Back to actions/i }).click();

  await sheet.getByRole("button", { name: /^Delete$/i }).click();
  const deleteDialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(deleteDialog.getByRole("textbox")).toHaveCount(0);
  await expect(deleteDialog.getByText(longPath)).toBeVisible();
  await expectInViewport(deleteDialog.getByRole("button", { name: /^Cancel$/i }));
  await expectInViewport(deleteDialog.getByRole("button", { name: /^Delete$/i }));
  await deleteDialog.getByRole("button", { name: /^Cancel$/i }).click();
  await ensureSheetVisible();

  await sheet.getByRole("button", { name: /^Keep offline$/i }).click();
  const offlineDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  const offlineBody = offlineDialog.locator(".dialog-scroll-body");
  const offlineActions = offlineDialog.locator(".dialog-actions");
  const scrollModel = await offlineDialog.evaluate((element) => {
    const body = element.querySelector(".dialog-scroll-body") as HTMLElement;
    const actions = element.querySelector(".dialog-actions") as HTMLElement;
    return {
      dialogOverflow: getComputedStyle(element).overflow,
      bodyOverflow: getComputedStyle(body).overflowY,
      bodyScrollable: body.scrollHeight > body.clientHeight,
      actionTop: actions.getBoundingClientRect().top,
      bodyBottom: body.getBoundingClientRect().bottom
    };
  });
  expect(scrollModel.dialogOverflow).toBe("hidden");
  expect(scrollModel.bodyOverflow).toBe("auto");
  expect(scrollModel.bodyScrollable).toBe(true);
  expect(scrollModel.bodyBottom).toBeLessThanOrEqual(scrollModel.actionTop);
  await expectInViewport(offlineDialog.getByRole("button", { name: /^Cancel$/i }));
  await expectInViewport(offlineDialog.getByRole("button", { name: /^Start sync$/i }));
  await offlineBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => offlineBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expectInViewport(offlineDialog.getByRole("button", { name: /^Cancel$/i }));
  await expectInViewport(offlineDialog.getByRole("button", { name: /^Start sync$/i }));
  await expect.poll(() => offlineActions.evaluate((element) => element.getBoundingClientRect().top)).toBe(scrollModel.actionTop);
  await offlineDialog.getByRole("button", { name: /^Start sync$/i }).click();
  const transferDialog = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferDialog.getByText(/^Done/)).toBeVisible();
  await expectInViewport(transferDialog);
  await expectInViewport(transferDialog.getByRole("button", { name: /Close transfer status/i }));
  await transferDialog.getByRole("button", { name: /Close transfer status/i }).click();
  await ensureSheetVisible();
  await sheet.getByRole("button", { name: /Close item actions/i }).click();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const themeGroup = settingsDialog.getByRole("group", { name: /Theme/i });
  for (const mode of ["System", "Light", "Dark"]) {
    await expectInViewport(themeGroup.getByRole("button", { name: mode }));
    await expect(themeGroup.getByRole("button", { name: mode })).toHaveCSS("min-height", "44px");
  }
  await expectInViewport(settingsDialog.getByRole("button", { name: /^Done$/i }));
});

test("mobile shell keeps account and status details behind profile and settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
  await connectAccount(page, "Install layout workspace");
  await dispatchBeforeInstallPrompt(page, "dismissed");

  const appBar = page.locator(".app-bar");
  const installButton = page.getByRole("button", { name: /Install app/i });
  await expect(installButton).toBeVisible();
  await expect(page.getByRole("button", { name: /Profile & settings/i })).toHaveCount(0);
  await expect(page.getByLabel("Active account")).toHaveCount(0);
  await expect(appBar.locator(".badge")).toHaveCount(0);
  await expect(appBar.locator(".app-bar-subtitle")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const appBarElement = document.querySelector(".app-bar") as HTMLElement | null;
    const fileListElement = document.querySelector(".file-list-panel") as HTMLElement | null;
    if (!appBarElement || !fileListElement) {
      return null;
    }

    const appBarBounds = appBarElement.getBoundingClientRect();
    const fileListBounds = fileListElement.getBoundingClientRect();
    return {
      appBarHeight: appBarBounds.height,
      gapToBrowse: fileListBounds.top - appBarBounds.bottom
    };
  });

  expect(layout).not.toBeNull();
  if (!layout) {
    return;
  }

  expect(layout.appBarHeight).toBeLessThan(90);
  expect(layout.gapToBrowse).toBeGreaterThanOrEqual(0);

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByLabel("Active account")).toHaveValue(/.+/);
  await expect(settingsDialog.getByText("Workspace status")).toBeVisible();
  await expect(settingsDialog.getByText(/^Online$/)).toBeVisible();
});
