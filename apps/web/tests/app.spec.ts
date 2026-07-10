import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

async function connectAccount(page: Page, label = "Mock workspace", options: { waitForWorkspace?: boolean } = {}) {
  const { waitForWorkspace = true } = options;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await page.getByRole("button", { name: /Connect account/i }).click();
  await page.getByLabel("Base URL").fill("https://mock-account.example.com");
  await page.getByLabel("Username").fill(label.toLowerCase().replace(/\s+/g, "-"));
  await page.getByLabel("App password").fill("mock-app-password");
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: /Connect account/i }).click();
  if (waitForWorkspace) {
    await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  }
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
}

async function renderMobilePreviewToolbarFixture(page: Page) {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <main style="position: relative; min-height: 844px; background: #0f172a;">
        <div class="preview-header-actions preview-header-actions-image" aria-label="Preview actions">
          <details class="preview-details-disclosure">
            <summary>Details</summary>
            <div class="preview-details-panel">Photo metadata</div>
          </details>
          <button class="quiet-button" type="button">Fit</button>
          <button class="quiet-button" type="button">100%</button>
          <button class="quiet-button" type="button">Open original</button>
          <button class="quiet-button" type="button">Download</button>
          <button class="quiet-button preview-dismiss-button" type="button">Back</button>
        </div>
      </main>
    `;
  });
}

test.beforeEach(async ({ request, baseURL }) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
});

test("first run connects an account and preserves the file-manager workspace", async ({ page }) => {
  await connectAccount(page, "Primary workspace");
  await expect(page.getByRole("button", { name: /Profile & settings/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("normalized API")).toBeVisible();
  await expect(preview.getByRole("button", { name: /Back to files/i })).toBeVisible();
  await expect(preview.getByRole("button", { name: /Close preview/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Offline cache/i })).toHaveCount(0);
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
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();

  await page.goBack();
  await expect(settingsDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open file roadmap.txt/i })).toBeVisible();
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

test("default dev server keeps PWA manifest, service worker control, and Chrome installability available", async ({ page, request, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop Chrome evidence only.");
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as { name: string; display: string; start_url: string; icons: Array<{ src: string }> };
  expect(manifest).toMatchObject({
    name: "Davora",
    display: "standalone",
    start_url: "/"
  });
  expect(manifest.icons.map((icon) => icon.src)).toEqual(expect.arrayContaining(["/pwa-192.png", "/pwa-512.png", "/pwa-512-maskable.png"]));

  const client = await context.newCDPSession(page);
  await client.send("Page.enable");
  const installability = await client.send("Page.getInstallabilityErrors") as { installabilityErrors?: Array<{ errorId?: string }> };
  const blockingErrors = (installability.installabilityErrors ?? []).filter((error) => error.errorId !== "in-incognito");
  expect(blockingErrors).toEqual([]);
});

test("reload restores workspace access instead of dropping into reconnect when account metadata survives", async ({ page }) => {
  await connectAccount(page, "Restore workspace");
  await page.evaluate(() => {
    const raw = localStorage.getItem("davora-account-state");
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as {
      activeAccountId?: string;
      accounts: Array<{ account: unknown; session?: unknown }>;
    };
    localStorage.setItem("davora-account-state", JSON.stringify({
      activeAccountId: parsed.activeAccountId,
      accounts: parsed.accounts.map((record) => ({ account: record.account }))
    }));
  });

  await page.reload();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Reconnect/i })).toHaveCount(0);
});

test("reload clears a stale reconnect-required browser flag once the worker session can be restored", async ({ page }) => {
  await connectAccount(page, "Reconnect recovery workspace");
  await page.evaluate(() => {
    const raw = localStorage.getItem("davora-account-state");
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as {
      activeAccountId?: string;
      accounts: Array<{ account: Record<string, unknown>; session?: unknown; pendingReconnect?: unknown }>;
    };

    localStorage.setItem("davora-account-state", JSON.stringify({
      activeAccountId: parsed.activeAccountId,
      accounts: parsed.accounts.map((record) => ({
        ...record,
        account: {
          ...record.account,
          connectionState: "reconnect_required"
        },
        session: undefined,
        pendingReconnect: {
          baseUrl: record.account.baseUrl,
          username: record.account.username,
          label: record.account.label
        }
      }))
    }));
  });

  await page.reload();

  await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Reconnect/i })).toHaveCount(0);
});

test("unsupported files download directly instead of opening a dead preview", async ({ page }) => {
  await connectAccount(page, "Download workspace");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Open file image.bin/i }).click();

  const download = await downloadPromise;
  await expect(page.getByRole("dialog", { name: /Preview image.bin/i })).toHaveCount(0);
  await expect(page.getByText("Starting browser download for /Archive/image.bin from Download workspace because this file type opens outside preview.")).toBeVisible();
  expect(download.suggestedFilename()).toBe("image.bin");
});

test("preview supports markdown MIME variants, inline PDF rendering, and PDF open fallback", async ({ page, context }) => {
  await connectAccount(page, "Preview workspace");
  await page.getByRole("button", { name: /Open folder Design/i }).click();
  await page.getByRole("button", { name: /Open file spec.md/i }).click();

  const markdownPreview = page.getByRole("dialog", { name: /Preview spec.md/i });
  await expect(markdownPreview).toBeVisible();
  await expect(markdownPreview.locator(".rendered-markdown")).toContainText("Mock spec");
  await markdownPreview.getByRole("button", { name: /Back to files/i }).click();

  await page.goto("/");
  await expect(page.getByRole("button", { name: /Open folder Archive/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();

  const imagePreview = page.getByRole("dialog", { name: /Preview photo.png/i });
  const imageElement = imagePreview.locator("img.media-preview-image");
  const imageFallback = imagePreview.getByText(/Image preview is unavailable right now/i);
  await expect(imagePreview).toBeVisible();
  await expect(imageElement.or(imageFallback)).toBeVisible();
  if (await imageElement.count()) {
    await expect(imageElement).toHaveCSS("object-fit", /contain|cover/);
    const imageStage = imagePreview.locator(".preview-media-stage-image");
    const originalSizeButton = imagePreview.getByRole("button", { name: /Show image at original size/i });
    await expect(originalSizeButton).toBeVisible();
    const expectedFirstWheelWidth = await imageStage.evaluate((element) => {
      const displayedScale = Math.max(element.clientWidth / 1200, element.clientHeight / 800);
      return (displayedScale + 0.15) * 1200;
    });
    await imageStage.dispatchEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -300 });
    await expect(imageElement).toHaveClass(/media-preview-image-zoomed/);
    await expect.poll(async () => {
      const box = await imageElement.boundingBox();
      return Math.abs((box?.width ?? 0) - expectedFirstWheelWidth);
    }).toBeLessThan(12);

    await originalSizeButton.click();
    await expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
    await expect(imageElement).toHaveClass(/media-preview-image-zoomed/);
    const originalSizeImageBox = await imageElement.boundingBox();
    expect(Math.round(originalSizeImageBox?.width ?? 0)).toBe(1200);
    await expect.poll(async () => imageStage.evaluate((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)).toBe(true);

    const zoomBeforeWheel = await originalSizeButton.getAttribute("aria-label");
    await imageStage.hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -600);
    await page.keyboard.up("Control");
    await expect.poll(async () => originalSizeButton.getAttribute("aria-label")).not.toBe(zoomBeforeWheel);

    const zoomBeforePinch = await originalSizeButton.getAttribute("aria-label");
    await imageStage.dispatchEvent("touchstart", {
      touches: [
        { identifier: 1, clientX: 120, clientY: 160 },
        { identifier: 2, clientX: 220, clientY: 160 }
      ]
    });
    await imageStage.dispatchEvent("touchmove", {
      touches: [
        { identifier: 1, clientX: 90, clientY: 160 },
        { identifier: 2, clientX: 250, clientY: 160 }
      ]
    });
    await imageStage.dispatchEvent("touchend", { touches: [] });
    await expect.poll(async () => originalSizeButton.getAttribute("aria-label")).not.toBe(zoomBeforePinch);
  } else {
    await expect(imagePreview.getByRole("button", { name: /Open original in new tab/i })).toBeVisible();
    await expect(imagePreview.getByRole("button", { name: /Download file/i })).toBeVisible();
  }
  await imagePreview.getByRole("button", { name: /Back to files/i }).click();

  await page.getByRole("button", { name: /Open file photo.heic/i }).click();
  const heicPreview = page.getByRole("dialog", { name: /Preview photo.heic/i });
  await expect(heicPreview).toBeVisible();
  await expect(heicPreview.getByText(/HEIC preview is experimental and disabled/i)).toBeVisible();
  await expect(heicPreview.getByRole("button", { name: /Open original in new tab/i })).toBeVisible();
  await expect(heicPreview.getByRole("button", { name: /Download file/i })).toBeVisible();
  await heicPreview.getByRole("button", { name: /Back to files/i }).click();

  const newPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();

  const pdfPreview = page.getByRole("dialog", { name: /Preview guide.pdf/i });
  await expect(pdfPreview).toBeVisible();
  await expect(pdfPreview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible();
  await expect(pdfPreview.getByRole("heading", { name: "guide.pdf" })).toBeVisible();
  await expect(pdfPreview.locator(".pdf-canvas-page")).toHaveCount(2);
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Next PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Previous PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();

  const pdfScroll = pdfPreview.locator(".pdf-canvas-scroll");
  await pdfScroll.hover();
  await page.mouse.wheel(0, 900);
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Fit PDF to page/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toHaveAttribute("aria-pressed", "true");
  await pdfPreview.getByRole("button", { name: /Fit PDF to width/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to width/i })).toHaveAttribute("aria-pressed", "true");

  const zoomLabel = pdfPreview.locator(".pdf-canvas-zoom");
  const zoomBeforeWheel = await zoomLabel.textContent();
  await pdfScroll.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -700);
  await page.keyboard.up("Control");
  await expect.poll(async () => zoomLabel.textContent()).not.toBe(zoomBeforeWheel);

  await pdfScroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await pdfScroll.dispatchEvent("touchstart", {
    touches: [{ identifier: 1, clientX: 180, clientY: 260 }]
  });
  await pdfScroll.dispatchEvent("touchmove", {
    touches: [{ identifier: 1, clientX: 180, clientY: 120 }]
  });
  await pdfScroll.dispatchEvent("touchend", { touches: [] });
  await expect.poll(async () => pdfScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const zoomBeforePinch = await zoomLabel.textContent();
  await pdfScroll.dispatchEvent("touchstart", {
    touches: [
      { identifier: 1, clientX: 120, clientY: 160 },
      { identifier: 2, clientX: 220, clientY: 160 }
    ]
  });
  await pdfScroll.dispatchEvent("touchmove", {
    touches: [
      { identifier: 1, clientX: 80, clientY: 160 },
      { identifier: 2, clientX: 260, clientY: 160 }
    ]
  });
  await pdfScroll.dispatchEvent("touchend", { touches: [] });
  await expect.poll(async () => zoomLabel.textContent()).not.toBe(zoomBeforePinch);
  await expect(pdfPreview.getByText(/PDF rendering depends on browser support/i)).toHaveCount(0);
  await expect(pdfPreview.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)).toHaveCount(0);
  await pdfPreview.getByRole("button", { name: /Open PDF in new tab/i }).click();
  const pdfPage = await newPagePromise;
  // Blob URLs do not reliably fire domcontentloaded across Chrome variants; the URL itself is the invariant.
  await expect(pdfPage).toHaveURL(/blob:/);
});

test("mobile preview toolbar keeps long image actions separated and tappable", async ({ page }) => {
  await renderMobilePreviewToolbarFixture(page);
  const toolbar = page.locator(".preview-header-actions");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(":scope > button, :scope > details")).toHaveCount(6);

  const actionBoxes = await toolbar.locator(":scope > button, :scope > details").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    return {
      label: element.textContent?.trim() ?? "",
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      overflow: computed.overflow,
      textOverflow: computed.textOverflow
    };
  }));

  for (const action of actionBoxes) {
    expect(action.width, `${action.label} width`).toBeGreaterThanOrEqual(44);
    expect(action.height, `${action.label} height`).toBeGreaterThanOrEqual(36);
  }

  for (let index = 0; index < actionBoxes.length; index += 1) {
    const current = actionBoxes[index];
    for (const next of actionBoxes.slice(index + 1)) {
      const overlaps = current.left < next.right - 0.5
        && current.right > next.left + 0.5
        && current.top < next.bottom - 0.5
        && current.bottom > next.top + 0.5;
      expect(overlaps, `${current.label} overlaps ${next.label}`).toBe(false);
    }
  }

  const openOriginal = actionBoxes.find((action) => action.label === "Open original");
  expect(openOriginal).toMatchObject({ overflow: "hidden", textOverflow: "ellipsis" });
  const backButton = actionBoxes.find((action) => action.label === "Back");
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(backButton?.width ?? 0).toBeGreaterThan((toolbarBox?.width ?? 0) * 0.9);
});

test("adding a second account and switching updates active-account context", async ({ page }) => {
  await connectAccount(page, "Alpha workspace");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("beta-user");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Beta workspace");
  await dialog.getByRole("button", { name: /Add account/i }).click();

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = reopenedSettingsDialog.getByLabel("Active account");
  await expect(activeAccountSelect).toHaveValue(/.+/);
  await activeAccountSelect.selectOption({ label: "Alpha workspace" });
  await expect(activeAccountSelect).toHaveValue(/.+/);
  await activeAccountSelect.selectOption({ label: "Beta workspace" });
  await expect(activeAccountSelect).toHaveValue(/.+/);
});

test("offline mode keeps account-scoped cached content visible and disables mutations", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await connectAccount(page, "Offline workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview roadmap.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Back to files/i }).click();

  await context.setOffline(true);
  await page.getByRole("button", { name: /Go to home folder/i }).click();
  await expect(page.getByText(/Showing cached data while offline/i)).toBeVisible();
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await expect(page.getByText(/Offline snapshot/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeDisabled();
});

test("cache-first folder load shows cached data before background refresh completes", async ({ page }) => {
  await connectAccount(page, "Folder cache workspace");
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();

  const folderRefresh = createGate();
  await page.route("**/api/files?path=", async (route) => {
    await folderRefresh.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [{ path: "Projects refreshed", name: "Projects refreshed", isFolder: true }]
        }
      })
    });
  });

  await page.reload();

  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
  await expect(page.getByText("Showing cached folder for / in Folder cache workspace while checking for changes.")).toBeVisible();
  await expect(page.getByText(/Showing cached data while checking for changes in the background/i)).toBeVisible();
  await expect(page.locator(".operation-pill", { hasText: "Refreshing" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Projects refreshed/i })).toHaveCount(0);

  folderRefresh.release();

  await expect(page.getByRole("button", { name: /Open folder Projects refreshed/i })).toBeVisible();
  await expect(page.getByText("Refreshed / in Folder cache workspace")).toBeVisible();
});

test("cache-first file open keeps cached preview until refreshed version is applied", async ({ page }) => {
  await connectAccount(page, "Preview cache workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const initialPreview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(initialPreview.getByText(/normalized API/i)).toBeVisible();
  await initialPreview.getByRole("button", { name: /Back to files/i }).click();
  await expect(initialPreview).toHaveCount(0);

  const previewRefresh = createGate();
  await page.route("**/api/file?path=Projects%2Froadmap.txt", async (route) => {
    await previewRefresh.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/roadmap.txt",
            name: "roadmap.txt",
            isFolder: false,
            size: 70,
            mimeType: "text/plain",
            viewer: "text",
            content: "fresh preview from network",
            encoding: "utf8",
            truncated: false,
            bytesRead: 26
          }
        }
      })
    });
  });

  await page.getByRole("button", { name: /Open file roadmap.txt/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview roadmap.txt/i });
  await expect(preview.getByText(/normalized API/i)).toBeVisible();
  await expect(preview.getByText(/Showing cached preview/i)).toBeVisible();
  await expect(preview.getByRole("button", { name: /Apply refreshed version/i })).toHaveCount(0);

  previewRefresh.release();

  await expect(preview.getByText(/A fresher version is ready/i)).toBeVisible();
  await expect(preview.getByText(/normalized API/i)).toBeVisible();
  await expect(preview.getByText(/fresh preview from network/i)).toHaveCount(0);

  await preview.getByRole("button", { name: /Apply refreshed version/i }).click();
  await expect(preview.getByText(/fresh preview from network/i)).toBeVisible();
});

test("cached folders stay scoped to the active account when switching accounts", async ({ page }) => {
  await connectAccount(page, "Alpha workspace");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("beta-user");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Beta workspace");
  await dialog.getByRole("button", { name: /Add account/i }).click();

  await page.waitForFunction(() => {
    const rawState = localStorage.getItem("davora-account-state") ?? '{"accounts":[]}';
    const parsed = JSON.parse(rawState) as { accounts?: Array<{ account?: { cacheNamespace?: string } }> };
    return Array.isArray(parsed.accounts) && parsed.accounts.length === 2 && parsed.accounts.every((record) => record.account?.cacheNamespace);
  });

  const state = await page.evaluate(() => {
    const rawState = localStorage.getItem("davora-account-state") ?? '{"accounts":[]}';
    const parsed = JSON.parse(rawState) as { accounts: Array<{ account: { displayName: string; cacheNamespace: string } }> };
    return {
      alphaCacheNamespace: parsed.accounts.find((record) => record.account.displayName === "Alpha workspace")?.account.cacheNamespace,
      betaCacheNamespace: parsed.accounts.find((record) => record.account.displayName === "Beta workspace")?.account.cacheNamespace
    };
  });

  if (!state.alphaCacheNamespace || !state.betaCacheNamespace) {
    throw new Error("Expected cache namespaces for both accounts");
  }

  const refreshGates = [createGate(), createGate()];
  let rootRequestCount = 0;
  await page.route("**/api/files*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("path") !== "") {
      await route.continue();
      return;
    }

    const gate = refreshGates[Math.min(rootRequestCount, refreshGates.length - 1)]!;
    rootRequestCount += 1;
    await gate.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "",
          items: [{ path: "Projects", name: "Projects", isFolder: true }]
        }
      })
    });
  });

  await page.evaluate(({ alphaCacheNamespace, betaCacheNamespace }) => {
    localStorage.setItem("davora-cache:folder:" + alphaCacheNamespace + ":", JSON.stringify({
      cachedAt: "2026-05-21T12:00:00.000Z",
      value: [{ path: "Alpha cached", name: "Alpha cached", isFolder: true }]
    }));
    localStorage.setItem("davora-cache:folder:" + betaCacheNamespace + ":", JSON.stringify({
      cachedAt: "2026-05-21T12:05:00.000Z",
      value: [{ path: "Beta cached", name: "Beta cached", isFolder: true }]
    }));
  }, state);

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const activeAccountSelect = reopenedSettingsDialog.getByLabel("Active account");
  await activeAccountSelect.selectOption({ label: "Alpha workspace" });
  await reopenedSettingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Alpha cached/i })).toBeVisible();
  await expect(page.getByText("Showing cached folder for / in Alpha workspace while checking for changes.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Beta cached/i })).toHaveCount(0);

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const betaSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  const betaAccountSelect = betaSettingsDialog.getByLabel("Active account");
  await betaAccountSelect.selectOption({ label: "Beta workspace" });
  await betaSettingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(page.getByRole("button", { name: /Open folder Beta cached/i })).toBeVisible();
  await expect(page.getByText("Showing cached folder for / in Beta workspace while checking for changes.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open folder Alpha cached/i })).toHaveCount(0);

  for (const gate of refreshGates) {
    gate.release();
  }
});

test("breadcrumbs use a home root with slash separators and replace redundant navigation buttons", async ({ page }) => {
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
  await expect(page.getByText(/Uploaded 1 file into \/ via drag and drop/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file dragged.txt/i })).toBeVisible();
});

test("normal picker flow uploads multiple files in one action", async ({ page }) => {
  await connectAccount(page, "Multi upload workspace");

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByLabel("Upload files").click();
  const chooser = await fileChooser;
  await chooser.setFiles([
    { name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") },
    { name: "beta.txt", mimeType: "text/plain", buffer: Buffer.from("beta") }
  ]);

  await expect(page.getByText(/Uploaded 2 files into \//i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file alpha.txt/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file beta.txt/i })).toBeVisible();
});

test("normal picker flow uploads directories while preserving nested relative paths", async ({ page }) => {
  await connectAccount(page, "Folder upload workspace");

  await page.locator('input[aria-label="Upload folder"]').setInputFiles("tests/fixtures/folder-upload/Mixtape");

  await expect(page.getByText(/Uploaded 2 files from 1 folder into \//i)).toBeVisible();
  await page.getByRole("button", { name: /Open folder Mixtape/i }).click();
  await expect(page.getByRole("button", { name: /Open folder assets/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open file track.txt/i })).toBeVisible();
  await page.getByRole("button", { name: /Open folder assets/i }).click();
  await expect(page.getByRole("button", { name: /Open file cover.txt/i })).toBeVisible();
});

test("batch download zips a mixed file and folder selection in one workflow", async ({ page }) => {
  await connectAccount(page, "Batch download workspace");

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByLabel("Upload files").click();
  const chooser = await fileChooser;
  await chooser.setFiles({ name: "alpha.txt", mimeType: "text/plain", buffer: Buffer.from("alpha") });
  await expect(page.getByText(/Uploaded 1 file into \//i)).toBeVisible();

  await page.getByLabel(/Select Archive folder for batch download/i).click();
  await page.getByLabel(/Select alpha.txt file for batch download/i).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download selected$/i }).click();
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
    "Archive/photo.png",
    "alpha.txt"
  ]);
  await expect(page.getByText(/Downloaded 1 file and 1 folder as davora-home-download.zip in Batch download workspace\./i)).toBeVisible();
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
  await expect(page.getByRole("button", { name: /Open file renamed.txt/i })).toBeVisible();
});

test("profile and settings groups account, cache, and file-size controls", async ({ page }) => {
  await connectAccount(page, "Settings workspace");
  await page.getByRole("button", { name: /Profile & settings/i }).click();

  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByText(/settings-workspace/i)).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: /Offline cache/i })).toBeVisible();
  await expect(settingsDialog.locator(".cache-summary")).toContainText(/cached file/i);
  await page.getByLabel("File size display in file list").selectOption("mb");
  await expect(page.getByText(/File sizes now use MB/i)).toBeVisible();
  await expect(settingsDialog.getByLabel("File size display")).toHaveCount(0);
  await expect(settingsDialog.getByText(/Current mode for cache-related sizes: MB/i)).toBeVisible();
  await expect(settingsDialog.getByLabel("Opened-file cache limit presets")).toHaveCount(0);
  await settingsDialog.getByLabel("Opened-file cache limit slider").evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "512";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settingsDialog.getByLabel("Opened-file cache limit in MB").fill("2048");
  await settingsDialog.getByLabel("Opened-file cache limit in MB").press("Enter");
  await settingsDialog.getByLabel("Max file size eligible for browser cache in MB").fill("32");
  await settingsDialog.getByLabel("Max file size eligible for browser cache in MB").press("Enter");
  await expect(settingsDialog.getByLabel("Max file size eligible for browser cache in MB")).toHaveValue("32");
  await settingsDialog.getByRole("button", { name: /Clear cache/i }).click();
  await expect(page.getByText(/Offline cache cleared/i)).toBeVisible();
});

test("gallery overlay adds next/previous controls and photo-only quick advance behavior", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chrome";
  await connectAccount(page, "Gallery workspace");
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pP3Un0AAAAASUVORK5CYII=", "base64");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
            { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
          ]
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/photo.png",
            name: "photo.png",
            isFolder: false,
            size: 12,
            mimeType: "image/png",
            viewer: "image",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fsong.mp3", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/song.mp3",
            name: "song.mp3",
            isFolder: false,
            size: 18,
            mimeType: "audio/mpeg",
            viewer: "audio",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file/original?path=Projects%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''photo.png"
      },
      body: tinyPng
    });
  });
  await page.route("**/api/file/original?path=Projects%2Fsong.mp3", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-disposition": "attachment; filename*=UTF-8''song.mp3"
      },
      body: Buffer.from([0, 1, 2, 3])
    });
  });
  await page.getByRole("button", { name: /Open folder Projects/i }).click();

  if (isMobile) {
    await page.getByRole("button", { name: /Open file photo.png/i }).click();
    const mobileImagePreview = page.getByRole("dialog", { name: /Preview photo.png/i });
    await expect(mobileImagePreview.getByRole("button", { name: /Next media item/i })).toBeVisible();
    await mobileImagePreview.locator(".preview-media-stage-clickable").click({ force: true });
    await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toBeVisible();
    await page.getByRole("dialog", { name: /Preview song.mp3/i }).getByRole("button", { name: /Back to files/i }).click();
    await page.getByRole("button", { name: /Open file photo.png/i }).click();
    await mobileImagePreview.locator(".preview-media-stage-clickable").focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toBeVisible();
    return;
  }

  await page.getByRole("button", { name: /Open file song.mp3/i }).click();

  const audioPreview = page.getByRole("dialog", { name: /Preview song.mp3/i });
  await expect(audioPreview.getByRole("button", { name: /Previous media item/i })).toBeVisible();
  await expect(audioPreview.getByRole("button", { name: /Next media item/i })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toBeVisible();

  await audioPreview.getByRole("button", { name: /Previous media item/i }).click({ force: true });
  const imagePreview = page.getByRole("dialog", { name: /Preview photo.png/i });
  await expect(imagePreview).toBeVisible();
  await imagePreview.locator(".preview-media-stage-clickable").click({ force: true });
  await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toBeVisible();

  await page.getByRole("dialog", { name: /Preview song.mp3/i }).getByRole("button", { name: /Previous media item/i }).click({ force: true });
  await expect(page.getByRole("dialog", { name: /Preview photo.png/i })).toBeVisible();
  await page.getByRole("dialog", { name: /Preview photo.png/i }).locator(".preview-media-stage-clickable").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toBeVisible();
});

test("desktop shell hides the account selector behind profile and settings", async ({ page }) => {
  await connectAccount(page, "Desktop shell workspace");
  await expect(page.locator(".app-bar").getByRole("heading", { name: /^Davora$/i })).toHaveCount(0);
  await expect(page.getByLabel("Active account")).toHaveCount(0);
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  await expect(page.getByRole("dialog", { name: /Profile and settings/i }).getByLabel("Active account")).toHaveValue(/.+/);
});

test("audio preview reopens at the last remembered position for the same browser account", async ({ page }) => {
  await connectAccount(page, "Audio resume workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file song.mp3/i }).click();

  const audioPreview = page.getByRole("dialog", { name: /Preview song.mp3/i });
  await expect(audioPreview).toBeVisible();
  const firstPosition = await audioPreview.locator("audio").evaluate((audio) => {
    Object.defineProperty(audio, "duration", { configurable: true, value: 180 });
    audio.currentTime = 37.25;
    audio.dispatchEvent(new Event("timeupdate"));
    audio.dispatchEvent(new Event("pause"));
    return audio.currentTime;
  });
  expect(firstPosition).toBeCloseTo(37.25, 2);

  await audioPreview.getByRole("button", { name: /Back to files/i }).click();
  await page.getByRole("button", { name: /Open file song.mp3/i }).click();

  const reopenedPosition = await page.getByRole("dialog", { name: /Preview song.mp3/i }).locator("audio").evaluate((audio) => {
    Object.defineProperty(audio, "duration", { configurable: true, value: 180 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    return audio.currentTime;
  });

  expect(reopenedPosition).toBeCloseTo(37.25, 2);
});

test("video preview autoplays muted and modal overlays dismiss on outside click", async ({ page }) => {
  await connectAccount(page, "Video workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview).toBeVisible();
  const video = preview.getByLabel(/Video preview clip.mp4/i);
  await expect(video).toHaveJSProperty("autoplay", true);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("playsInline", true);
  await page.locator(".preview-scrim").click({ position: { x: 8, y: 8 } });
  await expect(preview).toHaveCount(0);

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();
  await page.locator(".modal-scrim").click({ position: { x: 8, y: 8 } });
  await expect(settingsDialog).toHaveCount(0);
});

test("media preview attempts autoplay for audio and video and pauses when switching", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop media instrumentation only.");
  await page.addInitScript(() => {
    const events: Array<{ type: string; tag: string; src: string }> = [];
    Object.defineProperty(window, "__davoraMediaEvents", {
      configurable: true,
      value: events
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        events.push({ type: "play", tag: this.tagName, src: this.currentSrc || this.src });
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value(this: HTMLMediaElement) {
        events.push({ type: "pause", tag: this.tagName, src: this.currentSrc || this.src });
        this.dispatchEvent(new Event("pause"));
      }
    });
  });
  await connectAccount(page, "Media autoplay workspace");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" },
            { path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }
          ]
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fchapter.m4a", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/chapter.m4a",
            name: "chapter.m4a",
            isFolder: false,
            size: 18,
            mimeType: "audio/mp4",
            viewer: "audio",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fclip.mp4", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/clip.mp4",
            name: "clip.mp4",
            isFolder: false,
            size: 16,
            mimeType: "video/mp4",
            viewer: "video",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file/original?path=Projects%2Fchapter.m4a", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "audio/mp4",
        "content-disposition": "attachment; filename*=UTF-8''chapter.m4a"
      },
      body: Buffer.from([0, 1, 2, 3])
    });
  });
  await page.route("**/api/file/original?path=Projects%2Fclip.mp4", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-disposition": "attachment; filename*=UTF-8''clip.mp4"
      },
      body: Buffer.from([0, 0, 0, 24])
    });
  });

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file chapter.m4a/i }).click();
  const audioPreview = page.getByRole("dialog", { name: /Preview chapter.m4a/i });
  await expect(audioPreview.locator("audio")).toHaveJSProperty("autoplay", true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __davoraMediaEvents: Array<{ type: string; tag: string }> }).__davoraMediaEvents)).toContainEqual(expect.objectContaining({ type: "play", tag: "AUDIO" }));

  await audioPreview.getByRole("button", { name: /Next media item/i }).click({ force: true });
  const videoPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  const video = videoPreview.getByLabel(/Video preview clip.mp4/i);
  await expect(video).toHaveJSProperty("autoplay", true);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("playsInline", true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __davoraMediaEvents: Array<{ type: string; tag: string }> }).__davoraMediaEvents)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "pause", tag: "AUDIO" }),
      expect.objectContaining({ type: "play", tag: "VIDEO" })
    ])
  );
});

test("large video preview streams through the Worker without full-file download", async ({ page }) => {
  await connectAccount(page, "Streaming workspace");
  const largeVideoSize = 32 * 1024 * 1024;
  let originalRequests = 0;
  let streamRequests = 0;

  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [{ path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: largeVideoSize, mimeType: "video/mp4" }]
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fclip.mp4", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/clip.mp4",
            name: "clip.mp4",
            isFolder: false,
            size: largeVideoSize,
            mimeType: "video/mp4",
            viewer: "video",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file/original?path=Projects%2Fclip.mp4", async (route) => {
    originalRequests += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ data: { message: "Full file should not be requested before playback." } }) });
  });
  await page.route("**/api/file/stream?**", async (route) => {
    streamRequests += 1;
    const range = route.request().headers()["range"];
    await route.fulfill({
      status: range ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "content-type": "video/mp4",
        ...(range ? { "content-range": `bytes 0-3/${largeVideoSize}` } : {})
      },
      body: Buffer.from([0, 0, 0, 24])
    });
  });

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/Streaming-only playback/i)).toBeVisible();
  await expect(preview.getByLabel(/Video preview clip.mp4/i)).toHaveAttribute("src", /\/api\/file\/stream\?path=Projects%2Fclip\.mp4&token=/);
  await expect.poll(() => streamRequests).toBeGreaterThan(0);
  expect(originalRequests).toBe(0);

  let video = preview.getByLabel(/Video preview clip.mp4/i);
  await video.dispatchEvent("error");
  await expect(preview.getByText(/Stream interrupted\. Retrying playback shortly \(1\/3\)/i)).toBeVisible();
  await expect(video).toHaveAttribute("src", /streamRetry=1/, { timeout: 1000 });

  video = preview.getByLabel(/Video preview clip.mp4/i);
  await video.dispatchEvent("error");
  await expect(preview.getByText(/Stream interrupted\. Retrying playback shortly \(2\/3\)/i)).toBeVisible();
  await expect(video).toHaveAttribute("src", /streamRetry=2/, { timeout: 1500 });

  video = preview.getByLabel(/Video preview clip.mp4/i);
  await video.dispatchEvent("error");
  await expect(preview.getByText(/Stream interrupted\. Retrying playback shortly \(3\/3\)/i)).toBeVisible();
  await expect(video).toHaveAttribute("src", /streamRetry=3/, { timeout: 2500 });

  video = preview.getByLabel(/Video preview clip.mp4/i);
  await video.dispatchEvent("error");
  await expect(preview.getByText(/Media playback could not continue after several retries/i)).toBeVisible();
  await preview.getByRole("button", { name: /Retry playback/i }).click();
  await expect(preview.getByLabel(/Video preview clip.mp4/i)).toHaveAttribute("src", /streamRetry=4/);
});

test("mobile settings dialog uses a done action with clean close behavior", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
  await connectAccount(page, "Settings workspace");
  await page.getByRole("button", { name: /Profile & settings/i }).click();

  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByRole("button", { name: /^Done$/i })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /^Close$/i })).toHaveCount(0);
  await settingsDialog.getByRole("button", { name: /^Done$/i }).click();
  await expect(settingsDialog).toHaveCount(0);
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

test("mobile shell keeps account and status details behind profile and settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only UX check.");
  await connectAccount(page, "Install layout workspace");
  await dispatchBeforeInstallPrompt(page, "dismissed");

  const appBar = page.locator(".app-bar");
  const installButton = page.getByRole("button", { name: /Install app/i });
  const settingsButton = page.getByRole("button", { name: /Profile & settings/i });
  await expect(installButton).toBeVisible();
  await expect(settingsButton).toBeVisible();
  await expect(page.getByLabel("Active account")).toHaveCount(0);
  await expect(appBar.locator(".badge")).toHaveCount(0);
  await expect(appBar.locator(".app-bar-subtitle")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const appBarElement = document.querySelector(".app-bar") as HTMLElement | null;
    const browseHeaderElement = document.querySelector(".browse-header") as HTMLElement | null;
    if (!appBarElement || !browseHeaderElement) {
      return null;
    }

    const appBarBounds = appBarElement.getBoundingClientRect();
    const browseHeaderBounds = browseHeaderElement.getBoundingClientRect();
    return {
      appBarHeight: appBarBounds.height,
      gapToBrowse: browseHeaderBounds.top - appBarBounds.bottom
    };
  });

  expect(layout).not.toBeNull();
  if (!layout) {
    return;
  }

  expect(layout.appBarHeight).toBeLessThan(90);
  expect(layout.gapToBrowse).toBeGreaterThanOrEqual(0);

  await settingsButton.click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByLabel("Active account")).toHaveValue(/.+/);
  await expect(settingsDialog.getByText("Workspace status")).toBeVisible();
  await expect(settingsDialog.getByText(/^Online$/)).toBeVisible();
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

test("broken image preview falls back gracefully instead of showing a broken browser image", async ({ page }) => {
  await connectAccount(page, "Preview workspace");
  await page.route("**/api/file?path=Archive%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Archive/photo.png",
            name: "photo.png",
            isFolder: false,
            size: 12,
            mimeType: "image/png",
            viewer: "image",
            content: "",
            encoding: "none",
            truncated: false,
            bytesRead: 0,
            requiresOriginalBlob: true
          }
        }
      })
    });
  });
  await page.route("**/api/file/original?path=Archive%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''photo.png"
      },
      body: Buffer.from("not-a-real-png")
    });
  });

  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview photo.png/i });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/Image preview is unavailable right now/i)).toBeVisible();
  await expect(preview.locator("img.media-preview-image")).toHaveCount(0);
  await expect(preview.getByRole("button", { name: /Open original in new tab/i })).toBeVisible();
  await expect(preview.getByRole("button", { name: /Download file/i })).toBeVisible();
});

test("worker-side account loss triggers reconnect flow and remove returns to zero state", async ({ page, request, baseURL }) => {
  await connectAccount(page, "Recoverable workspace");
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: /Reconnect Recoverable workspace/i })).toBeVisible();
  await page.getByLabel("App password").fill("renewed-password");
  await page.getByRole("button", { name: /Reconnect account/i }).click();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();

  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Remove/i }).click();
  const removeDialog = page.getByRole("dialog", { name: /Remove Recoverable workspace/i });
  await removeDialog.getByLabel("Account label to confirm").fill("Recoverable workspace");
  await removeDialog.getByRole("button", { name: /Remove account/i }).click();
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
});

test("unlock bootstrap prompts after account connect when configured", async ({ page }) => {
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

  let sessionAttempts = 0;
  await page.route("**/api/session", async (route) => {
    sessionAttempts += 1;
    const payload = route.request().postDataJSON() as { unlockCode?: string };
    if (payload.unlockCode !== "open-sesame") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            code: "invalid_unlock_code",
            message: "Unlock code is invalid."
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  await connectAccount(page, "Locked workspace", { waitForWorkspace: false });
  await expect(page.getByRole("heading", { name: /Unlock required/i })).toBeVisible();
  await page.getByLabel("Unlock code").fill("wrong");
  await page.getByRole("button", { name: /Unlock and connect/i }).click();
  await expect(page.getByText(/Ask the deployment operator for the current APP_UNLOCK_CODE/i)).toBeVisible();

  await page.getByLabel("Unlock code").fill("open-sesame");
  await page.getByRole("button", { name: /Unlock and connect/i }).click();
  await expect(page.getByRole("button", { name: /Create folder/i })).toBeVisible();
  expect(sessionAttempts).toBe(2);
});
