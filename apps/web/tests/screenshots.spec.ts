import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDirectory = path.resolve(__dirname, "../../../docs/screenshots");
const screenshotsEnabled = process.env.CAPTURE_SCREENSHOTS === "true";
const frozenNow = Date.now();

test.skip(!screenshotsEnabled, "Run this spec only when refreshing checked-in screenshot artifacts.");

test.beforeAll(() => {
  mkdirSync(screenshotDirectory, { recursive: true });
});

test.beforeEach(async ({ request, baseURL, page }, testInfo) => {
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  await page.addInitScript((fixedNow) => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        super(...(args.length > 0 ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    Object.defineProperties(FrozenDate, {
      parse: { value: RealDate.parse },
      UTC: { value: RealDate.UTC }
    });
    globalThis.Date = FrozenDate as DateConstructor;
  }, frozenNow);

  if (testInfo.project.name === "desktop-chrome") {
    await page.setViewportSize({ width: 1440, height: 1600 });
  }
});

async function connectAccount(page: Page, label = "Workspace alpha", options: { waitForWorkspace?: boolean } = {}) {
  const { waitForWorkspace = true } = options;
  await page.goto("/");
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

async function saveScreenshot(page: Page, fileName: string) {
  const options = {
    path: path.join(screenshotDirectory, fileName),
    fullPage: true,
    animations: "disabled" as const,
    caret: "hide" as const
  };
  try {
    await page.screenshot(options);
  } catch {
    await page.waitForTimeout(250);
    await page.screenshot(options);
  }
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

test("captures the first-run zero state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /No connected accounts yet/i })).toBeVisible();
  await saveScreenshot(page, "davora-zero-state.png");
});

test("captures the connected account workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await saveScreenshot(page, "davora-connected-workspace.png");
});

test("captures account switching context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await settingsDialog.getByRole("button", { name: /Add account/i }).click();
  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await dialog.getByLabel("Base URL").fill("https://second-account.example.com");
  await dialog.getByLabel("Username").fill("workspace-beta");
  await dialog.getByLabel("App password").fill("beta-password");
  await dialog.getByLabel("Label").fill("Workspace beta");
  await dialog.getByRole("button", { name: /Add account/i }).click();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const reopenedSettingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await reopenedSettingsDialog.getByLabel("Active account").selectOption({ label: "Workspace beta" });
  await expect(reopenedSettingsDialog.getByLabel("Active account")).toHaveValue(/.+/);
  await saveScreenshot(page, "davora-account-switcher.png");
});

test("captures the profile and settings dialog", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  await expect(page.getByRole("dialog", { name: /Profile and settings/i })).toBeVisible();
  await saveScreenshot(page, "davora-settings-dialog.png");
});

test("captures recursive offline sync management", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Offline sync workspace");
  await page.getByLabel(/Select Projects folder for batch download/i).check();
  await page.getByRole("button", { name: /^Keep offline$/i }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(confirmDialog.getByText(/Synced recursively/i)).toBeVisible();
  await expect(confirmDialog.getByText(/Kept-offline files are excluded from normal automatic cache eviction/i)).toBeVisible();
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog.getByRole("button", { name: /Remove offline copy for Projects from this device/i })).toBeVisible();
  await saveScreenshot(page, "davora-offline-sync-management.png");
});

test("captures background offline sync progress", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  let releaseDownload: ((body: string) => void) | undefined;
  await page.route("**/api/download?path=Projects%2Froadmap.txt", async (route) => {
    const body = await new Promise<string>((resolve) => {
      releaseDownload = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body
    });
  });

  await connectAccount(page, "Offline background workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();
  await expect(confirmDialog).toBeHidden();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("roadmap.txt")).toBeVisible();
  await expect(transferStatus.getByText(/Offline sync/i)).toBeVisible();
  await saveScreenshot(page, "davora-offline-sync-background.png");

  releaseDownload?.("offline roadmap");
});

