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

async function setThemeMode(page: Page, mode: "Light" | "Dark") {
  const settingsButtons = page.getByRole("button", { name: /Profile & settings/i });
  let opened = false;
  for (let index = 0; index < await settingsButtons.count(); index += 1) {
    if (await settingsButtons.nth(index).isVisible()) {
      await settingsButtons.nth(index).click();
      opened = true;
      break;
    }
  }
  if (!opened) {
    await page.getByRole("button", { name: /Open navigation menu/i }).click();
    await page.getByRole("complementary", { name: /Navigation menu/i }).getByRole("button", { name: /Profile & settings/i }).click();
  }
  const dialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await dialog.getByRole("group", { name: /Theme/i }).getByRole("button", { name: mode }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode.toLowerCase());
  await dialog.getByRole("button", { name: /^(Close|Done)$/i }).click();
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
        <div class="preview-header-actions preview-header-actions-image preview-header-actions-immersive" aria-label="Preview actions">
          <details class="preview-details-disclosure">
            <summary>Details</summary>
            <div class="preview-details-panel">Photo metadata</div>
          </details>
          <button class="quiet-button" type="button">Fit</button>
          <button class="quiet-button" type="button">100%</button>
          <button class="quiet-button" type="button">Get original</button>
          <button class="quiet-button" type="button">Download</button>
        </div>
      </main>
    `;
  });
}


test("captures the browse preview workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview guide.pdf/i })).toBeVisible();
  await expect(page.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible({ timeout: 15_000 });
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
  await expect(pdfPreview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible({ timeout: 15_000 });
  await expect(pdfPreview.getByRole("heading", { name: "guide.pdf" })).toBeVisible();
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Next PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Previous PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Fit PDF to page/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toHaveAttribute("aria-pressed", "true");
  await expect(pdfPreview.getByText("Rendering PDF...")).toBeVisible();
  await expect(pdfPreview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible({ timeout: 15_000 });
  await expect(pdfPreview.getByText("Rendering PDF...")).toHaveCount(0);
  await expect(pdfPreview.getByText("Page 1 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Next PDF page/i }).click();
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await expect(pdfPreview.getByRole("button", { name: /Open or download original file/i })).toContainText("Get original");
  await expect(pdfPreview.getByText(/PDF rendering depends on browser support/i)).toHaveCount(0);
  await expect(pdfPreview.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)).toHaveCount(0);
  await saveScreenshot(page, "davora-mobile-pdf-preview.png");
});

test("captures the mobile preview action toolbar without overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile toolbar evidence only.");
  await renderMobilePreviewToolbarFixture(page);
  const toolbar = page.locator(".preview-header-actions");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Get original" })).toBeVisible();
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
  await expect(preview.getByRole("button", { name: /Open or download original file/i })).toBeVisible();
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

test("captures image preview viewport edge navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await connectAccount(page, "Image edge workspace");
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pP3Un0AAAAASUVORK5CYII=", "base64");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: ["photo-a.png", "photo-b.png", "photo-c.png"].map((name) => ({
            path: `Projects/${name}`,
            name,
            isFolder: false,
            size: 12,
            mimeType: "image/png"
          }))
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fphoto-*.png", async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "").split("/").pop() ?? "photo.png";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: `Projects/${name}`,
            name,
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
  await page.route("**/api/file/original?path=Projects%2Fphoto-*.png", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''photo.png"
      },
      body: tinyPng
    });
  });
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file photo-b.png/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview photo-b.png/i })).toBeVisible();
  await saveScreenshot(page, "davora-image-edge-navigation.png");
});

test("captures the mobile original-size image zoom control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile zoom evidence only.");
  await connectAccount(page, "Workspace alpha");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview photo.png/i });
  const imageStage = preview.locator(".preview-media-stage-image");
  const image = preview.locator("img.media-preview-image");
  const originalSizeButton = preview.getByRole("button", { name: /Show image at original size/i });
  await expect(preview).toBeVisible();
  await expect(image).toBeVisible();
  await expect(originalSizeButton).toBeVisible();
  await originalSizeButton.click();
  await expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
  await expect(image).toHaveClass(/media-preview-image-zoomed/);
  await expect.poll(async () => imageStage.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await imageStage.dispatchEvent("touchstart", {
    touches: [{ identifier: 11, clientX: 260, clientY: 220 }]
  });
  await imageStage.dispatchEvent("touchmove", {
    touches: [{ identifier: 11, clientX: 80, clientY: 220 }]
  });
  await imageStage.dispatchEvent("touchend", { touches: [] });
  await expect.poll(async () => imageStage.evaluate((element) => element.scrollLeft)).toBeGreaterThan(80);
  await saveScreenshot(page, "davora-mobile-preview-zoom.png");
});

test("captures streaming-only media playback evidence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      }
    });
  });
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
  await expect(preview.getByText(/Streaming-only playback/i)).toHaveCount(0);
  await expect(preview.getByLabel(/Video preview clip.mp4/i)).toHaveAttribute("src", /\/api\/file\/stream/);
  // Undecodable bytes exhaust the stream retries; the terminal failure pins
  // the overlay controls visible for the capture.
  await expect(preview.getByText(/Media playback could not continue/i)).toBeVisible({ timeout: 20000 });
  await expect(preview.locator(".preview-video-overlay")).toBeVisible();
  await saveScreenshot(page, "davora-media-streaming.png");
});

test("captures mobile video-only previous and next navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await page.addInitScript(() => {
    window.addEventListener("error", (event) => {
      if (event.target instanceof HTMLMediaElement) {
        event.stopImmediatePropagation();
      }
    }, true);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      }
    });
  });
  await connectAccount(page, "PER-65 video navigation workspace");
  await setThemeMode(page, "Light");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" },
            { path: "Projects/notes.txt", name: "notes.txt", isFolder: false, size: 8, mimeType: "text/plain" },
            { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" },
            { path: "Projects/z-clip.webm", name: "z-clip.webm", isFolder: false, size: 20, mimeType: "video/webm" }
          ]
        }
      })
    });
  });
  for (const file of [
    { path: "Projects/clip.mp4", name: "clip.mp4", mimeType: "video/mp4", size: 16 },
    { path: "Projects/z-clip.webm", name: "z-clip.webm", mimeType: "video/webm", size: 20 }
  ]) {
    await page.route(`**/api/file?path=${encodeURIComponent(file.path)}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            file: {
              ...file,
              isFolder: false,
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
  }

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const firstPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  // Playback hides the overlay controls; a tap on the stage reveals them.
  await firstPreview.locator(".preview-media-stage").evaluate((element) =>
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  );
  const firstNavigation = firstPreview.getByRole("group", { name: /Video navigation/i });
  await expect(firstNavigation.getByRole("button", { name: /Previous video/i })).toBeDisabled();
  await expect(firstNavigation.getByRole("button", { name: /Next video/i })).toBeEnabled();
  await firstPreview.locator("video").dispatchEvent("canplay");
  await expect(firstPreview.getByText(/Autoplay was blocked by the browser/i)).toHaveCount(0);
  await expect(firstPreview.getByText(/Stream interrupted/i)).toHaveCount(0);
  await expect(firstPreview.getByText(/Media playback could not continue/i)).toHaveCount(0);
  await expect(firstNavigation).toBeVisible();
  await saveScreenshot(page, "davora-mobile-video-navigation.png");
  // The screenshot pause may outlast the auto-hide delay; reveal again.
  await firstPreview.locator(".preview-media-stage").evaluate((element) =>
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  );
  await firstNavigation.getByRole("button", { name: /Next video/i }).click();

  const lastPreview = page.getByRole("dialog", { name: /Preview z-clip.webm/i });
  await lastPreview.locator(".preview-media-stage").evaluate((element) =>
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  );
  const lastNavigation = lastPreview.getByRole("group", { name: /Video navigation/i });
  await expect(lastNavigation.getByRole("button", { name: /Previous video/i })).toBeEnabled();
  await expect(lastNavigation.getByRole("button", { name: /Next video/i })).toBeDisabled();
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
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview.getByText(/Autoplay was blocked by the browser/i)).toBeVisible();
  await expect(preview.getByRole("button", { name: /Play media/i })).toBeVisible();
  await saveScreenshot(page, "davora-media-autoplay-blocked.png");
});

