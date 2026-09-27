import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { connectAccount, createGate, getVisibleSelectionToolbar, openSettings, openWorkspaceAction, selectFileListEntry } from "./support/workspace";

function mutationEvidencePath(name: string): string {
  return resolve(process.cwd(), "../../.tmp/mutation-workspace-browser", name);
}

async function expectRailSelectionSummary(page: Page, countLabel: RegExp, selectionLabel: RegExp) {
  const detailsRail = page.locator("aside.workspace-rail");
  await expect(detailsRail.getByText(countLabel)).toBeVisible();
  await expect(detailsRail.getByText(selectionLabel)).toBeVisible();
}

test("folder view accepts drag-and-drop uploads", async ({ page }) => {
  await connectAccount(page, "Drop workspace");

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dragged content"], "dragged.txt", { type: "text/plain" }));
    return transfer;
  });

  const fileListPanel = page.locator(".file-list-panel");
  await fileListPanel.dispatchEvent("dragenter", { dataTransfer });
  await expect(fileListPanel).toHaveClass(/file-list-panel-drop-active/);
  await fileListPanel.dispatchEvent("drop", { dataTransfer });
  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 1 file into \/ via drag and drop/i);
  await expect(page.getByRole("button", { name: /Open file dragged.txt/i })).toBeVisible();
});

test("normal picker flow uploads multiple files in one action", async ({ page }, testInfo) => {
  await connectAccount(page, "Multi upload workspace");

  const files = [
    { name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") },
    { name: "beta.txt", mimeType: "text/plain", buffer: Buffer.from("beta") }
  ];
  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByLabel("Upload files from navigation menu").setInputFiles(files);
  } else {
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByLabel("Upload files", { exact: true }).click();
    const chooser = await fileChooser;
    await chooser.setFiles(files);
  }

  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 2 files into \//i);
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file beta.txt/i })).toBeVisible();
});

test("normal picker flow uploads directories while preserving nested relative paths", async ({ page }) => {
  await connectAccount(page, "Folder upload workspace");

  await page.locator('input[aria-label="Upload folder"]').setInputFiles("tests/fixtures/folder-upload/Mixtape");

  await expect(page.locator(".browse-status-note")).toHaveText(/Uploaded 2 files from 1 folder into \//i);
  await page.getByRole("button", { name: /Open folder Mixtape/i }).click();
  await expect(page.getByRole("button", { name: /Open folder assets/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file track.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder assets/i }).click();
  await expect(page.getByRole("button", { name: /Open file cover.txt/i })).toBeVisible();
});

test("batch download zips a mixed file and folder selection in one workflow", async ({ page }) => {
  await connectAccount(page, "Selection download workspace");

  await page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);

  const downloadPromise = page.waitForEvent("download");
  const selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await selectionToolbar.getByRole("button", { name: /^Download$/i }).click();
  } else {
    await page.getByRole("button", { name: /^Download selected$/i }).first().click();
  }
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("davora-home-download.zip");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const zipBuffer = await readFile(downloadPath!);
  const zip = await JSZip.loadAsync(zipBuffer);

  expect(Object.keys(zip.files).sort()).toEqual([
    "Archive/",
    "Archive/guide.pdf",
    "Archive/image.bin",
    "Archive/photo.heic",
    "Archive/photo.png",
    "alpha.txt"
  ]);
});

test("partial batch download keeps the failed path in the transfer tray", async ({ page }) => {
  await page.route("**/api/download?path=Archive%2Fimage.bin", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ data: { code: "temporary_failure", message: "Failed to fetch image.bin" } })
    });
  });

  await connectAccount(page, "Partial batch download workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha")
  });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);

  const downloadPromise = page.waitForEvent("download");
  const selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await selectionToolbar.getByRole("button", { name: /^Download$/i }).click();
  } else {
    await page.getByRole("button", { name: /^Download selected$/i }).first().click();
  }
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("davora-home-download.zip");

  const transferTray = page.getByRole("button", { name: "Transfers" });
  await transferTray.click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  const partialTransfer = transferStatus.locator(".transfer-tray-item-partial");
  await expect(partialTransfer).toHaveCount(1);
  await expect(partialTransfer.getByText(/^Partial/)).toBeVisible();
  await expect(partialTransfer.getByText(/Downloaded 4 of 5 files; 1 failed/i)).toBeVisible();
  const failedFiles = partialTransfer.getByRole("list", { name: /Failed files for davora-home-download\.zip/i });
  await expect(failedFiles.getByText("Archive/image.bin", { exact: true })).toBeVisible();
  await expect(failedFiles.getByText("Failed to fetch image.bin", { exact: true })).toBeVisible();
});