test("captures recursive offline sync retry preserving folder scope", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  let badDownloadAttempts = 0;
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/bad.pdf", name: "bad.pdf", isFolder: false, size: 10, mimeType: "application/pdf" },
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 10, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/download?path=Projects%2Fbad.pdf", async (route) => {
    badDownloadAttempts += 1;
    if (badDownloadAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ data: { code: "temporary_failure", message: "Failed to fetch" } })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\nretry ok"
    });
  });
  await page.route("**/api/download?path=Projects%2Fgood.txt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "ok"
    });
  });

  await connectAccount(page, "Offline retry workspace");
  await page.getByRole("button", { name: /Open actions for Projects/i }).click();
  await page.getByRole("button", { name: /^Keep offline$/i }).click();
  const confirmDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(confirmDialog.getByText("Projects")).toBeVisible();
  await expect(confirmDialog.getByText(/Synced recursively/i)).toBeVisible();
  await confirmDialog.getByRole("button", { name: /Start sync/i }).click();

  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("Projects/bad.pdf", { exact: true })).toBeVisible();
  await expect(transferStatus.getByRole("button", { name: /Retry failed sync/i })).toBeVisible();
  await transferStatus.getByRole("button", { name: /Retry failed sync/i }).click();

  const retryDialog = page.getByRole("dialog", { name: /Keep offline confirmation/i });
  await expect(retryDialog.getByText("Projects")).toBeVisible();
  await expect(retryDialog.getByText(/Synced recursively/i)).toBeVisible();
  await expect(retryDialog.getByText("2", { exact: true })).toBeVisible();
  await expect(retryDialog.getByText("bad.pdf")).toHaveCount(0);
  await saveScreenshot(page, "davora-offline-sync-retry-folder.png");
});

test("captures the browse preview workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview guide.pdf/i })).toBeVisible();
  await expect(page.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "guide.pdf" })).toBeVisible();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fit PDF to width/i })).toBeVisible();
  await expect(page.getByText(/PDF rendering depends on browser support/i)).toHaveCount(0);
  await saveScreenshot(page, "davora-browse-preview.png");
});

test("captures the mobile inline PDF preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile PDF evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
  const pdfPreview = page.getByRole("dialog", { name: /Preview guide.pdf/i });
  await expect(pdfPreview).toBeVisible();
  await expect(pdfPreview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible();
  await expect(pdfPreview.getByRole("heading", { name: "guide.pdf" })).toBeVisible();
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Next PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Previous PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Fit PDF to page/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toHaveAttribute("aria-pressed", "true");
  await expect(pdfPreview.getByText("Rendering PDF...")).toBeVisible();
  await expect(pdfPreview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible();
  await expect(pdfPreview.getByText("Rendering PDF...")).toHaveCount(0);
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Next PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await expect(pdfPreview.getByRole("button", { name: /Open PDF in new tab/i })).toContainText("Open PDF");
  await expect(pdfPreview.getByText(/PDF rendering depends on browser support/i)).toHaveCount(0);
  await expect(pdfPreview.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)).toHaveCount(0);
  await saveScreenshot(page, "davora-mobile-pdf-preview.png");
});

test("captures the mobile preview action toolbar without overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile toolbar evidence only.");
  await renderMobilePreviewToolbarFixture(page);
  const toolbar = page.locator(".preview-header-actions");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Open original" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Download" })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-preview-actions.png");
});

test("captures the disabled experimental HEIC preview fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.heic/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview photo.heic/i });
  await expect(preview.getByText(/HEIC preview is experimental and disabled/i)).toBeVisible();
  await expect(preview.getByRole("button", { name: /Open original in new tab/i })).toBeVisible();
  await expect(preview.getByRole("button", { name: /Download file/i })).toBeVisible();
  await saveScreenshot(page, "davora-heic-fallback.png");
});

test("captures the focused preview overlay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview photo.png/i })).toBeVisible();
  await expect(page.locator("img.media-preview-image").or(page.getByText(/Image preview is unavailable right now/i))).toBeVisible();
  await saveScreenshot(page, "davora-focused-preview.png");
});

