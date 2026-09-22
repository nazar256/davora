import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { connectAccount } from "./support/workspace";
import { saveViewportScreenshot } from "./support/screenshots";

const fixtureDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/media");
const VERTICAL_WEBM = readFileSync(path.join(fixtureDirectory, "vertical.webm"));
const HORIZONTAL_WEBM = readFileSync(path.join(fixtureDirectory, "horizontal.webm"));

const OVERLAY_HIDE_DELAY_MS = 3000;

async function routeStreamTo(page: Page, body: Buffer) {
  await page.route("**/api/file/stream?**", async (route) => {
    const range = route.request().headers()["range"];
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : body.length - 1;
      const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
      await route.fulfill({
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-type": "video/webm",
          "content-range": `bytes ${start}-${start + slice.length - 1}/${body.length}`
        },
        body: slice
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "accept-ranges": "bytes", "content-type": "video/webm" },
      body
    });
  });
}

async function openVideoPreview(page: Page) {
  await connectAccount(page, "Video controls workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview).toBeVisible();
  const video = preview.getByLabel(/Video preview clip.mp4/i);
  await expect(video).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) =>
    element.videoWidth > 0
      ? undefined
      : new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }))
  );
  return video;
}

async function revealOverlay(page: Page) {
  await page.locator(".preview-media-stage").evaluate((element) =>
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  );
}

async function expectOverlayHidden(page: Page) {
  await expect(page.locator(".preview-video-overlay")).toHaveClass(/preview-video-overlay-hidden/);
}

async function expectOverlayVisible(page: Page) {
  await expect(page.locator(".preview-video-overlay")).not.toHaveClass(/preview-video-overlay-hidden/);
}

async function startLoopingPlayback(page: Page) {
  // The fixtures are ~1s clips; loop keeps playback alive long enough to
  // observe the auto-hide timer deterministically.
  const video = page.locator("video.media-preview-video");
  await video.evaluate((element: HTMLVideoElement) => {
    element.loop = true;
    return element.paused ? element.play().catch(() => undefined) : undefined;
  });
  // With the default unmuted preference the browser may block autoplay; the
  // "Play media" fallback click is a real user gesture that recovers playback.
  const playFallback = page.getByRole("button", { name: "Play media" });
  await expect.poll(async () => {
    if (!(await video.evaluate((element: HTMLVideoElement) => element.paused))) {
      return true;
    }
    if (await playFallback.isVisible().catch(() => false)) {
      await playFallback.click();
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
}

interface VideoStageGeometry {
  video: { top: number; bottom: number; left: number; right: number };
  stage: { top: number; bottom: number; left: number; right: number };
  overlay: { top: number; bottom: number } | null;
  actionBarPresent: boolean;
  viewportHeight: number;
  viewportWidth: number;
  videoWidth: number;
  videoHeight: number;
  hasNativeControls: boolean;
}

async function measureVideoStageGeometry(page: Page): Promise<VideoStageGeometry | undefined> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("video.media-preview-video");
    const overlay = document.querySelector(".preview-video-overlay");
    const actionBar = document.querySelector(".preview-header-actions-immersive");
    const stage = document.querySelector(".preview-media-stage");
    if (!video || !stage) {
      return undefined;
    }
    const v = video.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const o = overlay?.getBoundingClientRect();
    return {
      video: { top: v.top, bottom: v.bottom, left: v.left, right: v.right },
      stage: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
      overlay: o ? { top: o.top, bottom: o.bottom } : null,
      actionBarPresent: Boolean(actionBar),
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasNativeControls: video.controls
    };
  });
}

function expectScreenFillingGeometry(geometry: VideoStageGeometry | undefined) {
  expect(geometry).toBeDefined();
  const g = geometry!;
  expect(g.videoWidth).toBeGreaterThan(0);
  // PER-93: the media stage spans the whole modal; no Davora bottom action
  // bar exists, so the native controls strip at the video's bottom edge is
  // the only bottom control surface.
  expect(g.actionBarPresent).toBe(false);
  // The modal border accounts for up to ~1px on each edge.
  expect(g.stage.top).toBeLessThanOrEqual(2);
  expect(g.stage.bottom).toBeGreaterThanOrEqual(g.viewportHeight - 2);
  expect(g.stage.left).toBeLessThanOrEqual(2);
  expect(g.stage.right).toBeGreaterThanOrEqual(g.viewportWidth - 2);
  // The video element stays contained inside the stage (object-fit: contain
  // is preserved), so the docked native controls strip remains reachable.
  expect(g.video.bottom).toBeLessThanOrEqual(g.stage.bottom + 0.5);
  expect(g.video.bottom).toBeLessThanOrEqual(g.viewportHeight);
  expect(g.hasNativeControls).toBe(true);
  expect(g.overlay).not.toBeNull();
  expect(g.overlay!.top).toBeLessThan(g.video.top + g.stage.bottom / 2);
}