test("selection mode is the multi-item action surface", async ({ page }) => {
  await connectAccount(page, "Selection actions workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);

  const selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await expect(selectionToolbar.getByText(/2 items selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /2 items selected/i, /1 file and 1 folder/i);
  }
  await expect(page.getByRole("button", { name: /Add batch/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove batch/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download batch/i })).toHaveCount(0);

  if (selectionToolbar) {
    await selectionToolbar.getByRole("button", { name: /^Delete$/i }).click();
  } else {
    await page.getByRole("button", { name: /^Delete selected$/i }).first().click();
  }

  const dialog = page.getByRole("dialog", { name: /Delete 2 items/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Archive")).toBeVisible();
  await expect(dialog.getByText("alpha.txt")).toBeVisible();
  await expect(dialog.getByLabel(/Name to confirm/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: /^Delete$/i }).click();

  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toHaveCount(0);
});

test("batch delete keeps exact partial state and retries only the unresolved target", async ({ page }) => {
  const deletePaths: string[] = [];
  let alphaAttempts = 0;
  await page.route("**/api/delete", async (route) => {
    const body = route.request().postDataJSON() as { path: string };
    deletePaths.push(body.path);
    if (body.path === "alpha.txt" && ++alphaAttempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "mutation_failed", message: "alpha delete failed once" } })
      });
      return;
    }
    await route.fallback();
  });

  await connectAccount(page, "Batch delete retry workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha")
  });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();
  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);
  const toolbar = await getVisibleSelectionToolbar(page);
  if (toolbar) {
    await toolbar.getByRole("button", { name: /^Delete$/i }).click();
  } else {
    await page.getByRole("button", { name: /^Delete selected$/i }).first().click();
  }
  await page.getByRole("dialog", { name: /Delete 2 items/i }).getByRole("button", { name: /^Delete$/i }).click();

  const retryDialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(retryDialog).toBeVisible();
  await expect(retryDialog.getByText("alpha.txt", { exact: true })).toBeVisible();
  await expect(retryDialog.getByText("Archive", { exact: true })).toHaveCount(0);
  await expect(retryDialog.getByText("alpha delete failed once", { exact: true })).toBeVisible();
  expect(deletePaths).toEqual(["Archive", "alpha.txt"]);

  await retryDialog.getByRole("button", { name: /^Delete$/i }).click();
  await expect(retryDialog).toHaveCount(0);
  expect(deletePaths).toEqual(["Archive", "alpha.txt", "alpha.txt"]);
});

test("invalid self or descendant destination never issues copy or move requests", async ({ page }) => {
  let copyRequests = 0;
  let moveRequests = 0;
  await page.route("**/api/copy", async (route) => { copyRequests += 1; await route.fallback(); });
  await page.route("**/api/move", async (route) => { moveRequests += 1; await route.fallback(); });

  await connectAccount(page, "Invalid destination workspace");
  await page.getByRole("button", { name: /Open actions for Archive/i }).click();
  await page.getByRole("region", { name: /Details for Archive/i }).getByRole("button", { name: /Copy or move/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await dialog.getByRole("button", { name: /Open destination folder Archive/i }).click();

  await expect(dialog.getByText(/Folders cannot be moved or copied into themselves or their descendants/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /^Move here$/i })).toBeDisabled();
  expect(copyRequests).toBe(0);
  expect(moveRequests).toBe(0);
});

test("mutation dialogs dismiss by scrim and Back while stale create completion cannot affect a replacement", async ({ page }) => {
  const gate = createGate();
  let createRequests = 0;
  await page.route("**/api/folders", async (route) => {
    createRequests += 1;
    if (createRequests !== 1) {
      await route.fallback();
      return;
    }
    await gate.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { result: {
        action: "createFolder", parentPath: "", path: "Late folder",
        item: { path: "Late folder", name: "Late folder", isFolder: true }
      } } })
    });
  });

  await connectAccount(page, "Mutation dismissal workspace");
  await openWorkspaceAction(page, /Create folder/i);
  await page.locator(".modal-scrim").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog", { name: /Create folder/i })).toHaveCount(0);

  await openWorkspaceAction(page, /Create folder/i);
  await page.goBack();
  await expect(page.getByRole("dialog", { name: /Create folder/i })).toHaveCount(0);

  await openWorkspaceAction(page, /Create folder/i);
  const pendingDialog = page.getByRole("dialog", { name: /Create folder/i });
  await pendingDialog.getByLabel("Folder name").fill("Late folder");
  await pendingDialog.getByRole("button", { name: /Create folder/i }).click();
  await expect.poll(() => createRequests).toBe(1);
  await page.goBack();
  await expect(pendingDialog).toHaveCount(0);
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page).toHaveURL(/path=Projects/);
  await openWorkspaceAction(page, /Create folder/i);
  const replacement = page.getByRole("dialog", { name: /Create folder/i });
  await replacement.getByLabel("Folder name").fill("Replacement folder");

  gate.release();
  await expect(replacement).toBeVisible();
  await expect(replacement.getByLabel("Folder name")).toHaveValue("Replacement folder");
  await expect(page.getByText(/createFolder completed for \/Late folder/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open folder Late folder/i })).toHaveCount(0);
});