test("captures the mobile original-size image zoom control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile zoom evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview photo.png/i });
  const image = preview.locator("img.media-preview-image");
  const originalSizeButton = preview.getByRole("button", { name: /Show image at original size/i });
  await expect(preview).toBeVisible();
  await expect(image).toBeVisible();
  await expect(originalSizeButton).toBeVisible();
  await originalSizeButton.click();
  await expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
  await expect(image).toHaveClass(/media-preview-image-zoomed/);
  await saveScreenshot(page, "davora-mobile-preview-zoom.png");
});

test("captures streaming-only media playback evidence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  const largeVideoSize = 32 * 1024 * 1024;
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
  await page.route("**/api/file/stream?**", async (route) => {
    await route.fulfill({
      status: route.request().headers()["range"] ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "content-type": "video/mp4",
        "content-range": `bytes 0-3/${largeVideoSize}`
      },
      body: Buffer.from([0, 0, 0, 24])
    });
  });

  await connectAccount(page, "Streaming workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview.getByText(/Streaming-only playback/i)).toBeVisible();
  await expect(preview.getByLabel(/Video preview clip.mp4/i)).toHaveAttribute("src", /\/api\/file\/stream/);
  await saveScreenshot(page, "davora-media-streaming.png");
});

test("captures blocked media autoplay fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value() {
        return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
      }
    });
  });
  await connectAccount(page, "Autoplay fallback workspace");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }]
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
  await page.route("**/api/file/stream?path=Projects%2Fchapter.m4a**", async (route) => {
    await route.fulfill({
      status: route.request().headers()["range"] ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "content-type": "audio/mp4",
        "content-range": "bytes 0-3/4"
      },
      body: Buffer.from([0, 1, 2, 3])
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

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file chapter.m4a/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview chapter.m4a/i });
  await expect(preview.getByText(/Autoplay was blocked by the browser/i)).toBeVisible();
  await expect(preview.getByRole("button", { name: /Play media/i })).toBeVisible();
  await saveScreenshot(page, "davora-media-autoplay-blocked.png");
});

test("captures mutation controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open actions for roadmap.txt/i }).click();
  await expect(page.getByRole("complementary").getByRole("button", { name: /^Open$/i })).toBeVisible();
  await saveScreenshot(page, "davora-mutation-controls.png");
});

test("captures mobile folder destination picker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Destination picker workspace");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/Документи 100%", name: "Документи 100%", isFolder: true, lastModified: new Date().toISOString() },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", lastModified: new Date().toISOString() }
          ]
        }
      })
    });
  });
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: "Open actions for roadmap.txt" }).click();
  await page.getByRole("button", { name: /Copy or move/i }).click();
  const dialog = page.getByRole("dialog", { name: /Copy or move item/i });
  await expect(dialog.getByRole("button", { name: /Open destination folder Документи 100%/i })).toBeVisible();
  await dialog.getByRole("button", { name: /Open destination folder Документи 100%/i }).click();
  await expect(dialog.getByLabel("Destination name")).toHaveValue("roadmap.txt");
  await expect(dialog.getByLabel("Copy destination path")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Copy here/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Move here/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-destination-picker.png");
});

test("captures unlock-required account state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
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
  await connectAccount(page, "Workspace alpha", { waitForWorkspace: false });
  await expect(page.getByRole("heading", { name: /Unlock required/i })).toBeVisible();
  await saveScreenshot(page, "davora-unlock-screen.png");
});

test("captures error state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.route("**/api/files?path=", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          code: "unexpected_error",
          message: "Unable to load folder."
        }
      })
    });
  });
  await connectAccount(page, "Workspace alpha", { waitForWorkspace: false });
  await expect(page.getByText(/Couldn't load this folder\. Its contents are unknown/i)).toBeVisible();
  await saveScreenshot(page, "davora-error-state.png");
});

