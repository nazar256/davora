import { expect, test, type Page } from "@playwright/test";

import {
  activateWithKeyboard,
  expectDialogFocusContainment,
  expectNoSeriousAccessibilityViolations,
  expectVisibleKeyboardFocus
} from "./support/accessibility";
import { connectAccount, openSettings, openWorkspaceAction, selectFileListEntry } from "./support/workspace";

async function expectDialogAccessible(page: Page, name: RegExp, surface: string) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expectNoSeriousAccessibilityViolations(page, surface);
  return dialog;
}

test.beforeEach(async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  expect(response.ok()).toBe(true);
});

test("onboarding, reconnect, and unlock gates retain semantic names and keyboard focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "zero-account onboarding");

  await activateWithKeyboard(page, page.getByRole("button", { name: /^Connect account$/i }));
  const baseUrl = page.getByLabel("Base URL");
  await expectVisibleKeyboardFocus(page, baseUrl, "onboarding base URL field");
  await expectNoSeriousAccessibilityViolations(page, "inline connect account form");

  await connectAccount(page, "Accessibility reconnect workspace");
  await expectNoSeriousAccessibilityViolations(page, "connected workspace after account creation");

  const resetResponse = await page.request.post(`${new URL(page.url()).origin.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  expect(resetResponse.ok()).toBe(true);
  await page.reload();
  const reconnectHeading = page.getByRole("heading", { name: /Reconnect Accessibility reconnect workspace/i });
  await expect(reconnectHeading).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "reconnect gate");
  await expectVisibleKeyboardFocus(page, page.getByLabel("App password"), "reconnect password field");
});

test("unlock gate keeps its error state and successful keyboard form path accessible", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          app: "davora",
          configLoaded: true,
          backend: "mock",
          rootPath: ".davora-agent-test",
          unlockRequired: true,
          connectionMode: "in_app",
          supportedAccountTypes: ["nextcloud"]
        }
      })
    });
  });
  await page.route("**/api/session", async (route) => {
    const payload = route.request().postDataJSON() as { unlockCode?: string };
    if (payload.unlockCode !== "open-sesame") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "invalid_unlock_code", message: "Unlock code is invalid." } })
      });
      return;
    }
    await route.fallback();
  });

  await connectAccount(page, "Accessibility unlock workspace", { waitForWorkspace: false });
  const unlock = page.getByRole("heading", { name: /Unlock required/i });
  await expect(unlock).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "unlock gate");
  await expectVisibleKeyboardFocus(page, page.getByLabel("Unlock code"), "unlock code field");
  await page.getByLabel("Unlock code").fill("wrong");
  await page.getByRole("button", { name: /Unlock and connect/i }).press("Enter");
  await expect(page.getByText(/Unlock code is invalid/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "unlock error");
  await page.getByLabel("Unlock code").fill("open-sesame");
  await page.getByRole("button", { name: /Unlock and connect/i }).press("Enter");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "unlocked workspace");
});

test("connected browsing, drawer, breadcrumbs, search, and selection remain keyboard accessible", async ({ page }, testInfo) => {
  await connectAccount(page, "Accessibility browsing workspace");
  await expectNoSeriousAccessibilityViolations(page, "connected root browsing");

  const navigationButton = page.getByRole("button", { name: /Open navigation menu/i });
  await activateWithKeyboard(page, navigationButton);
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await expect(drawer).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "navigation drawer");
  await page.goBack();
  await expect(drawer).toHaveCount(0);

  const searchButton = page.getByRole("button", { name: /Open search/i });
  if (testInfo.project.name === "mobile-chrome") {
    await activateWithKeyboard(page, searchButton);
    await expectVisibleKeyboardFocus(page, page.getByPlaceholder("Search files", { exact: true }), "mobile search field");
    await expectNoSeriousAccessibilityViolations(page, "mobile search");
    await page.getByRole("button", { name: /Close search/i }).click();
  } else {
    const search = page.getByPlaceholder("Search files and folders");
    await expectVisibleKeyboardFocus(page, search, "desktop search field");
    await search.fill("roadmap");
    await expectNoSeriousAccessibilityViolations(page, "desktop search");
    await page.getByRole("button", { name: /Clear search/i }).click();
  }

  const projects = page.getByRole("button", { name: /Open folder Projects/i });
  await activateWithKeyboard(page, projects);
  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" })).toBeVisible();
  } else {
    await expectVisibleKeyboardFocus(page, page.getByRole("button", { name: /Go up one folder level/i }), "mobile parent-folder control");
  }
  await expectNoSeriousAccessibilityViolations(page, "breadcrumbs and folder contents");

  const checkbox = page.getByRole("checkbox", { name: /Select roadmap\.txt file/i });
  if (testInfo.project.name === "desktop-chrome") {
    await expectVisibleKeyboardFocus(page, checkbox, "file selection checkbox");
    await page.keyboard.press("Space");
  } else {
    await selectFileListEntry(page, /Select roadmap\.txt file/i, /Open file roadmap\.txt/i);
  }
  await expectNoSeriousAccessibilityViolations(page, "selection details");
});

test("settings, account/remove, mutation, transfer, and explicit-offline surfaces expose usable dialogs", async ({ page }, testInfo) => {
  await connectAccount(page, "Accessibility operations workspace");

  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByLabel("Upload files from navigation menu").setInputFiles({
      name: "accessibility-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("accessible upload")
    });
  } else {
    await page.getByLabel("Upload files", { exact: true }).setInputFiles({
      name: "accessibility-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("accessible upload")
    });
  }
  await expect(page.getByRole("button", { name: /Open file accessibility-upload\.txt/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "completed upload flow");
  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible()) {
    await closeItemActions.click();
  }

  await openSettings(page);
  const settings = await expectDialogAccessible(page, /Profile and settings/i, "settings dialog");
  await expectVisibleKeyboardFocus(page, settings.getByRole("button", { name: /Close|Done/i }), "settings close control");
  await expectDialogFocusContainment(page, settings, "settings dialog");
  await settings.getByRole("button", { name: /Add account/i }).click();
  const add = await expectDialogAccessible(page, /Add account/i, "add-account dialog");
  await expectDialogFocusContainment(page, add, "add-account dialog");
  await page.keyboard.press("Escape");
  await expect(add).toHaveCount(0);
  await openSettings(page);
  const settingsForRemove = await expectDialogAccessible(page, /Profile and settings/i, "settings before removal");
  await settingsForRemove.getByRole("button", { name: /^Remove$/i }).click();
  const remove = await expectDialogAccessible(page, /Remove Accessibility operations workspace/i, "remove-account dialog");
  await expectDialogFocusContainment(page, remove, "remove-account dialog");
  await page.goBack();
  await expect(remove).toHaveCount(0);
  await openSettings(page);
  const settingsForClose = await expectDialogAccessible(page, /Profile and settings/i, "settings before close");
  await settingsForClose.getByRole("button", { name: /Close|Done/i }).click();

  await openWorkspaceAction(page, /Create folder/i);
  const create = await expectDialogAccessible(page, /Create folder/i, "create-folder dialog");
  await expectVisibleKeyboardFocus(page, create.getByLabel("Folder name"), "create-folder field");
  await expectDialogFocusContainment(page, create, "create-folder dialog");
  await page.goBack();
  await expect(create).toHaveCount(0);

  await page.getByRole("button", { name: /Open actions for Archive/i }).click();
  const details = page.getByRole("region", { name: /Details for Archive/i });
  await details.getByRole("button", { name: /Copy or move/i }).click();
  const destination = await expectDialogAccessible(page, /Copy or move item/i, "copy-move destination dialog");
  await expectVisibleKeyboardFocus(page, destination.getByRole("button", { name: /Cancel/i }), "destination cancel control");
  await expectDialogFocusContainment(page, destination, "copy-move destination dialog");
  await page.goBack();
  await expect(destination).toHaveCount(0);

  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: /Close actions for Archive/i }).click();
  }
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: /^Delete$/i }).click();
  const deletion = await expectDialogAccessible(page, /Delete item/i, "delete dialog");
  await expectDialogFocusContainment(page, deletion, "delete dialog");
  await page.goBack();
  await expect(deletion).toHaveCount(0);

  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("region", { name: /Details for Projects/i }).getByRole("button", { name: /^Keep offline$/i }).click();
  const offlineConfirm = await expectDialogAccessible(page, /Keep offline confirmation/i, "offline confirmation dialog");
  await expectDialogFocusContainment(page, offlineConfirm, "offline confirmation dialog");
  await offlineConfirm.getByRole("button", { name: /Start sync/i }).click();
  const transfers = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transfers).toBeVisible();
  await expect(transfers).not.toHaveAttribute("aria-modal", "true");
  await expectNoSeriousAccessibilityViolations(page, "transfer tray");
  await transfers.getByRole("button", { name: /Close/i }).click();

  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  const drawer = page.getByRole("complementary", { name: /Navigation menu/i });
  await drawer.getByRole("button", { name: /Go offline/i }).click();
  await expect(page.getByText(/Explicit offline mode is active/i)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "explicit offline mode");
});

test("image, PDF, video, and audio preview surfaces retain names, controls, and keyboard activation", async ({ page }, testInfo) => {
  await connectAccount(page, "Accessibility preview workspace");

  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  const photoInvoker = page.getByRole("button", { name: /Open file photo\.png/i });
  await photoInvoker.click();
  const imagePreview = await expectDialogAccessible(page, /Preview photo\.png/i, "image preview");
  await expectVisibleKeyboardFocus(page, imagePreview.getByRole("button", { name: /Back to files/i }), "image preview back control");
  await expectDialogFocusContainment(page, imagePreview, "image preview dialog");
  await page.keyboard.press("Escape");
  await expect(imagePreview).toHaveCount(0);
  await expectVisibleKeyboardFocus(page, photoInvoker, "photo invoker after Escape dismissal");
  await page.getByRole("button", { name: /Open file guide\.pdf/i }).click();
  const pdfPreview = await expectDialogAccessible(page, /Preview guide\.pdf/i, "PDF preview");
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Back to files/i }).click();

  if (testInfo.project.name === "desktop-chrome") {
    await page.getByRole("button", { name: /Go to home folder/i }).click();
  } else {
    await page.getByRole("button", { name: /Go up one folder level/i }).click();
  }
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip\.mp4/i }).click();
  const videoPreview = await expectDialogAccessible(page, /Preview clip\.mp4/i, "video preview");
  await expect(videoPreview.getByRole("group", { name: /Video navigation/i })).toBeVisible();
  await videoPreview.getByRole("button", { name: /Back to files/i }).click();

  await page.getByRole("button", { name: /Open file song\.mp3/i }).click();
  const audioPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
  await expect(audioPlayer).toBeVisible();
  await expectVisibleKeyboardFocus(page, audioPlayer.getByRole("button", { name: /Play folder audio/i }), "audio play control");
  await expectNoSeriousAccessibilityViolations(page, "folder audio player");
});
