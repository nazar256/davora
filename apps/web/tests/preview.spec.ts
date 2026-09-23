import { expect, test, type Download, type Page } from "@playwright/test";

import { connectAccount, createGate, openSettings } from "./support/workspace";

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

async function readDownloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Browser download stream is unavailable.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("preview supports markdown MIME variants, inline PDF rendering, and PDF open fallback", async ({ page, context }, testInfo) => {
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
    const captureImageAnchor = async (fitMode: "fill" | "fit" | undefined, normalizedX: number, normalizedY: number) => imageStage.evaluate(
      (element, options) => {
        const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
        if (!image) {
          throw new Error("Image preview is missing.");
        }
        const imageRect = image.getBoundingClientRect();
        const widthScale = imageRect.width / image.naturalWidth;
        const heightScale = imageRect.height / image.naturalHeight;
        const contentScale = options.fitMode === "fill"
          ? Math.max(widthScale, heightScale)
          : options.fitMode === "fit"
            ? Math.min(widthScale, heightScale)
            : undefined;
        const contentWidth = contentScale === undefined ? imageRect.width : image.naturalWidth * contentScale;
        const contentHeight = contentScale === undefined ? imageRect.height : image.naturalHeight * contentScale;
        const objectPosition = getComputedStyle(image).objectPosition.split(/\s+/).map((value) => Number.parseFloat(value));
        const positionX = Number.isFinite(objectPosition[0]) ? objectPosition[0] / 100 : 0.5;
        const positionY = Number.isFinite(objectPosition[1]) ? objectPosition[1] / 100 : 0.5;
        const contentLeft = imageRect.left + (imageRect.width - contentWidth) * positionX;
        const contentTop = imageRect.top + (imageRect.height - contentHeight) * positionY;
        return {
          anchorClientX: contentLeft + contentWidth * options.normalizedX,
          anchorClientY: contentTop + contentHeight * options.normalizedY,
          contentLeft,
          contentTop,
          contentWidth,
          contentHeight,
          normalizedX: options.normalizedX,
          normalizedY: options.normalizedY
        };
      },
      { fitMode, normalizedX, normalizedY }
    );
    const getImageAnchorDelta = async (before: Awaited<ReturnType<typeof captureImageAnchor>>) => imageStage.evaluate((element, anchorState) => {
      const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
      const imageRect = image?.getBoundingClientRect();
      if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) {
        return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
      }
      return {
        x: Math.abs((anchorState.anchorClientX - imageRect.left) / imageRect.width - anchorState.normalizedX),
        y: Math.abs((anchorState.anchorClientY - imageRect.top) / imageRect.height - anchorState.normalizedY)
      };
    }, before);

    await expect(imageElement).toHaveClass(/media-preview-image-fill/);
    const fillAnchor = await captureImageAnchor("fill", 0.78, 0.25);
    const expectedFirstWheelWidth = await imageStage.evaluate((element) => {
      const displayedScale = Math.max(element.clientWidth / 1200, element.clientHeight / 800);
      return (displayedScale + 0.15) * 1200;
    });
    await imageStage.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: fillAnchor.anchorClientX,
      clientY: fillAnchor.anchorClientY,
      ctrlKey: true,
      deltaY: -300
    });
    await expect(imageElement).toHaveClass(/media-preview-image-zoomed/);
    await expect.poll(async () => {
      const box = await imageElement.boundingBox();
      return Math.abs((box?.width ?? 0) - expectedFirstWheelWidth);
    }).toBeLessThan(12);
    await expect.poll(async () => (await getImageAnchorDelta(fillAnchor)).x).toBeLessThan(0.025);
    await expect.poll(async () => (await getImageAnchorDelta(fillAnchor)).y).toBeLessThan(0.025);

    await imagePreview.getByRole("button", { name: /Fill preview area/i }).click();
    await expect(imageElement).toHaveClass(/media-preview-image-fill/);
    const stageBoxFill = await imageStage.boundingBox();
    const imageBoxFill = await imageElement.boundingBox();
    expect(Math.abs((imageBoxFill?.width ?? 0) - (stageBoxFill?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((imageBoxFill?.height ?? 0) - (stageBoxFill?.height ?? 0))).toBeLessThanOrEqual(1);
    const fillStageScreenshot = await imageStage.screenshot();
    await imagePreview.getByRole("button", { name: /Fit entire image/i }).click();
    await expect(imageElement).toHaveClass(/media-preview-image-fit/);
    await expect(imageElement).toHaveCSS("object-fit", "contain");
    const stageBoxFit = await imageStage.boundingBox();
    const imageBoxFit = await imageElement.boundingBox();
    expect(Math.abs((imageBoxFit?.width ?? 0) - (stageBoxFit?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((imageBoxFit?.height ?? 0) - (stageBoxFit?.height ?? 0))).toBeLessThanOrEqual(1);
    const fitStageScreenshot = await imageStage.screenshot();
    expect(fitStageScreenshot.equals(fillStageScreenshot)).toBe(false);
    const fitAnchor = await captureImageAnchor("fit", 0.22, 0.75);
    await imageStage.dispatchEvent("touchstart", {
      touches: [
        { identifier: 1, clientX: fitAnchor.anchorClientX - 50, clientY: fitAnchor.anchorClientY },
        { identifier: 2, clientX: fitAnchor.anchorClientX + 50, clientY: fitAnchor.anchorClientY }
      ]
    });
    await imageStage.dispatchEvent("touchmove", {
      touches: [
        { identifier: 1, clientX: fitAnchor.anchorClientX - 70, clientY: fitAnchor.anchorClientY },
        { identifier: 2, clientX: fitAnchor.anchorClientX + 70, clientY: fitAnchor.anchorClientY }
      ]
    });
    await imageStage.dispatchEvent("touchend", { touches: [] });
    await expect(imageElement).toHaveClass(/media-preview-image-zoomed/);
    await expect.poll(async () => (await getImageAnchorDelta(fitAnchor)).x).toBeLessThan(0.025);
    await expect.poll(async () => (await getImageAnchorDelta(fitAnchor)).y).toBeLessThan(0.025);

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const repeatedCustomAnchor = await captureImageAnchor(undefined, 0.78, 0.75);
      const zoomBeforeRepeatedCustomWheel = await originalSizeButton.getAttribute("aria-label");
      await imageStage.dispatchEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: repeatedCustomAnchor.anchorClientX,
        clientY: repeatedCustomAnchor.anchorClientY,
        ctrlKey: true,
        deltaY: -300
      });
      await expect.poll(async () => originalSizeButton.getAttribute("aria-label")).not.toBe(zoomBeforeRepeatedCustomWheel);
      await expect.poll(async () => (await getImageAnchorDelta(repeatedCustomAnchor)).x).toBeLessThan(0.025);
      await expect.poll(async () => (await getImageAnchorDelta(repeatedCustomAnchor)).y).toBeLessThan(0.025);
    }
    if (testInfo.project.name.includes("mobile")) {
      await expect.poll(async () => imageStage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    }

    await originalSizeButton.click();
    await expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
    await expect(imageElement).toHaveClass(/media-preview-image-zoomed/);
    const originalSizeImageBox = await imageElement.boundingBox();
    expect(Math.round(originalSizeImageBox?.width ?? 0)).toBe(1200);
    await expect.poll(async () => imageStage.evaluate((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)).toBe(true);
    if (testInfo.project.name.includes("mobile")) {
      await expect.poll(async () => imageStage.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await imageStage.evaluate((element) => {
        element.scrollLeft = 0;
        element.scrollTop = 0;
      });
      await imageStage.dispatchEvent("touchstart", {
        touches: [{ identifier: 11, clientX: 260, clientY: 220 }]
      });
      await imageStage.dispatchEvent("touchmove", {
        touches: [{ identifier: 11, clientX: 80, clientY: 220 }]
      });
      await imageStage.dispatchEvent("touchend", { touches: [] });
      await expect.poll(async () => imageStage.evaluate((element) => element.scrollLeft)).toBeGreaterThan(80);
    }

    await imageStage.evaluate((element) => {
      element.scrollLeft = Math.min(120, Math.max(0, element.scrollWidth - element.clientWidth));
      element.scrollTop = Math.min(90, Math.max(0, element.scrollHeight - element.clientHeight));
    });
    const imageWheelAnchor = await imageStage.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientX: rect.left + rect.width * 0.78,
        clientY: rect.top + rect.height * 0.25
      };
    });
    const imageBeforeAnchoredWheel = await imageStage.evaluate((element, anchor) => {
      const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
      return {
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        imageWidth: image?.getBoundingClientRect().width ?? 0,
        imageHeight: image?.getBoundingClientRect().height ?? 0,
        imageLeft: image?.getBoundingClientRect().left ?? 0,
        imageTop: image?.getBoundingClientRect().top ?? 0,
        anchorClientX: anchor.clientX,
        anchorClientY: anchor.clientY,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight
      };
    }, imageWheelAnchor);
    const zoomBeforeWheel = await originalSizeButton.getAttribute("aria-label");
    await imageStage.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: imageWheelAnchor.clientX,
      clientY: imageWheelAnchor.clientY,
      ctrlKey: true,
      deltaY: -600
    });
    await expect.poll(async () => originalSizeButton.getAttribute("aria-label")).not.toBe(zoomBeforeWheel);
    await expect.poll(async () => imageStage.evaluate((element) => element.scrollLeft)).toBeGreaterThan(imageBeforeAnchoredWheel.scrollLeft);
    const imageAfterAnchoredWheel = await imageStage.evaluate((element) => {
      const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
      return {
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        imageWidth: image?.getBoundingClientRect().width ?? 0,
        imageHeight: image?.getBoundingClientRect().height ?? 0,
        imageLeft: image?.getBoundingClientRect().left ?? 0,
        imageTop: image?.getBoundingClientRect().top ?? 0,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight
      };
    });
    const imageWheelPointBefore = {
      x: (imageBeforeAnchoredWheel.anchorClientX - imageBeforeAnchoredWheel.imageLeft) / imageBeforeAnchoredWheel.imageWidth,
      y: (imageBeforeAnchoredWheel.anchorClientY - imageBeforeAnchoredWheel.imageTop) / imageBeforeAnchoredWheel.imageHeight
    };
    const imageWheelPointAfter = {
      x: (imageBeforeAnchoredWheel.anchorClientX - imageAfterAnchoredWheel.imageLeft) / imageAfterAnchoredWheel.imageWidth,
      y: (imageBeforeAnchoredWheel.anchorClientY - imageAfterAnchoredWheel.imageTop) / imageAfterAnchoredWheel.imageHeight
    };
    expect(Math.abs(imageWheelPointAfter.x - imageWheelPointBefore.x)).toBeLessThan(0.025);
    expect(Math.abs(imageWheelPointAfter.y - imageWheelPointBefore.y)).toBeLessThan(0.025);

    const zoomBeforePinch = await originalSizeButton.getAttribute("aria-label");
    await imageStage.evaluate((element) => {
      element.scrollLeft = Math.min(160, Math.max(0, element.scrollWidth - element.clientWidth));
      element.scrollTop = Math.min(110, Math.max(0, element.scrollHeight - element.clientHeight));
    });
    const imagePinchAnchor = await imageStage.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientX: rect.left + rect.width * 0.22,
        clientY: rect.top + rect.height * 0.75
      };
    });
    const imageBeforeAnchoredPinch = await imageStage.evaluate((element, anchor) => {
      const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
      return {
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        imageWidth: image?.getBoundingClientRect().width ?? 0,
        imageHeight: image?.getBoundingClientRect().height ?? 0,
        imageLeft: image?.getBoundingClientRect().left ?? 0,
        imageTop: image?.getBoundingClientRect().top ?? 0,
        anchorClientX: anchor.clientX,
        anchorClientY: anchor.clientY,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight
      };
    }, imagePinchAnchor);
    await imageStage.dispatchEvent("touchstart", {
      touches: [
        { identifier: 1, clientX: imagePinchAnchor.clientX - 50, clientY: imagePinchAnchor.clientY },
        { identifier: 2, clientX: imagePinchAnchor.clientX + 50, clientY: imagePinchAnchor.clientY }
      ]
    });
    await imageStage.dispatchEvent("touchmove", {
      touches: [
        { identifier: 1, clientX: imagePinchAnchor.clientX - 80, clientY: imagePinchAnchor.clientY },
        { identifier: 2, clientX: imagePinchAnchor.clientX + 80, clientY: imagePinchAnchor.clientY }
      ]
    });
    await imageStage.dispatchEvent("touchend", { touches: [] });
    await expect.poll(async () => originalSizeButton.getAttribute("aria-label")).not.toBe(zoomBeforePinch);
    const imageAfterAnchoredPinch = await imageStage.evaluate((element) => {
      const image = element.querySelector("img.media-preview-image") as HTMLImageElement | null;
      return {
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        imageWidth: image?.getBoundingClientRect().width ?? 0,
        imageHeight: image?.getBoundingClientRect().height ?? 0,
        imageLeft: image?.getBoundingClientRect().left ?? 0,
        imageTop: image?.getBoundingClientRect().top ?? 0,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight
      };
    });
    const imagePinchPointBefore = {
      x: (imageBeforeAnchoredPinch.anchorClientX - imageBeforeAnchoredPinch.imageLeft) / imageBeforeAnchoredPinch.imageWidth,
      y: (imageBeforeAnchoredPinch.anchorClientY - imageBeforeAnchoredPinch.imageTop) / imageBeforeAnchoredPinch.imageHeight
    };
    const imagePinchPointAfter = {
      x: (imageBeforeAnchoredPinch.anchorClientX - imageAfterAnchoredPinch.imageLeft) / imageAfterAnchoredPinch.imageWidth,
      y: (imageBeforeAnchoredPinch.anchorClientY - imageAfterAnchoredPinch.imageTop) / imageAfterAnchoredPinch.imageHeight
    };
    const pinchGeometry = JSON.stringify({ before: imageBeforeAnchoredPinch, after: imageAfterAnchoredPinch });
    expect(Math.abs(imagePinchPointAfter.x - imagePinchPointBefore.x), pinchGeometry).toBeLessThan(0.025);
    expect(Math.abs(imagePinchPointAfter.y - imagePinchPointBefore.y), pinchGeometry).toBeLessThan(0.025);
  } else {
    await expect(imagePreview.getByRole("button", { name: /Open or download original file/i })).toBeVisible();
    await expect(imagePreview.getByRole("button", { name: /Download file/i })).toBeVisible();
  }
  await imagePreview.getByRole("button", { name: /Back to files/i }).click();

  await page.getByRole("button", { name: /Open file photo.heic/i }).click();
  const heicPreview = page.getByRole("dialog", { name: /Preview photo.heic/i });
  await expect(heicPreview).toBeVisible();
  await expect(heicPreview.getByText(/HEIC preview is experimental and disabled/i)).toBeVisible();
  await expect(heicPreview.getByRole("button", { name: /Open or download original file/i })).toBeVisible();
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
  const firstPdfCanvas = pdfScroll.locator(".pdf-canvas").first();
  await pdfScroll.hover();
  await page.mouse.wheel(0, 900);
  await expect(pdfPreview.getByText("Page 2 of 2")).toBeVisible();
  await pdfPreview.getByRole("button", { name: /Fit PDF to page/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to page/i })).toHaveAttribute("aria-pressed", "true");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "loading");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "ready");
  await pdfPreview.getByRole("button", { name: /Fit PDF to width/i }).click();
  await expect(pdfPreview.getByRole("button", { name: /Fit PDF to width/i })).toHaveAttribute("aria-pressed", "true");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "loading");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "ready");

  const zoomLabel = pdfPreview.locator(".pdf-canvas-zoom");
  await pdfScroll.evaluate((element) => {
    element.scrollTop = 160;
  });
  const pdfWheelAnchor = await pdfScroll.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientX: rect.left + rect.width * 0.78,
      clientY: rect.top + rect.height * 0.25
    };
  });
  const pdfBeforeAnchoredWheel = await pdfScroll.evaluate((element, anchor) => {
    const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>(".pdf-canvas"));
    const canvasIndex = canvases.reduce((nearestIndex, canvas, index) => {
      const nearestRect = canvases[nearestIndex]?.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const distance = Math.hypot(
        Math.max(canvasRect.left - anchor.clientX, 0, anchor.clientX - canvasRect.right),
        Math.max(canvasRect.top - anchor.clientY, 0, anchor.clientY - canvasRect.bottom)
      );
      const nearestDistance = nearestRect
        ? Math.hypot(
          Math.max(nearestRect.left - anchor.clientX, 0, anchor.clientX - nearestRect.right),
          Math.max(nearestRect.top - anchor.clientY, 0, anchor.clientY - nearestRect.bottom)
        )
        : Number.POSITIVE_INFINITY;
      return distance < nearestDistance ? index : nearestIndex;
    }, 0);
    const canvas = canvases[canvasIndex];
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      canvasIndex,
      scrollTop: element.scrollTop,
      canvasWidth: canvasRect?.width ?? 0,
      canvasHeight: canvasRect?.height ?? 0,
      canvasLeft: canvasRect?.left ?? 0,
      canvasTop: canvasRect?.top ?? 0,
      anchorClientX: anchor.clientX,
      anchorClientY: anchor.clientY
    };
  }, pdfWheelAnchor);
  const getPdfAnchorDelta = async (before: typeof pdfBeforeAnchoredWheel) => pdfScroll.evaluate((element, anchorState) => {
    const canvas = element.querySelectorAll<HTMLCanvasElement>(".pdf-canvas")[anchorState.canvasIndex];
    const canvasRect = canvas?.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
      return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
    }
    const pointBefore = {
      x: (anchorState.anchorClientX - anchorState.canvasLeft) / anchorState.canvasWidth,
      y: (anchorState.anchorClientY - anchorState.canvasTop) / anchorState.canvasHeight
    };
    const pointAfter = {
      x: (anchorState.anchorClientX - canvasRect.left) / canvasRect.width,
      y: (anchorState.anchorClientY - canvasRect.top) / canvasRect.height
    };
    return {
      x: Math.abs(pointAfter.x - pointBefore.x),
      y: Math.abs(pointAfter.y - pointBefore.y),
      pointBefore,
      pointAfter,
      canvasRect: {
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height
      },
      scroll: {
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.scrollWidth,
        height: element.scrollHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight
      }
    };
  }, before);
  const zoomBeforeWheel = await zoomLabel.textContent();
  await pdfScroll.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: pdfWheelAnchor.clientX,
    clientY: pdfWheelAnchor.clientY,
    ctrlKey: true,
    deltaY: -700
  });
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "loading");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "ready");
  await expect.poll(async () => zoomLabel.textContent()).not.toBe(zoomBeforeWheel);
  await expect.poll(async () => pdfScroll.evaluate((element) => {
    const canvas = element.querySelector(".pdf-canvas") as HTMLCanvasElement | null;
    return canvas?.getBoundingClientRect().height ?? 0;
  })).toBeGreaterThan(pdfBeforeAnchoredWheel.canvasHeight + 8);
  await expect.poll(async () => (await getPdfAnchorDelta(pdfBeforeAnchoredWheel)).x).toBeLessThan(0.025);
  await expect.poll(async () => (await getPdfAnchorDelta(pdfBeforeAnchoredWheel)).y).toBeLessThan(0.025);

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
  const pinchOut = Number.parseInt(zoomBeforePinch ?? "0", 10) < 250;
  const pinchEndHalfDistance = pinchOut ? 70 : 30;
  await pdfScroll.evaluate((element) => {
    element.scrollTop = 180;
  });
  const pdfPinchAnchor = await pdfScroll.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientX: rect.left + rect.width * 0.22,
      clientY: rect.top + rect.height * 0.72
    };
  });
  const pdfBeforeAnchoredPinch = await pdfScroll.evaluate((element, anchor) => {
    const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>(".pdf-canvas"));
    const canvasIndex = canvases.reduce((nearestIndex, canvas, index) => {
      const nearestRect = canvases[nearestIndex]?.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const distance = Math.hypot(
        Math.max(canvasRect.left - anchor.clientX, 0, anchor.clientX - canvasRect.right),
        Math.max(canvasRect.top - anchor.clientY, 0, anchor.clientY - canvasRect.bottom)
      );
      const nearestDistance = nearestRect
        ? Math.hypot(
          Math.max(nearestRect.left - anchor.clientX, 0, anchor.clientX - nearestRect.right),
          Math.max(nearestRect.top - anchor.clientY, 0, anchor.clientY - nearestRect.bottom)
        )
        : Number.POSITIVE_INFINITY;
      return distance < nearestDistance ? index : nearestIndex;
    }, 0);
    const canvas = canvases[canvasIndex];
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      canvasIndex,
      scrollTop: element.scrollTop,
      canvasWidth: canvasRect?.width ?? 0,
      canvasHeight: canvasRect?.height ?? 0,
      canvasLeft: canvasRect?.left ?? 0,
      canvasTop: canvasRect?.top ?? 0,
      anchorClientX: anchor.clientX,
      anchorClientY: anchor.clientY
    };
  }, pdfPinchAnchor);
  await pdfScroll.dispatchEvent("touchstart", {
    touches: [
      { identifier: 1, clientX: pdfPinchAnchor.clientX - 50, clientY: pdfPinchAnchor.clientY },
      { identifier: 2, clientX: pdfPinchAnchor.clientX + 50, clientY: pdfPinchAnchor.clientY }
    ]
  });
  await pdfScroll.dispatchEvent("touchmove", {
    touches: [
      { identifier: 1, clientX: pdfPinchAnchor.clientX - pinchEndHalfDistance, clientY: pdfPinchAnchor.clientY },
      { identifier: 2, clientX: pdfPinchAnchor.clientX + pinchEndHalfDistance, clientY: pdfPinchAnchor.clientY }
    ]
  });
  await pdfScroll.dispatchEvent("touchend", { touches: [] });
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "loading");
  await expect(firstPdfCanvas).toHaveAttribute("data-render-state", "ready");
  await expect.poll(async () => zoomLabel.textContent()).not.toBe(zoomBeforePinch);
  const firstCanvasHeightAfterPinch = async () => pdfScroll.evaluate((element) => {
    const canvas = element.querySelector(".pdf-canvas") as HTMLCanvasElement | null;
    return canvas?.getBoundingClientRect().height ?? 0;
  });
  if (pinchOut) {
    await expect.poll(firstCanvasHeightAfterPinch).toBeGreaterThan(pdfBeforeAnchoredPinch.canvasHeight + 8);
  } else {
    await expect.poll(firstCanvasHeightAfterPinch).toBeLessThan(pdfBeforeAnchoredPinch.canvasHeight - 8);
  }
  await expect.poll(async () => {
    const geometry = await getPdfAnchorDelta(pdfBeforeAnchoredPinch);
    return geometry.x < 0.025 ? "anchored" : JSON.stringify(geometry);
  }).toBe("anchored");
  await expect.poll(async () => {
    const geometry = await getPdfAnchorDelta(pdfBeforeAnchoredPinch);
    return geometry.y < 0.025 ? "anchored" : JSON.stringify(geometry);
  }).toBe("anchored");
  await expect(pdfPreview.getByText(/PDF rendering depends on browser support/i)).toHaveCount(0);
  await expect(pdfPreview.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)).toHaveCount(0);
  await pdfPreview.getByRole("button", { name: /Open or download original file/i }).click();
  const pdfPage = await newPagePromise;
  // Blob URLs do not reliably fire domcontentloaded across Chrome variants; the URL itself is the invariant.
  await expect(pdfPage).toHaveURL(/blob:/);
  expect(await pdfPage.evaluate(() => window.opener === null)).toBe(true);
});

