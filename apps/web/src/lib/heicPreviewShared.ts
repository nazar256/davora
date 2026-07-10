export const HEIC_PREVIEW_OUTPUT_MIME_TYPE = "image/jpeg";
export const HEIC_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const HEIC_PREVIEW_MAX_PIXELS = 40_000_000;
export const HEIC_PREVIEW_TIMEOUT_MS = 20_000;

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