test("captures reconnect-required account state", async ({ page, request, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await request.post(`${baseURL?.replace("4174", "8789")}/api/mock/reset`, {
    headers: { "x-davora-reset-token": "playwright-dev-secret" }
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: /Reconnect Workspace alpha/i })).toBeVisible();
  await saveScreenshot(page, "davora-reconnect-state.png");
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
  await roadmapOpenButton.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await roadmapOpenButton.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
  await expect(page.getByRole("toolbar", { name: /Batch selection actions/i })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-batch-actions.png");
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

test("captures the mobile details sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
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
  await connectAccount(page, "Mobile details workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  const sheet = page.getByRole("region", { name: `Details for ${longFileName}` });
  await sheet.getByRole("button", { name: /View details/i }).click();
  await expect(sheet).toHaveClass(/details-panel-sheet-details-open/);
  await expect(sheet.getByRole("button", { name: /Back to actions/i })).toBeVisible();
  await expect(sheet.locator(".context-metadata dt").filter({ hasText: /^Location$/ })).toBeVisible();
  await saveScreenshot(page, "davora-mobile-details-sheet.png");
});

test("captures the mobile delete confirmation without typed-name gate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  const longFileName = "Документи-and-a-very-long-delete-target-name-100%.txt";
  const longPath = `Projects/${longFileName}`;
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
  await connectAccount(page, "Delete confirmation workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: `Open actions for ${longFileName}` }).click();
  await page.getByRole("region", { name: `Details for ${longFileName}` }).getByRole("button", { name: /^Delete$/i }).click();

  const dialog = page.getByRole("dialog", { name: /Delete item/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(longPath)).toBeVisible();
  await expect(dialog.getByLabel(/Name to confirm/i)).toHaveCount(0);
  await saveScreenshot(page, "davora-mobile-delete-confirmation.png");
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

test("captures the mobile profile settings sheet without background bleed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Mobile settings workspace");
  await page.getByRole("button", { name: /Open navigation menu/i }).click();
  await page.getByRole("button", { name: /Profile & settings/i }).click();
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /Done/i })).toBeVisible();
  const dialogBox = await settingsDialog.boundingBox();
  expect(dialogBox?.y ?? 999).toBeLessThanOrEqual(1);
  await saveScreenshot(page, "davora-mobile-settings-dialog.png");
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

test("captures a mobile partial transfer with failed child path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 12, mimeType: "text/plain" },
            { path: "Projects/bad%file.txt", name: "bad%file.txt", isFolder: false, size: 8, mimeType: "text/plain" }
          ]
        }
      })
    });
  });
  await page.route("**/api/download?path=Projects%2Fbad%25file.txt", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ data: { code: "invalid_path", message: "Path contains invalid percent-encoding." } })
    });
  });
  await page.route("**/api/download?path=Projects%2Fgood.txt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "ok"
    });
  });
  await connectAccount(page, "Workspace alpha");
  const projectsOpenButton = page.getByRole("button", { name: /Open folder Projects/i });
  await projectsOpenButton.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.waitForTimeout(500);
  await projectsOpenButton.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerType: "touch" });
  await page.getByRole("toolbar", { name: /Batch selection actions/i }).getByRole("button", { name: /^Download$/i }).click();
  await page.getByRole("button", { name: /^Transfers$/i }).click();
  const transferStatus = page.getByRole("dialog", { name: /Transfer status/i });
  await expect(transferStatus.getByText("projects.zip")).toBeVisible();
  await expect(transferStatus.getByText("Partial")).toBeVisible();
  await expect(transferStatus.getByText(/Downloaded 1 of 2 files; 1 failed/i)).toBeVisible();
  await expect(transferStatus.getByText("Projects/bad%file.txt")).toBeVisible();
  await saveScreenshot(page, "davora-mobile-partial-transfer.png");
});

test("captures the mobile focused image preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview photo.png/i })).toBeVisible();
  await expect(page.locator("img.media-preview-image").or(page.getByText(/Image preview is unavailable right now/i))).toBeVisible();
  await saveScreenshot(page, "davora-mobile-focused-preview.png");
});