const unsafeOriginalCases = [
  {
    name: "active HTML",
    mimeType: "text/html",
    filename: "..%2Funsafe%0Afile.html",
    safeFilename: "_unsafe_file.html",
    bytes: Buffer.from("<!doctype html><script>localStorage.setItem('davora-security-mutated','yes');fetch('/davora-security-sentinel?value='+encodeURIComponent(localStorage.getItem('davora-security-sentinel')||''))</script>"),
    mobile: true
  },
  {
    name: "active SVG",
    mimeType: "image/svg+xml",
    filename: "..%2Funsafe%0Afile.svg",
    safeFilename: "_unsafe_file.svg",
    bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload=\"localStorage.setItem('davora-security-mutated','yes');fetch('/davora-security-sentinel?value='+encodeURIComponent(localStorage.getItem('davora-security-sentinel')||''))\"></svg>"),
    mobile: true
  },
  {
    name: "HTML mislabeled as PNG",
    mimeType: "image/png",
    filename: "misleading.png",
    safeFilename: "misleading.png",
    bytes: Buffer.from("<!doctype html><script>localStorage.setItem('davora-security-mutated','yes')</script>"),
    mobile: false
  },
  {
    name: "HTML mislabeled as PDF",
    mimeType: "application/pdf",
    filename: "misleading.pdf",
    safeFilename: "misleading.pdf",
    bytes: Buffer.from("<!doctype html><script>localStorage.setItem('davora-security-mutated','yes')</script>"),
    mobile: false
  }
] as const;

