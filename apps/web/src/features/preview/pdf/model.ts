export const PDF_MIN_ZOOM = 0.5;
export const PDF_MAX_ZOOM = 3;
export const PDF_ZOOM_STEP = 0.2;

export type PdfZoomMode = "fit-width" | "fit-page" | "custom";

export interface PdfPoint {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampPdfZoom(value: number): number {
  return clamp(value, PDF_MIN_ZOOM, PDF_MAX_ZOOM);
}

export function getPdfTouchDistance(touches: readonly PdfPoint[]): number {
  const [first, second] = touches;
  return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
}

export function getPdfTouchMidpoint(touches: readonly PdfPoint[]): PdfPoint | undefined {
  const [first, second] = touches;
  if (!first || !second) {
    return undefined;
  }

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

export function resolveFitWidthScale(availableWidth: number, pageWidth: number): number {
  return clampPdfZoom(availableWidth / Math.max(pageWidth, 1));
}

export function resolveFitPageScale(
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number
): number {
  return clampPdfZoom(
    Math.min(
      availableWidth / Math.max(pageWidth, 1),
      availableHeight / Math.max(pageHeight, 1)
    )
  );
}

export function resolveCssScale(
  zoomMode: PdfZoomMode,
  zoomScale: number,
  fitWidthScale: number,
  fitPageScale: number
): number {
  if (zoomMode === "fit-width") {
    return fitWidthScale;
  }
  if (zoomMode === "fit-page") {
    return fitPageScale;
  }
  return clampPdfZoom(zoomScale);
}

export function resolveCurrentPageFromCenters(viewportCenter: number, pageCenters: readonly number[]): number {
  let nextPage = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  pageCenters.forEach((pageCenter, index) => {
    const distance = Math.abs(pageCenter - viewportCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nextPage = index + 1;
    }
  });

  return nextPage;
}

export function resolveRenderedScaleFromCanvas(canvasWidth: number, pageWidth: number, fallback: number): number {
  if (pageWidth <= 0) {
    return fallback;
  }
  return clampPdfZoom(canvasWidth / pageWidth);
}
