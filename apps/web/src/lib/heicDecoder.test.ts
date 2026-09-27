import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeHeicToRgba } from "./heicDecoder";
import { heicErrorMessage } from "./heicPreviewShared";

const HEIC_FIXTURE = resolve(__dirname, "../../tests/fixtures/images/libheif-example.heic");

function heicFixtureBlob(): Blob {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsdom's Blob has no arrayBuffer(); Node's Blob satisfies the decoder contract.
  return new NodeBlob([readFileSync(HEIC_FIXTURE)]) as unknown as Blob;
}

describe("decodeHeicToRgba", () => {
  const originalWorker = globalThis.Worker;

  afterEach(() => {
    Object.defineProperty(globalThis, "Worker", {
      value: originalWorker,
      configurable: true,
      writable: true
    });
  });

  it("decodes the real HEIC fixture to interleaved RGBA pixels", async () => {
    const decoded = await decodeHeicToRgba(heicFixtureBlob());
    expect(decoded.width).toBe(1280);
    expect(decoded.height).toBe(854);
    expect(decoded.data).toBeInstanceOf(Uint8ClampedArray);
    expect(decoded.data.byteLength).toBe(1280 * 854 * 4);
    // The example photo is not a blank frame; alpha must be fully opaque.
    expect(decoded.data[3]).toBe(255);
    expect(decoded.data.some((channel, index) => index % 4 !== 3 && channel !== 0)).toBe(true);
  });

  it("does not rely on nested or blob workers — decoding survives a throwing Worker constructor", async () => {
    // Regression coverage for the Firefox Android report: the previous decoder
    // spawned an internal blob-URL worker that failed there in both the app
    // worker and on the main thread. Decoding must not construct a Worker.
    Object.defineProperty(globalThis, "Worker", {
      value: class {
        constructor() {
          throw new Error("nested worker construction must never run");
        }
      },
      configurable: true,
      writable: true
    });

    const decoded = await decodeHeicToRgba(heicFixtureBlob());
    expect(decoded.width).toBe(1280);
    expect(decoded.height).toBe(854);
  });

  it("rejects non-HEIC bytes with libheif's real parse error and a byte fingerprint", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsdom's Blob has no arrayBuffer(); Node's Blob satisfies the decoder contract.
    const notHeic = new NodeBlob([new Uint8Array(64).fill(0x41)]) as unknown as Blob;
    await expect(decodeHeicToRgba(notHeic)).rejects.toThrow(/ftyp/);
    await expect(decodeHeicToRgba(notHeic)).rejects.toThrow(/bytes=64 head="AAAAAAAAAAAAAAAA"/);
  });

  it("rejects a truncated HEIC with libheif's real pixel-decode error", async () => {
    const truncated = readFileSync(HEIC_FIXTURE).subarray(0, 8192);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsdom's Blob has no arrayBuffer(); Node's Blob satisfies the decoder contract.
    const truncatedBlob = new NodeBlob([truncated]) as unknown as Blob;
    await expect(decodeHeicToRgba(truncatedBlob)).rejects.toThrow(/could not be decoded|Unexpected end of file|outside of file bounds/i);
  });
});

describe("heicErrorMessage", () => {
  it("preserves Error messages and string rejections, and masks empty non-Errors", () => {
    expect(heicErrorMessage(new Error("boom"))).toBe("boom");
    expect(heicErrorMessage("worker spawn refused")).toBe("worker spawn refused");
    expect(heicErrorMessage("")).toBe("Unable to decode HEIC preview.");
    expect(heicErrorMessage(undefined)).toBe("Unable to decode HEIC preview.");
    expect(heicErrorMessage({ code: 1 })).toBe("Unable to decode HEIC preview.");
  });
});