for (const unsafeCase of unsafeOriginalCases) {
  test(`original-file handoff downloads ${unsafeCase.name} without executing it`, async ({ page, context }, testInfo) => {
    test.skip(!unsafeCase.mobile && testInfo.project.name.includes("mobile"), "Desktop evidence covers mislabeled passive MIME cases.");
    let serveUnsafeOriginal = false;
    let sentinelRequests = 0;
    const popupPages: Page[] = [];
    context.on("page", (popupPage) => popupPages.push(popupPage));
    await page.route("**/davora-security-sentinel**", async (route) => {
      sentinelRequests += 1;
      await route.fulfill({ status: 204 });
    });
    await page.route("**/api/file/original?path=Archive%2Fguide.pdf", async (route) => {
      if (!serveUnsafeOriginal) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": unsafeCase.mimeType,
          "content-disposition": `attachment; filename*=UTF-8''${unsafeCase.filename}`
        },
        body: unsafeCase.bytes
      });
    });

    await connectAccount(page, `Unsafe original ${unsafeCase.name}`);
    await page.evaluate(() => {
      localStorage.setItem("davora-security-sentinel", "non-secret-browser-sentinel");
      localStorage.removeItem("davora-security-mutated");
    });
    await page.getByRole("button", { name: /Open folder Archive/i }).click();
    await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
    const preview = page.getByRole("dialog", { name: /Preview guide.pdf/i });
    await expect(preview).toBeVisible();
    await expect(preview.locator(".pdf-canvas[data-render-state='ready']").first()).toBeVisible();
    serveUnsafeOriginal = true;

    const downloadPromise = page.waitForEvent("download");
    await preview.getByRole("button", { name: /Open or download original file/i }).click();
    const download = await downloadPromise;
    await expect.poll(() => popupPages.every((popupPage) => popupPage.isClosed())).toBe(true);
    expect(download.suggestedFilename()).toBe(unsafeCase.safeFilename);
    expect(await readDownloadBytes(download)).toEqual(unsafeCase.bytes);
    await page.waitForTimeout(100);
    expect(sentinelRequests).toBe(0);
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("davora-security-mutated"))).toBeNull();
    await expect(preview).toBeVisible();
  });
}