test("PER-84 copies a mixed selection through the mobile destination picker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "PER-84 narrow selection controls are mobile-specific.");
  await page.setViewportSize({ width: 360, height: 640 });
  await connectAccount(page, "PER-84 batch copy workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);

  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  await expect(toolbar).toBeVisible();
  const actionNames = [/^Download$/i, /^Keep offline$/i, /^Copy or move selected$/i, /^Delete$/i, /^Clear$/i];
  for (const name of actionNames) {
    const action = toolbar.getByRole("button", { name });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
  }

  await toolbar.getByRole("button", { name: /^Copy or move selected$/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move 2 items/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/2 selected items/i)).toBeVisible();
  await expect(dialog.getByLabel(/Destination name/i)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Move here$/i })).toBeVisible();

  await dialog.getByRole("button", { name: /Open destination folder Archive/i }).click();
  await expect(dialog.getByText(/selected folders cannot be moved or copied into themselves or their descendants/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Move here$/i })).toBeDisabled();
  await dialog.getByRole("button", { name: /Home/i }).click();
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeEnabled();
  await dialog.getByRole("button", { name: /^Copy here$/i }).click();

  const conflictDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole("button", { name: /Keep both for all/i }).click();
  await conflictDialog.getByRole("button", { name: /Copy with these choices/i }).click();

  await expect(conflictDialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Copy or move 2 items/i })).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: /Selection actions/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open folder Archive \(1\)/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file alpha \(1\)\.txt/i })).toBeVisible();
});

test("mobile batch copy retries transient failures in place and retains permanent failures for tray retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Batch mutation surface evidence is mobile-specific.");
  await page.setViewportSize({ width: 360, height: 640 });

  const copySources: string[] = [];
  const failedOnce = new Set(["alpha.txt"]);
  const attempts = new Map<string, number>();
  let archiveBlocked = true;
  await page.route("**/api/copy", async (route) => {
    const request = route.request().postDataJSON() as { path: string };
    copySources.push(request.path);
    const attempt = (attempts.get(request.path) ?? 0) + 1;
    attempts.set(request.path, attempt);
    if ((request.path === "Archive" && archiveBlocked) || (failedOnce.has(request.path) && attempt === 1)) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "mutation_failed", message: `${request.path} copy failed` } })
      });
      return;
    }
    await route.fallback();
  });

  await connectAccount(page, "Mobile batch retry workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha")
  });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select Design folder/i, /Open folder Design/i);
  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);
  const toolbar = page.getByRole("toolbar", { name: /Selection actions/i });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: /^Copy or move selected$/i }).click();

  const dialog = page.getByRole("dialog", { name: /Copy or move 3 items/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".destination-source-paths")).toHaveText("Archive, Design, alpha.txt");
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeEnabled();
  await dialog.screenshot({ path: mutationEvidencePath("mobile-batch-copy-picker-before-submit.png") });

  await dialog.getByRole("button", { name: /^Copy here$/i }).click();
  const conflictDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole("button", { name: /Keep both for all/i }).click();
  await conflictDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect(page.getByRole("dialog", { name: /Copy or move/i })).toHaveCount(0);

  await expect(page.locator(".browse-status-note")).toContainText(/Copied 2 of 3 selected items; 1 failed in Mobile batch retry workspace\./i);
  expect(copySources).toEqual(["Archive", "Archive", "Archive", "Archive", "Design", "alpha.txt", "alpha.txt"]);
  const retainedToolbar = await getVisibleSelectionToolbar(page);
  if (retainedToolbar) {
    await expect(retainedToolbar.getByText(/1 item selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /1 item selected/i, /^1 folder$/i);
  }
  await page.screenshot({ path: mutationEvidencePath("mobile-batch-copy-partial-failure.png"), fullPage: false });

  archiveBlocked = false;
  await page.getByRole("button", { name: "Transfers" }).click();
  const transferTray = page.getByRole("dialog", { name: "Transfer status" });
  await expect(transferTray).toBeVisible();
  await expect(transferTray.getByText(/Archive copy failed/i)).toBeVisible();
  await transferTray.getByRole("button", { name: "Retry" }).click();

  await expect(page.locator(".browse-status-note")).toContainText(/Copied 1 selected item to \/ in Mobile batch retry workspace\./i);
  await expect(toolbar).toHaveCount(0);
  expect(copySources).toEqual(["Archive", "Archive", "Archive", "Archive", "Design", "alpha.txt", "alpha.txt", "Archive"]);
  await page.screenshot({ path: mutationEvidencePath("mobile-batch-copy-retry-complete.png"), fullPage: false });
});