test("PER-93 video is screen-filling with a top overlay and no bottom action bar", async ({ page }, testInfo) => {
  await routeStreamTo(page, VERTICAL_WEBM);
  const video = await openVideoPreview(page);
  await expect.poll(async () => (await measureVideoStageGeometry(page))?.videoHeight).toBe(960);

  await expectOverlayVisible(page);
  expect(await page.locator(".preview-header-actions-immersive").count()).toBe(0);
  const overlay = page.locator(".preview-video-overlay");
  await expect(overlay.getByRole("button", { name: "Back to files" })).toBeAttached();
  await expect(overlay.getByRole("button", { name: "Previous video" })).toBeAttached();
  await expect(overlay.getByRole("button", { name: "Next video" })).toBeAttached();
  await expect(overlay.locator(".preview-video-overlay-title")).toHaveText("clip.mp4");
  await expect(overlay.locator(".preview-video-overlay-summary")).toBeAttached();

  await startLoopingPlayback(page);
  await expectOverlayHidden(page);
  expectScreenFillingGeometry(await measureVideoStageGeometry(page));

  // Touching the video reveals the overlay controls again.
  await revealOverlay(page);
  await expectOverlayVisible(page);
  await page.waitForTimeout(OVERLAY_HIDE_DELAY_MS + 600);
  await expectOverlayHidden(page);

  if (process.env.CAPTURE_SCREENSHOTS && testInfo.project.name === "mobile-chrome") {
    // Pause pins the overlay so the captured controls are deterministic.
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    await expectOverlayVisible(page);
    await saveViewportScreenshot(page, "davora-mobile-video-controls.png");
  }
});

test("PER-93 pause keeps overlay controls pinned and details pin them while open", async ({ page }) => {
  await routeStreamTo(page, VERTICAL_WEBM);
  const video = await openVideoPreview(page);
  await startLoopingPlayback(page);
  await expectOverlayHidden(page);

  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expectOverlayVisible(page);
  await page.waitForTimeout(OVERLAY_HIDE_DELAY_MS + 600);
  await expectOverlayVisible(page);

  const details = page.locator(".preview-video-overlay-details");
  await details.locator(".preview-video-overlay-summary").click();
  await expect(details.locator(".preview-video-details-panel")).toBeVisible();
  await expect(details.locator(".preview-video-details-panel").getByRole("button", { name: /Download/i })).toBeVisible();

  await video.evaluate((element: HTMLVideoElement) => element.play().catch(() => undefined));
  await startLoopingPlayback(page);
  // Details stay open and pin the overlay while playback continues.
  await expectOverlayVisible(page);
  await page.waitForTimeout(OVERLAY_HIDE_DELAY_MS + 600);
  await expectOverlayVisible(page);
});

test("PER-93 touch tap on the video reveals overlay controls", async ({ page }, testInfo) => {
  // Mobile browsers may consume pointerdown on <video controls> for their
  // native control surface; real touch input must still reveal the overlay.
  test.skip(testInfo.project.name !== "mobile-chrome", "Touch input only.");
  await routeStreamTo(page, VERTICAL_WEBM);
  await openVideoPreview(page);
  await startLoopingPlayback(page);
  await expectOverlayHidden(page);

  await page.locator("video.media-preview-video").tap();
  await expectOverlayVisible(page);
});

test("PER-93 video mute state follows the persisted global preference", async ({ page }) => {
  await routeStreamTo(page, VERTICAL_WEBM);
  const video = await openVideoPreview(page);
  // Videos default to unmuted; only a remembered mute applies.
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(false);

  await video.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    element.dispatchEvent(new Event("volumechange"));
  });
  await expect.poll(async () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}").videoMuted)
  ).toBe(true);

  // Reopening the video remounts the element and honors the remembered state.
  await revealOverlay(page);
  await page.locator(".preview-video-overlay").getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const reopened = page
    .getByRole("dialog", { name: /Preview clip.mp4/i })
    .getByLabel(/Video preview clip.mp4/i);
  await expect(reopened).toBeVisible();
  await expect.poll(() => reopened.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
});

test("PER-93 horizontal video stays screen-filling and contained", async ({ page }) => {
  await routeStreamTo(page, HORIZONTAL_WEBM);
  await openVideoPreview(page);
  await expect.poll(async () => (await measureVideoStageGeometry(page))?.videoHeight).toBe(360);

  await startLoopingPlayback(page);
  await expectOverlayHidden(page);
  expectScreenFillingGeometry(await measureVideoStageGeometry(page));
});
