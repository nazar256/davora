import initLibheif from "libheif-js/libheif-wasm/libheif-bundle.mjs";
import type { LibheifModule } from "libheif-js/libheif-wasm/libheif-bundle.mjs";

import { assertHeicPixelBounds } from "./heicPreviewShared";

export interface HeicDecodedRgba {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

let libheifModulePromise: Promise<LibheifModule> | undefined;

function loadLibheif(): Promise<LibheifModule> {
  // The module factory embeds the WASM binary and resolves through
  // WebAssembly.instantiate — no nested worker, fetch, or eval is involved.
  // Static import: worker bundles are iife and cannot code-split a dynamic
  // import; the main-thread path reaches this module through its own lazy
  // chunk via import("./heicDecoder").
  libheifModulePromise ??= Promise.resolve()
    .then(() => initLibheif())
    .catch((error: unknown) => {
      libheifModulePromise = undefined;
      throw error;
    });
  return libheifModulePromise;
}

/**
 * Decodes a HEIC/HEIF blob to raw interleaved RGBA pixels entirely on the
 * calling thread. The dependency-free contract (ArrayBuffer in, pixels out)
 * keeps this safe inside module workers that cannot spawn nested blob
 * workers, and on the main thread as a fallback.
 */
export async function decodeHeicToRgba(blob: Blob): Promise<HeicDecodedRgba> {
  const libheif = await loadLibheif();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new libheif.HeifDecoder();
  const image = decoder.decode(bytes)[0];
  if (!image) {
    throw new Error("HEIC image not found.");
  }
  const width = image.get_width();
  const height = image.get_height();
  assertHeicPixelBounds(width, height);
  const target: HeicDecodedRgba = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const displayed = await new Promise<HeicDecodedRgba | null>((resolve) => {
    image.display(target, resolve);
  });
  if (displayed !== target) {
    throw new Error("HEIC pixel data could not be decoded.");
  }
  return target;
}