test("batch copy runs as a background transfer task that can be canceled from the tray", async ({ page }) => {
  const copyGate = createGate();
  let copyRequests = 0;
  await page.route("**/api/copy", async (route) => {
    copyRequests += 1;
    await copyGate.promise;
    await route.fallback();
  });

  await connectAccount(page, "Cancelable copy workspace");
  await selectFileListEntry(page, /Select Archive folder/i, /Open folder Archive/i);
  await selectFileListEntry(page, /Select Design folder/i, /Open folder Design/i);

  const copyOrMoveButton = page.getByRole("button", { name: /^Copy or move selected$/i }).first();
  await expect(copyOrMoveButton).toBeVisible();
  await copyOrMoveButton.click();

  const dialog = page.getByRole("dialog", { name: /Copy or move 2 items/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Copy here$/i })).toBeEnabled();
  await dialog.getByRole("button", { name: /^Copy here$/i }).click();

  const conflictDialog = page.getByRole("dialog", { name: "Resolve destination conflicts" });
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole("button", { name: /Keep both for all/i }).click();
  await conflictDialog.getByRole("button", { name: /Copy with these choices/i }).click();
  await expect(page.getByRole("dialog", { name: /Copy or move/i })).toHaveCount(0);
  await expect.poll(() => copyRequests).toBe(1);

  await page.getByRole("button", { name: "Transfers" }).click();
  const transferTray = page.getByRole("dialog", { name: "Transfer status" });
  await expect(transferTray).toBeVisible();
  await expect(transferTray.getByText(/Copying/i)).toBeVisible();
  await transferTray.getByRole("button", { name: /Cancel 2 items/i }).click();

  copyGate.release();
  await expect(page.locator(".browse-status-note")).toContainText(/Copy canceled after 0 of 2 items in Cancelable copy workspace\./i);
  await expect(transferTray.getByText("Canceled", { exact: true })).toBeVisible();
  expect(copyRequests).toBe(1);
  await page.screenshot({ path: mutationEvidencePath("batch-copy-canceled.png"), fullPage: false });
});