test("signature-valid PNG original opens only through an isolated passive Blob page", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "One desktop browser pass is sufficient for passive PNG navigation.");
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await page.route("**/api/file?path=Archive%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { file: { path: "Archive/photo.png", name: "photo.png", isFolder: false, size: validPng.length, mimeType: "image/png", viewer: "image", content: "", encoding: "none", truncated: false, bytesRead: 0, requiresOriginalBlob: true } } })
    });
  });
  await page.route("**/api/file/original?path=Archive%2Fphoto.png", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png", "content-disposition": "attachment; filename*=UTF-8''photo.png" },
      body: validPng
    });
  });

  await connectAccount(page, "Passive PNG workspace");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file photo.png/i }).click();
  const preview = page.getByRole("dialog", { name: /Preview photo.png/i });
  await expect(preview.getByText(/Image preview is unavailable right now/i)).toBeVisible();
  const popupPromise = context.waitForEvent("page");
  await preview.getByRole("button", { name: /Open or download original file/i }).click();
  const popupPage = await popupPromise;
  await expect(popupPage).toHaveURL(/blob:/);
  expect(await popupPage.evaluate(() => window.opener === null)).toBe(true);
});

test("closing a preview cancels its pending original-file popup without disturbing the replacement preview", async ({ page, context }) => {
  const originalFileGate = createGate();
  let originalRoutesStarted = 0;
  let originalRoutesSettled = 0;

  await page.addInitScript(() => {
    const increment = (key: string) => {
      sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + 1));
    };
    const browserFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      if (requestUrl.includes("/api/file/original")) {
        increment("davora-original-open-starts");
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (signal?.aborted) {
          increment("davora-original-open-aborts");
        } else {
          signal?.addEventListener("abort", () => increment("davora-original-open-aborts"), { once: true });
        }
      }
      return browserFetch(input, init);
    };
  });
  await page.route("**/api/file/original?path=Archive%2Fguide.pdf", async (route) => {
    originalRoutesStarted += 1;
    await originalFileGate.promise;
    try {
      await route.fallback();
    } finally {
      originalRoutesSettled += 1;
    }
  });

  await connectAccount(page, "Original lifecycle workspace");
  await page.getByRole("button", { name: /Open folder Archive/i }).click();
  await page.getByRole("button", { name: /Open file guide.pdf/i }).click();
  const pdfPreview = page.getByRole("dialog", { name: /Preview guide.pdf/i });
  await expect(pdfPreview).toBeVisible();
  await expect.poll(async () => page.evaluate(() => Number(sessionStorage.getItem("davora-original-open-starts") ?? "0"))).toBeGreaterThanOrEqual(1);
  const startsBeforeOpen = await page.evaluate(() => Number(sessionStorage.getItem("davora-original-open-starts") ?? "0"));

  const popupPromise = context.waitForEvent("page");
  await pdfPreview.getByRole("button", { name: /Open or download original file/i }).click();
  const pendingPopup = await popupPromise;
  expect(await pendingPopup.evaluate(() => window.opener === null)).toBe(true);
  await expect.poll(async () => page.evaluate(() => Number(sessionStorage.getItem("davora-original-open-starts") ?? "0"))).toBe(startsBeforeOpen + 1);

  await pdfPreview.getByRole("button", { name: /Back to files/i }).click();
  await expect(pdfPreview).toHaveCount(0);
  await expect.poll(() => pendingPopup.isClosed()).toBe(true);
  await expect.poll(async () => page.evaluate(() => Number(sessionStorage.getItem("davora-original-open-aborts") ?? "0"))).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: /Open file photo.heic/i }).click();
  const replacementPreview = page.getByRole("dialog", { name: /Preview photo.heic/i });
  await expect(replacementPreview).toBeVisible();
  await expect(replacementPreview.getByText(/Unable to open the original file/i)).toHaveCount(0);
  await expect(replacementPreview.getByText(/Opening original/i)).toHaveCount(0);

  originalFileGate.release();
  await expect.poll(() => originalRoutesSettled).toBe(originalRoutesStarted);
  await expect(replacementPreview).toBeVisible();
  await expect(replacementPreview.getByText(/Unable to open the original file/i)).toHaveCount(0);
  expect(pendingPopup.isClosed()).toBe(true);
});

