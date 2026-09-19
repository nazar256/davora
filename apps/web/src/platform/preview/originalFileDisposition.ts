const SIGNATURE_PREFIX_BYTES = 64;

export type NavigableOriginalMimeType =
  | "application/pdf"
  | "image/avif"
  | "image/gif"
  | "image/heic"
  | "image/heif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export type OriginalFileDisposition =
  | { readonly kind: "navigate"; readonly mimeType: NavigableOriginalMimeType }
  | { readonly kind: "download"; readonly mimeType: "application/octet-stream" };

interface OriginalFileDispositionInput {
  readonly blob: Blob;
  readonly responseMimeType: string;
}

type NormalizedMimeType =
  | { readonly kind: "empty" }
  | { readonly kind: "valid"; readonly value: string }
  | { readonly kind: "malformed" };

const DOWNLOAD_DISPOSITION = {
  kind: "download",
  mimeType: "application/octet-stream"
} as const;

const MIME_TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/;

function normalizeMimeType(rawValue: string): NormalizedMimeType {
  const trimmed = rawValue.trim();
  if (!trimmed) return { kind: "empty" };
  const value = trimmed.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TOKEN.test(value)
    ? { kind: "valid", value }
    : { kind: "malformed" };
}

function startsWithBytes(prefix: Uint8Array<ArrayBuffer>, expected: readonly number[]): boolean {
  return expected.every((value, index) => prefix[index] === value);
}

function asciiAt(prefix: Uint8Array<ArrayBuffer>, offset: number, expected: string): boolean {
  if (offset + expected.length > prefix.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (prefix[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function readAscii(prefix: Uint8Array<ArrayBuffer>, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(prefix[offset + index] ?? 0);
  }
  return value;
}

function matchesIsoBmffBrand(prefix: Uint8Array<ArrayBuffer>, allowedBrands: ReadonlySet<string>): boolean {
  if (prefix.length < 16 || !asciiAt(prefix, 4, "ftyp")) return false;
  const boxSize = (
    ((prefix[0] ?? 0) << 24)
    | ((prefix[1] ?? 0) << 16)
    | ((prefix[2] ?? 0) << 8)
    | (prefix[3] ?? 0)
  ) >>> 0;
  if (boxSize < 16) return false;
  const inspectedEnd = Math.min(boxSize, prefix.length);
  if (allowedBrands.has(readAscii(prefix, 8, 4))) return true;
  for (let offset = 16; offset + 4 <= inspectedEnd; offset += 4) {
    if (allowedBrands.has(readAscii(prefix, offset, 4))) return true;
  }
  return false;
}

function signatureMatches(mimeType: NavigableOriginalMimeType, prefix: Uint8Array<ArrayBuffer>): boolean {
  switch (mimeType) {
    case "image/png":
      return startsWithBytes(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWithBytes(prefix, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return asciiAt(prefix, 0, "GIF87a") || asciiAt(prefix, 0, "GIF89a");
    case "image/webp":
      return asciiAt(prefix, 0, "RIFF") && asciiAt(prefix, 8, "WEBP");
    case "image/avif":
      return matchesIsoBmffBrand(prefix, new Set(["avif", "avis"]));
    case "image/heic":
    case "image/heif":
      return matchesIsoBmffBrand(prefix, new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]));
    case "application/pdf":
      return asciiAt(prefix, 0, "%PDF-");
  }
}

function isNavigableMimeType(value: string): value is NavigableOriginalMimeType {
  return value === "application/pdf"
    || value === "image/avif"
    || value === "image/gif"
    || value === "image/heic"
    || value === "image/heif"
    || value === "image/jpeg"
    || value === "image/png"
    || value === "image/webp";
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new TypeError("Blob prefix did not produce binary data."));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Blob prefix read failed.")), { once: true });
    reader.addEventListener("abort", () => reject(new DOMException("Blob prefix read aborted.", "AbortError")), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

export async function classifyOriginalFileDisposition(
  input: OriginalFileDispositionInput
): Promise<OriginalFileDisposition> {
  const responseMimeType = normalizeMimeType(input.responseMimeType);
  const blobMimeType = normalizeMimeType(input.blob.type);
  if (responseMimeType.kind === "malformed" || blobMimeType.kind === "malformed") {
    return DOWNLOAD_DISPOSITION;
  }
  if (
    responseMimeType.kind === "valid"
    && blobMimeType.kind === "valid"
    && responseMimeType.value !== blobMimeType.value
  ) {
    return DOWNLOAD_DISPOSITION;
  }
  const mimeType = responseMimeType.kind === "valid"
    ? responseMimeType.value
    : blobMimeType.kind === "valid"
      ? blobMimeType.value
      : undefined;
  if (!mimeType || !isNavigableMimeType(mimeType)) return DOWNLOAD_DISPOSITION;

  const prefix = new Uint8Array(await readBlobBytes(input.blob.slice(0, SIGNATURE_PREFIX_BYTES)));
  return signatureMatches(mimeType, prefix)
    ? { kind: "navigate", mimeType }
    : DOWNLOAD_DISPOSITION;
}
