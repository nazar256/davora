export const HEIC_PREVIEW_OUTPUT_MIME_TYPE = "image/jpeg";
export const HEIC_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const HEIC_PREVIEW_MAX_PIXELS = 40_000_000;
export const HEIC_PREVIEW_TIMEOUT_MS = 20_000;

/** Deterministic source-limit failure: retrying on another thread is pointless. */
export class HeicPixelLimitError extends Error {}

export function assertHeicPixelBounds(width: number, height: number): void {
  const pixels = width * height;
  if (!Number.isFinite(pixels) || pixels <= 0 || pixels > HEIC_PREVIEW_MAX_PIXELS) {
    throw new HeicPixelLimitError(`HEIC preview is limited to ${Math.round(HEIC_PREVIEW_MAX_PIXELS / 1_000_000)} megapixels.`);
  }
}

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export function isHeicMimeType(mimeType: string | undefined): boolean {
  return HEIC_MIME_TYPES.has(mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "");
}

export function isHeicFileName(nameOrPath: string | undefined): boolean {
  return /\.(heic|heif)$/i.test(nameOrPath ?? "");
}

export function isHeicLikeFile(file: { name?: string; path?: string; mimeType?: string }): boolean {
  return isHeicMimeType(file.mimeType) || isHeicFileName(file.name) || isHeicFileName(file.path);
}