test("desktop deferred copy task is superseded when the same-account session is replaced", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Deferred mutation replacement evidence is desktop-specific.");

  const copyGate = createGate();
  let copyRequests = 0;
  let sessionRequests = 0;
  let settleOldCopy!: () => void;
  const oldCopySettled = new Promise<void>((resolve) => {
    settleOldCopy = resolve;
  });
  await page.route("**/api/session", async (route) => {
    sessionRequests += 1;
    await route.fallback();
  });
  await page.route("**/api/copy", async (route) => {
    copyRequests += 1;
    await copyGate.promise;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { result: {
          action: "copy", parentPath: "", path: "Archive", destinationPath: "Archive (1)"
        } } })
      });
    } catch {
      // The old request may already be aborted by replacement ownership.
    } finally {
      settleOldCopy();
    }
  });

  await connectAccount(page, "Desktop deferred copy workspace");
  await page.getByRole("button", { name: /Open actions for Archive/i }).click();
  await page.getByRole("region", { name: /Details for Archive/i }).getByRole("button", { name: /Copy or move/i }).click();
  const picker = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: /^Copy here$/i })).toBeEnabled();
  await picker.screenshot({ path: mutationEvidencePath("desktop-deferred-copy-before-submit.png") });

  await picker.getByRole("button", { name: /Manual path/i }).click();
  await picker.getByLabel("Full destination path").fill("Projects/Archive");
  await picker.getByRole("button", { name: /^Copy here$/i }).click();
  await expect(picker).toHaveCount(0);
  await expect.poll(() => copyRequests).toBe(1);
  await page.screenshot({ path: mutationEvidencePath("desktop-deferred-copy-pending.png"), fullPage: false });

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /^Reconnect$/i }).click();
  const reconnectDialog = page.getByRole("dialog", { name: /Reconnect account/i });
  await reconnectDialog.getByLabel("App password").fill("replacement-session-password");
  await reconnectDialog.getByRole("button", { name: /Reconnect account/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect.poll(() => sessionRequests).toBe(2);

  copyGate.release();
  await oldCopySettled;
  await expect(page.getByRole("dialog", { name: /Copy or move item/i })).toHaveCount(0);
  await expect(page.getByText(/Session expired\. Create a fresh session for this account\./i)).toHaveCount(0);
  await expect(page.locator(".browse-status-note")).not.toContainText(/Copied|Moved/i);
  expect(copyRequests).toBe(1);
  await page.screenshot({ path: mutationEvidencePath("desktop-deferred-copy-session-replaced.png"), fullPage: false });
});

test("selection mode toggles file and folder rows without opening them", async ({ page }) => {
  await connectAccount(page, "Row tap selection workspace");
  await page.getByLabel("Upload files", { exact: true }).setInputFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();

  await selectFileListEntry(page, /Select alpha.txt file/i, /Open file alpha.txt/i);
  let selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await expect(selectionToolbar.getByText(/1 item selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /1 item selected/i, /^1 file$/i);
  }

  await page.getByRole("button", { name: /Open actions for Archive/i }).click();
  selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await expect(selectionToolbar.getByText(/1 item selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /1 item selected/i, /^1 file$/i);
  }

  await page.getByRole("button", { name: /Select Archive folder/i }).click();
  selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await expect(selectionToolbar.getByText(/2 items selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /2 items selected/i, /1 file and 1 folder/i);
  }
  await expect(page.getByRole("button", { name: /Deselect Archive folder/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file guide.pdf/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Deselect Archive folder/i }).click();
  selectionToolbar = await getVisibleSelectionToolbar(page);
  if (selectionToolbar) {
    await expect(selectionToolbar.getByText(/1 item selected/i)).toBeVisible();
  } else {
    await expectRailSelectionSummary(page, /1 item selected/i, /^1 file$/i);
  }

  await page.getByRole("button", { name: /Deselect alpha.txt file/i }).click();
  await expect(page.getByText(/item selected/i)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Preview alpha.txt/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await expect(page.getByRole("button", { name: /Open file guide.pdf/i })).toBeVisible();
});

test("mutation flow still works for the active account", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chrome";
  await connectAccount(page, "Mutation workspace");

  if (isMobile) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Create folder/i }).click();
  } else {
    await page.getByRole("button", { name: /Create folder/i }).click();
  }
  const createDialog = page.getByRole("dialog", { name: /Create folder/i });
  await createDialog.getByLabel("Folder name").fill("Playwright Folder");
  await createDialog.getByRole("button", { name: /Create folder/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Playwright Folder/i })).toBeVisible();
  const closeItemActions = page.getByRole("button", { name: /Close item actions/i });
  if (await closeItemActions.isVisible()) {
    await closeItemActions.click();
  }
  await page.getByRole("button", { name: /Open folder Playwright Folder/i }).click();

  if (isMobile) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByRole("complementary", { name: /Navigation menu/i }).getByLabel("Upload files from navigation menu").setInputFiles({
      name: "draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("draft via playwright")
    });
  } else {
    await page.getByLabel("Upload files", { exact: true }).setInputFiles({
      name: "draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("draft via playwright")
    });
  }
  await expect(page.getByRole("button", { name: /Open file draft.txt/i })).toBeVisible();

  if (isMobile) {
    const openActionsButton = page.getByRole("button", { name: /Open actions for draft.txt/i });
    if (await openActionsButton.isVisible()) {
      await openActionsButton.click();
    }
    await page.getByRole("button", { name: /Rename or move/i }).click();
  } else {
    await page.getByRole("button", { name: /Rename or move/i }).click();
  }

  const moveDialog = page.getByRole("dialog", { name: /Move item/i });
  await moveDialog.getByRole("button", { name: /Go to home folder/i }).click();
  await moveDialog.getByLabel("Destination name").fill("renamed.txt");
  await expect(moveDialog.getByRole("button", { name: /Move here/i })).toBeEnabled();
  await moveDialog.getByRole("button", { name: /Move here/i }).click();
  await expect(moveDialog).toHaveCount(0);
  await expect(page.locator(".browse-status-note")).toContainText(/Moved 1 selected item to \/renamed\.txt in Mutation workspace\./i);
  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await expect(page.getByRole("button", { name: /Open file renamed.txt/i })).toBeVisible();
});

