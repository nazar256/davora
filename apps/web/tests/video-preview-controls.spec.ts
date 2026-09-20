import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { connectAccount } from "./support/workspace";
import { saveViewportScreenshot } from "./support/screenshots";

const fixtureDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/media");
const VERTICAL_WEBM = readFileSync(path.join(fixtureDirectory, "vertical.webm"));
const HORIZONTAL_WEBM = readFileSync(path.join(fixtureDirectory, "horizontal.webm"));

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

interface VideoStageGeometry {
  video: { top: number; bottom: number };
  bar: { top: number };
  stage: { top: number; bottom: number };
  viewportHeight: number;
  videoWidth: number;
  videoHeight: number;
}

async function measureVideoStageGeometry(page: Page): Promise<VideoStageGeometry | undefined> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("video.media-preview-video");
    const bar = document.querySelector(".preview-header-actions-immersive");
    const stage = document.querySelector(".preview-media-stage");
    if (!video || !bar || !stage) {
      return undefined;
    }
    const v = video.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      video: { top: v.top, bottom: v.bottom },
      bar: { top: b.top },
      stage: { top: s.top, bottom: s.bottom },
      viewportHeight: innerHeight,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight
    };
  });
}

function expectControlsReachable(geometry: VideoStageGeometry | undefined) {
  expect(geometry).toBeDefined();
  const g = geometry!;
  expect(g.videoWidth).toBeGreaterThan(0);
  // The native controls strip is drawn at the video element's bottom edge.
  // The element must stay inside the media stage so the strip is not
  // clipped or covered by the floating immersive action bar.
  expect(g.video.bottom).toBeLessThanOrEqual(g.stage.bottom + 0.5);
  expect(g.video.bottom).toBeLessThanOrEqual(g.bar.top);
  expect(g.video.bottom).toBeLessThanOrEqual(g.viewportHeight);
}

test("PER-92 vertical video keeps playback controls above the bottom action bar", async ({ page }, testInfo) => {
  await routeStreamTo(page, VERTICAL_WEBM);
  const video = await openVideoPreview(page);
  await expect.poll(async () => (await measureVideoStageGeometry(page))?.videoHeight).toBe(960);

  expectControlsReachable(await measureVideoStageGeometry(page));

  if (process.env.CAPTURE_SCREENSHOTS && testInfo.project.name === "mobile-chrome") {
    await video.tap();
    await page.waitForTimeout(300);
    await saveViewportScreenshot(page, "davora-mobile-video-controls.png");
  }
});

test("PER-92 horizontal video keeps playback controls above the bottom action bar", async ({ page }) => {
  await routeStreamTo(page, HORIZONTAL_WEBM);
  await openVideoPreview(page);
  await expect.poll(async () => (await measureVideoStageGeometry(page))?.videoHeight).toBe(360);

  expectControlsReachable(await measureVideoStageGeometry(page));
});