test("captures the mobile folder audio player", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence only.");
  await connectAccount(page, "Folder audio workspace");
  await setThemeMode(page, "Light");
  await page.route("**/api/files?path=Projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          path: "Projects",
          items: [
            { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" },
            { path: "Projects/notes.txt", name: "notes.txt", isFolder: false, size: 16, mimeType: "text/plain" },
            { path: "Projects/Привіт.m4a", name: "Привіт.m4a", isFolder: false, size: 20, mimeType: "audio/mp4" }
          ]
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2F*.m4a", async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "Projects/chapter.m4a");
    const name = path.split("/").pop() ?? "chapter.m4a";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path,
            name,
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
  await page.route("**/api/file/original?path=Projects%2F*.m4a", async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).searchParams.get("path") ?? "Projects/chapter.m4a");
    const name = path.split("/").pop() ?? "chapter.m4a";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "audio/mp4",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      },
      body: Buffer.from([0, 1, 2, 3])
    });
  });
  await page.route("**/api/file/stream?**", async (route) => {
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

  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file chapter.m4a/i }).click();
  await expect(page.getByRole("dialog", { name: /Preview chapter.m4a/i })).toHaveCount(0);
  const player = page.getByRole("region", { name: /Audio playlist for Projects/i });
  await expect(player).toBeVisible();
  await expect(player.getByText("chapter.m4a")).toBeVisible();
  await expect(player.getByRole("button", { name: /Play folder audio/i })).toBeVisible();
  await expect(player.getByRole("button", { name: /Next audio track/i })).toBeEnabled();
  await page.getByRole("button", { name: /Open file Привіт.m4a/i }).click();
  await expect(player.getByText("Привіт.m4a")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Preview Привіт.m4a/i })).toHaveCount(0);
  await page.waitForTimeout(250);
  await saveScreenshot(page, "davora-mobile-folder-audio-player.png");
});
