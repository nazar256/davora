import { expect, test } from "@playwright/test";

import { connectScreenshotAccount as connectAccount, saveScreenshot, setupScreenshotSuite, setThemeMode } from "./support/screenshots";

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Run this spec only when refreshing checked-in screenshot artifacts.");
setupScreenshotSuite();

test("captures PER-72 image, PDF, video, and folder audio surfaces in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop evidence only.");
  test.setTimeout(120_000);
  await connectAccount(page, "PER-72 media workspace");

  for (const mode of ["Light", "Dark"] as const) {
    const suffix = mode.toLowerCase();
    await setThemeMode(page, mode);
    const homeButton = page.getByRole("button", { name: /Go to home folder/i });
    if (await homeButton.count()) {
      await homeButton.click();
    }

    await page.getByRole("button", { name: /Open folder Archive/i }).click();
    await page.getByRole("button", { name: /Open file photo.png/i }).click();
    const imagePreview = page.getByRole("dialog", { name: /Preview photo.png/i });
    await expect(imagePreview.getByRole("button", { name: /Back to files/i })).toHaveText(/Back to Archive/i);
    await saveScreenshot(page, `davora-media-image-${suffix}.png`);
    await imagePreview.getByRole("button", { name: /Back to files/i }).click();

    await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
    const pdfPreview = page.getByRole("dialog", { name: /Preview guide.pdf/i });
    await expect(pdfPreview.locator('.pdf-canvas[data-render-state="ready"]').first()).toBeVisible();
    await pdfPreview.getByRole("button", { name: /Fit PDF to page/i }).click();
    await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toHaveAttribute("aria-pressed", "true");
    await expect(pdfPreview.getByText("Rendering PDF...")).toBeVisible();
    await expect(pdfPreview.getByText("Rendering PDF...")).toHaveCount(0);
    await expect(pdfPreview.locator('.pdf-canvas[data-render-state="ready"]').first()).toBeVisible();
    await pdfPreview.locator(".pdf-canvas-scroll").evaluate((element) => element.scrollTo({ left: 0, top: 0 }));
    await saveScreenshot(page, `davora-media-pdf-${suffix}.png`);
    await pdfPreview.getByRole("button", { name: /Back to files/i }).click();

    await page.getByRole("button", { name: /Go to home folder/i }).click();
    await page.getByRole("button", { name: /Open folder Projects/i }).click();
    await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
    const videoPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
    await expect(videoPreview.getByRole("group", { name: /Video navigation/i })).toBeVisible();
    await saveScreenshot(page, `davora-media-video-${suffix}.png`);
    await videoPreview.getByRole("button", { name: /Back to files/i }).click();

    await page.getByRole("button", { name: /Open file song.mp3/i }).click();
    const folderPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
    await expect(folderPlayer).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toHaveCount(0);
    await saveScreenshot(page, `davora-media-audio-folder-${suffix}.png`);
    await folderPlayer.getByRole("button", { name: /Close folder audio player/i }).click();
  }
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