test("mobile preview toolbar keeps long image actions separated and tappable", async ({ page }) => {
  await renderMobilePreviewToolbarFixture(page);
  const toolbar = page.locator(".preview-header-actions");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(":scope > button, :scope > details")).toHaveCount(5);

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
    expect(action.height, `${action.label} height`).toBeGreaterThanOrEqual(44);
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

  const openOriginal = actionBoxes.find((action) => action.label === "Get original");
  expect(openOriginal).toMatchObject({ overflow: "hidden", textOverflow: "ellipsis" });
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(new Set(actionBoxes.map((action) => Math.round(action.top))).size).toBe(1);
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

  const folderAudioPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
  await expect(folderAudioPlayer).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toHaveCount(0);
  await folderAudioPlayer.getByRole("button", { name: /Close folder audio player/i }).click();

  await page.getByRole("button", { name: /Open file photo.png/i }).click();
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

test("image preview navigation uses viewport-fixed edge zones", async ({ page }) => {
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

  const imagePreview = page.getByRole("dialog", { name: /Preview photo-b.png/i });
  await expect(imagePreview).toBeVisible();
  const previousZone = imagePreview.getByRole("button", { name: /Previous media item/i });
  const nextZone = imagePreview.getByRole("button", { name: /Next media item/i });
  await expect(previousZone).toBeVisible();
  await expect(nextZone).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  const previousBox = await previousZone.boundingBox();
  const nextBox = await nextZone.boundingBox();
  expect(previousBox).toBeTruthy();
  expect(nextBox).toBeTruthy();
  expect(previousBox!.x).toBeLessThanOrEqual(1);
  expect(previousBox!.height).toBeGreaterThan(viewport!.height * 0.95);
  expect(nextBox!.x + nextBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(nextBox!.height).toBeGreaterThan(viewport!.height * 0.95);

  const edgeTapInset = 16;
  await page.mouse.click(edgeTapInset, Math.floor(viewport!.height / 2));
  await expect(page.getByRole("dialog", { name: /Preview photo-a.png/i })).toBeVisible();
  await page.mouse.click(viewport!.width - edgeTapInset, Math.floor(viewport!.height / 2));
  await expect(page.getByRole("dialog", { name: /Preview photo-b.png/i })).toBeVisible();
});

test("folder audio player reopens at the last remembered position for the same browser account", async ({ page }) => {
  await connectAccount(page, "Audio resume workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file song.mp3/i }).click();

  const audioPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
  await expect(audioPlayer).toBeVisible();
  const firstPosition = await audioPlayer.locator("audio").evaluate((audio) => {
    Object.defineProperty(audio, "duration", { configurable: true, value: 180 });
    audio.currentTime = 37.25;
    audio.dispatchEvent(new Event("timeupdate"));
    audio.dispatchEvent(new Event("pause"));
    return audio.currentTime;
  });
  expect(firstPosition).toBeCloseTo(37.25, 2);

  await audioPlayer.getByRole("button", { name: /Close folder audio player/i }).click();
  await page.getByRole("button", { name: /Open file song.mp3/i }).click();

  const reopenedPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
  const reopenedAudio = reopenedPlayer.locator("audio");
  await expect(reopenedPlayer.getByText("0:37")).toBeVisible();
  await expect(reopenedAudio).toHaveAttribute("src", /Projects%2Fsong\.mp3/);
  await expect(reopenedPlayer.getByRole("slider", { name: /Audio playback position/i })).toHaveValue("37");
});

test("folder audio player uses current folder tracks and restores per-folder progress", async ({ page }) => {
  await connectAccount(page, "Folder audio workspace");
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
  await expect(player.getByRole("button", { name: /Previous audio track/i })).toBeDisabled();
  await expect(player.getByRole("button", { name: /Next audio track/i })).toBeEnabled();
  await expect(player.getByRole("slider", { name: /Audio playback position/i })).toBeVisible();
  await expect(player.getByRole("button", { name: /Pause folder audio/i }).or(player.getByText(/Playback was blocked by the browser/i))).toBeVisible();

  await player.locator("audio").evaluate((audio) => {
    Object.defineProperty(audio, "duration", { configurable: true, value: 180 });
    audio.currentTime = 51;
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: /Open actions for Привіт.m4a/i }).click();
  const details = page.getByRole("region", { name: /Details for Привіт.m4a/i });
  await expect(details.getByRole("button", { name: /^Open$/i })).toBeVisible();
  await expect(details.getByRole("button", { name: /^Download$/i })).toBeVisible();
  const dismissActions = page.getByRole("button", { name: /Dismiss item actions/i });
  if (await dismissActions.isVisible()) {
    await dismissActions.click();
  }
  await page.getByRole("button", { name: /Open file Привіт.m4a/i }).click();
  await expect(player.getByText("Привіт.m4a")).toBeVisible();
  await expect(page.getByRole("region", { name: /Audio playlist for Projects/i })).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: /Preview Привіт.m4a/i })).toHaveCount(0);
  await expect(player.getByRole("button", { name: /Pause folder audio/i }).or(player.getByText(/Playback was blocked by the browser/i))).toBeVisible();

  await page.getByRole("button", { name: /Go to home folder|Go up one folder level/i }).first().click();
  await expect(player).toHaveCount(0);
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  const restoredPlayer = page.getByRole("region", { name: /Audio playlist for Projects/i });
  await expect(restoredPlayer.getByText("Привіт.m4a")).toBeVisible();

  await restoredPlayer.getByRole("button", { name: /Close folder audio player/i }).click();
  await expect(restoredPlayer).toHaveCount(0);
});

