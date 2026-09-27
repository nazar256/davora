import { heicTo } from "heic-to/next";

import {
  HEIC_PREVIEW_OUTPUT_MIME_TYPE,
  HeicPixelLimitError,
  assertHeicPixelBounds
} from "../lib/heicPreviewShared";

interface HeicWorkerRequest {
  id: number;
  blob: Blob;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the app compiles workers against lib.dom, where self.postMessage is the Window overload without a transfer list.
const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to decode HEIC preview.";
}

self.addEventListener("message", (event: MessageEvent<HeicWorkerRequest>) => {
  void (async () => {
    const { id, blob } = event.data;
    try {
      const bitmap = await heicTo({ blob, type: "bitmap" });
      try {
        assertHeicPixelBounds(bitmap.width, bitmap.height);
        try {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("HEIC preview could not create a browser canvas.");
          }
          context.drawImage(bitmap, 0, 0);
          const output = await canvas.convertToBlob({ type: HEIC_PREVIEW_OUTPUT_MIME_TYPE, quality: 0.88 });
          workerScope.postMessage({ id, ok: true, blob: output, width: bitmap.width, height: bitmap.height });
        } catch {
          // Worker-side canvas APIs are absent on some browsers (e.g. Firefox
          // for Android workers); the main thread encodes the transferred
          // bitmap on a DOM canvas instead.
          workerScope.postMessage({ id, ok: "bitmap", bitmap, width: bitmap.width, height: bitmap.height }, [bitmap]);
        }
      } finally {
        bitmap.close();
      }
    } catch (error) {
      workerScope.postMessage({
        id,
        ok: false,
        error: errorMessage(error),
        retryable: !(error instanceof HeicPixelLimitError)
      });
    }
  })();
});
