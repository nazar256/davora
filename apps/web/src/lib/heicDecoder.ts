import initLibheif from "libheif-js/libheif-wasm/libheif-bundle.mjs";
import type {
  HeifContext,
  HeifDecodeResult,
  HeifError,
  HeifImage,
  HeifImageHandle,
  LibheifModule
} from "libheif-js/libheif-wasm/libheif-bundle.mjs";

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

function isHeifError(result: unknown): result is HeifError {
  if (typeof result !== "object" || result === null || !("code" in result)) {
    return false;
  }
  const code = result.code;
  return typeof code === "object" && code !== null && "value" in code && typeof code.value === "number";
}

function heifErrorText(error: HeifError): string {
  const message = typeof error.message === "string" ? error.message.trim() : "";
  return message.length > 0 ? message : `libheif error ${error.code.value}/${error.subcode.value}`;
}

/**
 * Short, privacy-safe fingerprint of the input bytes: total size plus the
 * first 16 bytes rendered as printable ASCII (dots elsewhere). A real HEIC
 * always starts `....ftyp<brand>`; this distinguishes "not an ISOBMFF file
 * at all" (JPEG/HTML/ciphertext) from a truncated or variant HEIF container
 * when a production failure reaches the diagnostic inbox.
 */
function describeHeicBytes(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 16);
  let magic = "";
  for (const byte of head) {
    magic += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
  }
  return `bytes=${bytes.byteLength} head="${magic}"`;
}

function isDecodedResult(result: HeifDecodeResult | HeifError): result is HeifDecodeResult {
  return "channels" in result && Array.isArray(result.channels);
}

/**
 * Decodes a HEIC/HEIF blob to raw interleaved RGBA pixels entirely on the
 * calling thread. The dependency-free contract (ArrayBuffer in, pixels out)
 * keeps this safe inside module workers that cannot spawn nested blob
 * workers, and on the main thread as a fallback.
 *
 * The high-level `HeifDecoder` wrapper swallows libheif failures into a
 * console log and an empty image list, so this walks the context/handle/
 * decode calls directly: every stage surfaces libheif's real error message
 * into the thrown error, which diagnostic reports then carry.
 */
export async function decodeHeicToRgba(blob: Blob): Promise<HeicDecodedRgba> {
  const libheif = await loadLibheif();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const context: HeifContext = libheif.heif_context_alloc();
  let handle: HeifImageHandle | undefined;
  let image: HeifImage | undefined;
  try {
    const readError = libheif.heif_context_read_from_memory(context, bytes);
    if (readError.code.value !== libheif.heif_error_code.heif_error_Ok.value) {
      throw new Error(`HEIC container parse failed (${describeHeicBytes(bytes)}): ${heifErrorText(readError)}`);
    }
    const imageIds = libheif.heif_js_context_get_list_of_top_level_image_IDs(context);
    const firstId = imageIds[0];
    if (firstId === undefined) {
      throw new Error(`HEIC container holds no top-level images (${describeHeicBytes(bytes)}).`);
    }
    const handleResult = libheif.heif_js_context_get_image_handle(context, firstId);
    if (isHeifError(handleResult)) {
      throw new Error(`HEIC image handle could not be read: ${heifErrorText(handleResult)}`);
    }
    handle = handleResult;
    const decoded = libheif.heif_js_decode_image2(
      handle,
      libheif.heif_colorspace.heif_colorspace_RGB,
      libheif.heif_chroma.heif_chroma_interleaved_RGBA
    );
    if (!isDecodedResult(decoded)) {
      throw new Error(`HEIC pixels could not be decoded: ${isHeifError(decoded) ? heifErrorText(decoded) : "empty decode result"}`);
    }
    image = decoded.image;
    const { width, height } = decoded;
    assertHeicPixelBounds(width, height);
    const channel = decoded.channels.find(
      (candidate) => candidate.id.value === libheif.heif_channel.heif_channel_interleaved.value
    );
    if (!channel) {
      throw new Error("HEIC decode produced no interleaved RGBA channel.");
    }
    const data = new Uint8ClampedArray(width * height * 4);
    if (channel.stride === width * 4) {
      data.set(channel.data.subarray(0, data.byteLength));
    } else {
      for (let row = 0; row < height; row += 1) {
        data.set(channel.data.subarray(row * channel.stride, row * channel.stride + width * 4), row * width * 4);
      }
    }
    return { data, width, height };
  } finally {
    if (image) libheif.heif_image_release(image);
    if (handle) libheif.heif_image_handle_release(handle);
    libheif.heif_context_free(context);
  }
}