test("immersive video and settings close through explicit controls", async ({ page }) => {
  await connectAccount(page, "Video workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();

  const preview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(preview).toBeVisible();
  const video = preview.getByLabel(/Video preview clip.mp4/i);
  await expect(video).toHaveJSProperty("autoplay", true);
  await expect(video).toHaveJSProperty("muted", false);
  await expect(video).toHaveJSProperty("playsInline", true);
  await page.locator(".preview-scrim").click({ position: { x: 8, y: 8 } });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: /Back to files/i }).click();
  await expect(preview).toHaveCount(0);

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: /Profile and settings/i });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: /Close|Done/i }).click();
  await expect(settingsDialog).toHaveCount(0);
});

test("PER-72 keeps immersive media controls compact and folder audio in place", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/file")) {
      mediaRequests.push(request.url());
    }
  });

  await connectAccount(page, "PER-72 media workspace");
  await page.getByRole("button", { name: /Open folder Projects/i }).click();
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();

  const videoPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(videoPreview).toBeVisible();
  await expect(videoPreview.getByRole("button", { name: "Back to files" })).toBeVisible();
  const videoNavigation = videoPreview.getByRole("group", { name: /Video navigation/i });
  await expect(videoNavigation.getByRole("button", { name: /Previous video/i })).toBeDisabled();
  await expect(videoNavigation.getByRole("button", { name: /Next video/i })).toBeDisabled();
  await expect(videoPreview.getByRole("button", { name: /Next media item/i })).toHaveCount(0);
  await expect(videoPreview.locator(".preview-video-overlay")).toBeVisible();
  await expect(videoPreview.locator(".preview-header-actions-immersive")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(mediaRequests.some((url) => url.includes("song.mp3"))).toBe(false);

  const toolbarGeometry = await videoPreview.locator(".preview-video-overlay").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    };
  });
  expect(toolbarGeometry.left).toBeGreaterThanOrEqual(0);
  expect(toolbarGeometry.right).toBeLessThanOrEqual(toolbarGeometry.viewportWidth);
  expect(toolbarGeometry.top).toBeGreaterThanOrEqual(0);
  expect(toolbarGeometry.bottom).toBeLessThanOrEqual(toolbarGeometry.viewportHeight);

  await videoPreview.getByRole("button", { name: /Back to files/i }).click();

  await page.getByRole("button", { name: /Open file song.mp3/i }).click();
  await expect(page.getByRole("region", { name: /Audio playlist for Projects/i })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Preview song.mp3/i })).toHaveCount(0);
});

