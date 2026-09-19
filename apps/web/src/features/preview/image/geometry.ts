export type ImageFitMode = "fill" | "fit";

export interface ImagePoint {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageRect extends ImageSize {
  left: number;
  top: number;
}

export interface ImagePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ImageNavigationIntent = "previous" | "next" | undefined;

export interface ImageNavigationAvailability {
  previous: boolean;
  next: boolean;
}

const IMAGE_MIN_ZOOM = 0.25;
const IMAGE_MAX_ZOOM = 4;
const IMAGE_EDGE_NAVIGATION_MIN_WIDTH = 72;
const IMAGE_EDGE_NAVIGATION_MAX_WIDTH = 176;
const IMAGE_EDGE_NAVIGATION_VIEWPORT_RATIO = 0.14;
const DEFAULT_OBJECT_POSITION: ImagePoint = { x: 50, y: 50 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampImageZoom(value: number): number {
  return clamp(value, IMAGE_MIN_ZOOM, IMAGE_MAX_ZOOM);
}

export function getRenderedImageContentRect(
  viewport: ImageRect,
  naturalSize: ImageSize,
  fitMode?: ImageFitMode,
  objectPosition: ImagePoint = DEFAULT_OBJECT_POSITION
): ImageRect {
  if (!fitMode || naturalSize.width <= 0 || naturalSize.height <= 0) {
    return viewport;
  }

  const widthScale = viewport.width / naturalSize.width;
  const heightScale = viewport.height / naturalSize.height;
  const contentScale = fitMode === "fill"
    ? Math.max(widthScale, heightScale)
    : Math.min(widthScale, heightScale);
  const width = naturalSize.width * contentScale;
  const height = naturalSize.height * contentScale;

  return {
    left: viewport.left + (viewport.width - width) * (objectPosition.x / 100),
    top: viewport.top + (viewport.height - height) * (objectPosition.y / 100),
    width,
    height
  };
}

export function normalizeImageAnchor(anchor: ImagePoint, rect: ImageRect): ImagePoint {
  return {
    x: rect.width > 0 ? clamp((anchor.x - rect.left) / rect.width, 0, 1) : 0.5,
    y: rect.height > 0 ? clamp((anchor.y - rect.top) / rect.height, 0, 1) : 0.5
  };
}

export function resolveFillPan(
  startPan: ImagePoint,
  startPointer: ImagePoint,
  currentPointer: ImagePoint,
  viewport: ImageSize
): ImagePoint {
  const deltaX = ((currentPointer.x - startPointer.x) / Math.max(viewport.width, 1)) * 100;
  const deltaY = ((currentPointer.y - startPointer.y) / Math.max(viewport.height, 1)) * 100;

  return {
    x: clamp(startPan.x - deltaX, 0, 100),
    y: clamp(startPan.y - deltaY, 0, 100)
  };
}

export function getTouchDistance(touches: readonly ImagePoint[]): number {
  const [first, second] = touches;
  return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
}

export function getTouchMidpoint(touches: readonly ImagePoint[]): ImagePoint | undefined {
  const [first, second] = touches;
  if (!first || !second) {
    return undefined;
  }

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

export function resolveImageEdgeNavigationIntent(
  clientX: number,
  viewportWidth: number,
  availability: ImageNavigationAvailability
): ImageNavigationIntent {
  const edgeWidth = Math.max(
    IMAGE_EDGE_NAVIGATION_MIN_WIDTH,
    Math.min(IMAGE_EDGE_NAVIGATION_MAX_WIDTH, viewportWidth * IMAGE_EDGE_NAVIGATION_VIEWPORT_RATIO)
  );

  if (clientX <= edgeWidth && availability.previous) {
    return "previous";
  }

  if (clientX >= viewportWidth - edgeWidth && availability.next) {
    return "next";
  }

  return undefined;
}
