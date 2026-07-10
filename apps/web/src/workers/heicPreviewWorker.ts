import { heicTo } from "heic-to/next";

import { HEIC_PREVIEW_MAX_PIXELS, HEIC_PREVIEW_OUTPUT_MIME_TYPE } from "../lib/heicPreviewShared";

interface HeicWorkerRequest {
  id: number;
  blob: Blob;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to decode HEIC preview.";
}

self.addEventListener("message", (event: MessageEvent<HeicWorkerRequest>) => {
  void (async () => {
    const { id, blob } = event.data;
    try {
      const bitmap = await heicTo({ blob, type: "bitmap" });
      try {
        const pixels = bitmap.width * bitmap.height;
        if (!Number.isFinite(pixels) || pixels <= 0 || pixels > HEIC_PREVIEW_MAX_PIXELS) {
          throw new Error(`HEIC preview is limited to ${Math.round(HEIC_PREVIEW_MAX_PIXELS / 1_000_000)} megapixels.`);
        }

        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("HEIC preview could not create a browser canvas.");
        }
        context.drawImage(bitmap, 0, 0);
        const output = await canvas.convertToBlob({ type: HEIC_PREVIEW_OUTPUT_MIME_TYPE, quality: 0.88 });
        self.postMessage({ id, ok: true, blob: output, width: bitmap.width, height: bitmap.height });
      } finally {
        bitmap.close();
      }
    } catch (error) {
      self.postMessage({ id, ok: false, error: errorMessage(error) });
    }
  })();
});