test("PER-65 video navigation stays video-only with clear toolbar boundaries", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__davoraVideoEvents", {
      configurable: true,
      value: [] as string[]
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value(this: HTMLMediaElement) {
        (window as unknown as { __davoraVideoEvents: string[] }).__davoraVideoEvents.push(`play:${this.currentSrc || this.src}`);
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value(this: HTMLMediaElement) {
        (window as unknown as { __davoraVideoEvents: string[] }).__davoraVideoEvents.push(`pause:${this.currentSrc || this.src}`);
        this.dispatchEvent(new Event("pause"));
      }
    });
  });
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/file")) {
      mediaRequests.push(request.url());
    }
  });

  await connectAccount(page, "PER-65 video navigation workspace");
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
  const revealVideoOverlay = async () => {
    await firstPreview.locator(".preview-media-stage").evaluate((element) =>
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    );
  };
  const firstNavigation = firstPreview.getByRole("group", { name: /Video navigation/i });
  // Playback hides the overlay by default; touching the stage reveals it.
  await revealVideoOverlay();
  await expect(firstNavigation.getByRole("button", { name: /Previous video/i })).toBeDisabled();
  await expect(firstNavigation.getByRole("button", { name: /Next video/i })).toBeEnabled();
  await expect(firstPreview.getByRole("button", { name: /Next media item/i })).toHaveCount(0);
  // Stream retries may interleave extra play/pause pairs; assert the
  // semantic order rather than the raw event list.
  const videoEvents = async () =>
    page.evaluate(() => (window as unknown as { __davoraVideoEvents: string[] }).__davoraVideoEvents);
  await expect.poll(async () => (await videoEvents()).some((entry) => /^play:.*Projects%2Fclip\.mp4/.test(entry))).toBe(true);
  expect((await videoEvents()).some((entry) => entry.includes("z-clip"))).toBe(false);

  await firstNavigation.getByRole("button", { name: /Next video/i }).click();

  const lastPreview = page.getByRole("dialog", { name: /Preview z-clip.webm/i });
  await lastPreview.locator(".preview-media-stage").evaluate((element) =>
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
  );
  const lastNavigation = lastPreview.getByRole("group", { name: /Video navigation/i });
  await expect(lastNavigation.getByRole("button", { name: /Previous video/i })).toBeEnabled();
  await expect(lastNavigation.getByRole("button", { name: /Next video/i })).toBeDisabled();
  await expect.poll(async () => {
    const events = await videoEvents();
    const clipPlay = events.findIndex((entry) => /^play:.*Projects%2Fclip\.mp4/.test(entry));
    const clipPause = events.findIndex((entry, index) => index > clipPlay && /^pause:.*Projects%2Fclip\.mp4/.test(entry));
    const nextPlay = events.findIndex((entry, index) => index > clipPause && /^play:.*Projects%2Fz-clip\.webm/.test(entry));
    return clipPlay >= 0 && clipPause > clipPlay && nextPlay > clipPause;
  }).toBe(true);
  expect(mediaRequests.some((url) => url.includes("notes.txt") || url.includes("song.mp3"))).toBe(false);

  const toolbarBoxes = await lastPreview.locator(".preview-video-overlay > *").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (let index = 0; index < toolbarBoxes.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < toolbarBoxes.length; nextIndex += 1) {
      const current = toolbarBoxes[index]!;
      const next = toolbarBoxes[nextIndex]!;
      expect(current.right <= next.left || next.right <= current.left || current.bottom <= next.top || next.bottom <= current.top).toBe(true);
    }
  }

  await page.goBack();
  await expect(lastPreview).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open file clip.mp4/i })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /Open folder Projects/i })).toBeVisible();
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
            { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
            { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" },
            { path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }
          ]
        }
      })
    });
  });
  await page.route("**/api/file?path=Projects%2Fa-photo.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          file: {
            path: "Projects/a-photo.png",
            name: "a-photo.png",
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
  await page.route("**/api/file/original?path=Projects%2Fa-photo.png", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''a-photo.png"
      },
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pP3Un0AAAAASUVORK5CYII=", "base64")
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
  await page.getByRole("button", { name: /Open file clip.mp4/i }).click();
  const initialVideoPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  await expect(initialVideoPreview).toBeVisible();
  const initialVideo = initialVideoPreview.getByLabel(/Video preview clip.mp4/i);
  await expect(initialVideo).toHaveJSProperty("autoplay", true);
  await expect(initialVideo).toHaveJSProperty("muted", false);
  await expect(initialVideo).toHaveJSProperty("playsInline", true);
  await initialVideoPreview.getByRole("button", { name: /Back to files/i }).click();
  await expect(initialVideoPreview).toHaveCount(0);

  await page.getByRole("button", { name: /Open file a-photo.png/i }).click();
  const imagePreview = page.getByRole("dialog", { name: /Preview a-photo.png/i });
  await expect(imagePreview).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __davoraMediaEvents: Array<{ type: string; tag: string }> }).__davoraMediaEvents.length = 0;
  });
  await imagePreview.getByRole("button", { name: /Next media item/i }).click({ force: true });
  const audioPreview = page.getByRole("dialog", { name: /Preview chapter.m4a/i });
  await expect(audioPreview.locator("audio")).toHaveJSProperty("autoplay", true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __davoraMediaEvents: Array<{ type: string; tag: string }> }).__davoraMediaEvents)).toContainEqual(expect.objectContaining({ type: "play", tag: "AUDIO" }));

  await audioPreview.getByRole("button", { name: /Next media item/i }).click({ force: true });
  const videoPreview = page.getByRole("dialog", { name: /Preview clip.mp4/i });
  const video = videoPreview.getByLabel(/Video preview clip.mp4/i);
  await expect(video).toHaveJSProperty("autoplay", true);
  await expect(video).toHaveJSProperty("muted", false);
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
  // The streaming notice is intentionally not rendered over video (PER-93).
  await expect(preview.getByText(/Streaming-only playback/i)).toHaveCount(0);
  await expect(preview.getByLabel(/Video preview clip.mp4/i)).toHaveAttribute("src", /\/api\/file\/stream\?path=Projects%2Fclip\.mp4&streamToken=/);
  await expect.poll(() => streamRequests).toBeGreaterThan(0);
  expect(originalRequests).toBe(0);
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
  await expect(preview.getByRole("button", { name: /Open or download original file/i })).toBeVisible();
  await expect(preview.getByRole("button", { name: /Download file/i })).toBeVisible();
});
