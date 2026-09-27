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

/**
 * Decoder libraries may reject with strings or other non-Error values;
 * preserve them so diagnostics surface the real failure.
 */
export function heicErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "Unable to decode HEIC preview.";
}

const asciiOf = (bytes: Uint8Array, start: number, end: number): string =>
  Array.from(bytes.subarray(start, end), (byte) => String.fromCharCode(byte)).join("");

export type HeicInputClassification =
  | { readonly kind: "native"; readonly mimeType: string }
  | { readonly kind: "heif" | "unknown" };

/**
 * Classifies a file's leading bytes so the HEIC path can render formats
 * browsers already support instead of running libheif on them. Some servers
 * and export pipelines deliver transcoded JPEG/PNG data under a `.heic`
 * name; the byte fingerprint is authoritative — the file name is not.
 */
export function classifyHeicInput(head: Uint8Array): HeicInputClassification {
  if (head.length < 4) {
    return { kind: "unknown" };
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: "native", mimeType: "image/jpeg" };
  }
  if (head.length >= 8 && head[0] === 0x89 && asciiOf(head, 1, 4) === "PNG") {
    return { kind: "native", mimeType: "image/png" };
  }
  if (head.length >= 6 && asciiOf(head, 0, 4) === "GIF8") {
    return { kind: "native", mimeType: "image/gif" };
  }
  if (head.length >= 12 && asciiOf(head, 0, 4) === "RIFF" && asciiOf(head, 8, 12) === "WEBP") {
    return { kind: "native", mimeType: "image/webp" };
  }
  if (head.length >= 12 && asciiOf(head, 4, 8) === "ftyp") {
    const brand = asciiOf(head, 8, 12);
    if (brand === "avif" || brand === "avis") {
      return { kind: "native", mimeType: "image/avif" };
    }
    // Every other ftyp brand (heic/heix/mif1/msf1, and even non-HEIF ones
    // like mp4) goes through libheif, which reports a real parse error for
    // containers it cannot handle.
    return { kind: "heif" };
  }
  return { kind: "unknown" };
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