test("mobile delete confirmation does not require typing long non-Latin target names", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
  const longFileName = "Документи-and-a-very-long-delete-target-name-100%.txt";
  const longPath = `Projects/${longFileName}`;
  let deleteRequest: unknown;
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
  await page.route("**/api/delete", async (route) => {
    deleteRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { result: { action: "delete", parentPath: "Projects", path: longPath } } })
    });
  });

  await connectAccount(page, "Delete confirmation workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  await page.getByRole("region", { name: `Details for ${longFileName}` }).getByRole("button", { name: /^Delete$/i }).click();

  const dialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("This permanently deletes the selected item from the server.")).toBeVisible();
  await expect(dialog.getByText(longPath)).toBeVisible();
  await expect(dialog.getByLabel(/Name to confirm/i)).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button")).toHaveText(["Cancel", "Delete"]);

  await dialog.getByRole("button", { name: /^Delete$/i }).click();
  await expect.poll(() => deleteRequest).toEqual({ path: longPath, confirmName: longFileName });
});

test("PER-68 keeps compact copy and move controls reachable with long Unicode paths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only PER-68 UX check.");
  await page.setViewportSize({ width: 360, height: 640 });
  const longFileName = "Документи-and-a-very-long-copy-move-target-name-100%.txt";
  const longPath = `Projects/${longFileName}`;
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/Архів 100% довга назва", name: "Архів 100% довга назва", isFolder: true },
            { path: longPath, name: longFileName, isFolder: false, size: 1048576, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/files?path=Projects%2F*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { path: "Projects/Архів 100% довга назва", items: [] } })
    });
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

  await connectAccount(page, "PER-68 compact picker workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  await page.getByRole("region", { name: `Details for ${longFileName}` }).getByRole("button", { name: /Copy or move/i }).click();

  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(dialog.locator(".destination-summary")).toContainText(longPath);
  await expect(dialog.locator(".destination-resolved")).toHaveCount(0);
  await expect(dialog.getByText(/Choose a destination folder, keep or edit/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: /Open destination folder Архів 100% довга назва/i }).click();
  await expect(dialog.getByLabel("Destination name")).toHaveValue(longFileName);

  const refresh = dialog.getByRole("button", { name: /Refresh destination folders/i });
  const manualPath = dialog.getByRole("button", { name: /^Manual path$/i });
  const actions = [
    dialog.getByRole("button", { name: /^Cancel$/i }),
    dialog.getByRole("button", { name: /^Copy here$/i }),
    dialog.getByRole("button", { name: /^Move here$/i })
  ];
  await expectInViewport(refresh);
  await manualPath.scrollIntoViewIfNeeded();
  await expectInViewport(manualPath);
  for (const action of actions) {
    await expectInViewport(action);
    await expect(action).toHaveCSS("min-height", "44px");
  }

  await manualPath.click();
  const fullPath = dialog.getByLabel("Full destination path");
  await fullPath.scrollIntoViewIfNeeded();
  await expectInViewport(fullPath);
  for (const action of actions) {
    await expectInViewport(action);
  }
  await expect(dialog.locator(".destination-picker-scroll")).toHaveCSS("overflow-y", "auto");
});
