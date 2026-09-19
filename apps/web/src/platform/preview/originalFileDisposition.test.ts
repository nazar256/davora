import { describe, expect, it } from "vitest";

import { classifyOriginalFileDisposition } from "./originalFileDisposition";

const encoder = new TextEncoder();

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values);
}

function ascii(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value);
}

function join(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function isoBmff(majorBrand: string, ...compatibleBrands: string[]): Uint8Array<ArrayBuffer> {
  const size = 16 + compatibleBrands.length * 4;
  return join(
    bytes((size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    ascii("ftyp"),
    ascii(majorBrand),
    bytes(0, 0, 0, 0),
    ...compatibleBrands.map(ascii),
    ascii("passive-payload")
  );
}

const passiveCases = [
  ["image/png", join(bytes(0x89), ascii("PNG"), bytes(0x0d, 0x0a, 0x1a, 0x0a), ascii("payload"))],
  ["image/jpeg", join(bytes(0xff, 0xd8, 0xff), ascii("payload"))],
  ["image/gif", ascii("GIF87apayload")],
  ["image/gif", ascii("GIF89apayload")],
  ["image/webp", join(ascii("RIFF"), bytes(12, 0, 0, 0), ascii("WEBPpayload"))],
  ["image/avif", isoBmff("avif")],
  ["image/avif", isoBmff("isom", "avis")],
  ["application/pdf", ascii("%PDF-1.7\npassive")]
] as const;

describe("classifyOriginalFileDisposition", () => {
  it.each(passiveCases)("allows a signature-verified %s original using a canonical MIME", async (mimeType, content) => {
    const original = new Blob([content], { type: mimeType });

    await expect(classifyOriginalFileDisposition({
      blob: original,
      responseMimeType: `  ${mimeType.toUpperCase()}; charset=binary `
    })).resolves.toEqual({ kind: "navigate", mimeType });
  });

  it.each(["heic", "heix", "hevc", "hevx", "mif1", "msf1"])(
    "allows HEIC/HEIF brand %s in both major and compatible positions",
    async (brand) => {
      for (const mimeType of ["image/heic", "image/heif"] as const) {
        await expect(classifyOriginalFileDisposition({
          blob: new Blob([isoBmff(brand)], { type: mimeType }),
          responseMimeType: mimeType
        })).resolves.toEqual({ kind: "navigate", mimeType });
        await expect(classifyOriginalFileDisposition({
          blob: new Blob([isoBmff("isom", brand)], { type: mimeType }),
          responseMimeType: mimeType
        })).resolves.toEqual({ kind: "navigate", mimeType });
      }
    }
  );

  it.each([
    ["text/html", "<!doctype html><script>sentinel()</script>"],
    ["image/svg+xml", "<svg onload='sentinel()'></svg>"],
    ["text/javascript", "sentinel()"],
    ["application/xml", "<?xml version='1.0'?><root />"]
  ])("downloads active %s bytes even under every passive MIME", async (_activeMime, activeSource) => {
    for (const [passiveMime] of passiveCases) {
      await expect(classifyOriginalFileDisposition({
        blob: new Blob([activeSource], { type: passiveMime }),
        responseMimeType: passiveMime
      })).resolves.toEqual({ kind: "download", mimeType: "application/octet-stream" });
    }
  });

  it.each([
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "text/xml",
    "application/json",
    "application/wasm",
    "multipart/form-data",
    "application/octet-stream",
    "font/woff2",
    "application/zip"
  ])("downloads a valid passive signature declared as active or unknown %s", async (mimeType) => {
    const png = passiveCases[0][1];
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([png], { type: mimeType }),
      responseMimeType: mimeType
    })).resolves.toEqual({ kind: "download", mimeType: "application/octet-stream" });
  });

  it("downloads when response and Blob MIME disagree, even when either side is passive", async () => {
    const png = passiveCases[0][1];
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([png], { type: "image/png" }),
      responseMimeType: "application/pdf"
    })).resolves.toEqual({ kind: "download", mimeType: "application/octet-stream" });
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([png], { type: "text/html" }),
      responseMimeType: "image/png"
    })).resolves.toEqual({ kind: "download", mimeType: "application/octet-stream" });
  });

  it.each([
    ["both empty", "", "", new Uint8Array()],
    ["malformed response", "not a mime", "image/png", passiveCases[0][1]],
    ["malformed Blob", "image/png", "image png", passiveCases[0][1]],
    ["truncated PNG", "image/png", "image/png", bytes(0x89, 0x50, 0x4e)],
    ["truncated PDF", "application/pdf", "application/pdf", ascii("%PDF")],
    ["malformed BMFF size", "image/avif", "image/avif", join(bytes(0, 0, 0, 8), ascii("ftyp"))]
  ])("downloads %s input", async (_name, responseMimeType, blobMimeType, content) => {
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([content], { type: blobMimeType }),
      responseMimeType
    })).resolves.toEqual({ kind: "download", mimeType: "application/octet-stream" });
  });

  it("accepts one empty MIME authority only when the other is valid and the signature agrees", async () => {
    const png = passiveCases[0][1];
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([png]),
      responseMimeType: "image/png"
    })).resolves.toEqual({ kind: "navigate", mimeType: "image/png" });
    await expect(classifyOriginalFileDisposition({
      blob: new Blob([png], { type: "image/png" }),
      responseMimeType: ""
    })).resolves.toEqual({ kind: "navigate", mimeType: "image/png" });
  });
});
