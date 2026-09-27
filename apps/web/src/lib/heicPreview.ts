import {
  HEIC_PREVIEW_MAX_SOURCE_BYTES,
  HEIC_PREVIEW_OUTPUT_MIME_TYPE,
  HEIC_PREVIEW_TIMEOUT_MS,
  assertHeicPixelBounds
} from "./heicPreviewShared";

export {
  HEIC_PREVIEW_MAX_PIXELS,
  HEIC_PREVIEW_MAX_SOURCE_BYTES,
  HEIC_PREVIEW_OUTPUT_MIME_TYPE,
  HEIC_PREVIEW_TIMEOUT_MS,
  isHeicFileName,
  isHeicLikeFile,
  isHeicMimeType
} from "./heicPreviewShared";

export interface HeicPreviewResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: typeof HEIC_PREVIEW_OUTPUT_MIME_TYPE;
}

interface HeicWorkerBlobMessage {
  id: number;
  ok: true;
  blob: Blob;
  width: number;
  height: number;
}

interface HeicWorkerBitmapMessage {
  id: number;
  ok: "bitmap";
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

interface HeicWorkerErrorMessage {
  id: number;
  ok: false;
  error: string;
  retryable?: boolean;
}

type HeicWorkerMessage = HeicWorkerBlobMessage | HeicWorkerBitmapMessage | HeicWorkerErrorMessage;

/**
 * A timed-out worker decode is tagged so the caller skips the main-thread
 * retry: a decode that hung a worker would just freeze the page instead.
 */
class HeicWorkerTimeoutError extends Error {}

/** Worker-side failures marked non-retryable (e.g. deterministic source limits). */
class HeicWorkerPermanentError extends Error {}

const heicErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to decode HEIC preview.";

let heicWorker: Worker | undefined;
let nextRequestId = 1;
let decodeQueue = Promise.resolve();

function getHeicWorker(): Worker {
  if (!heicWorker) {
    heicWorker = new Worker(new URL("../workers/heicPreviewWorker.ts", import.meta.url), { type: "module" });
  }
  return heicWorker;
}

function terminateHeicWorker(): void {
  heicWorker?.terminate();
  heicWorker = undefined;
}

async function runQueuedDecode<T>(task: () => Promise<T>): Promise<T> {
  const previousDecode = decodeQueue;
  let releaseQueue: () => void = () => undefined;
  decodeQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousDecode;
  try {
    return await task();
  } finally {
    releaseQueue();
  }
}

async function encodeHeicBitmapOnDomCanvas(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("HEIC preview could not create a browser canvas.");
  }
  context.drawImage(bitmap, 0, 0);
  const output = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, HEIC_PREVIEW_OUTPUT_MIME_TYPE, 0.88);
  });
  if (!output) {
    throw new Error("HEIC preview could not encode JPEG output.");
  }
  return output;
}

async function decodeHeicPreviewOnMainThread(blob: Blob): Promise<HeicPreviewResult> {
  const { heicTo } = await import("heic-to/next");
  const bitmap = await heicTo({ blob, type: "bitmap" });
  try {
    assertHeicPixelBounds(bitmap.width, bitmap.height);
    const output = await encodeHeicBitmapOnDomCanvas(bitmap);
    return { blob: output, width: bitmap.width, height: bitmap.height, mimeType: HEIC_PREVIEW_OUTPUT_MIME_TYPE };
  } finally {
    bitmap.close();
  }
}

async function decodeHeicPreviewInWorker(blob: Blob): Promise<HeicPreviewResult> {
  const worker = getHeicWorker();
  const id = nextRequestId++;

  return await new Promise<HeicPreviewResult>((resolve, reject) => {
    const failAndRecover = (error: Error) => {
      cleanup();
      terminateHeicWorker();
      reject(error);
    };

    const timeoutId = window.setTimeout(() => {
      failAndRecover(new HeicWorkerTimeoutError("HEIC preview decoding timed out."));
    }, HEIC_PREVIEW_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
    };

    const handleMessage = (event: MessageEvent<HeicWorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) {
        return;
      }
      cleanup();
      if (message.ok === "bitmap") {
        void (async () => {
          try {
            const output = await encodeHeicBitmapOnDomCanvas(message.bitmap);
            resolve({
              blob: output,
              width: message.width,
              height: message.height,
              mimeType: HEIC_PREVIEW_OUTPUT_MIME_TYPE
            });
          } catch (error) {
            reject(error instanceof Error ? error : new Error("HEIC preview could not encode JPEG output."));
          } finally {
            message.bitmap.close();
          }
        })();
        return;
      }
      if (!message.ok) {
        reject(message.retryable === false
          ? new HeicWorkerPermanentError(message.error)
          : new Error(message.error));
        return;
      }
      resolve({
        blob: message.blob,
        width: message.width,
        height: message.height,
        mimeType: HEIC_PREVIEW_OUTPUT_MIME_TYPE
      });
    };

    const handleError = (event: ErrorEvent) => {
      failAndRecover(new Error(event.message || "HEIC preview worker failed."));
    };

    const handleMessageError = () => {
      failAndRecover(new Error("HEIC preview worker returned an unreadable result."));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);
    worker.postMessage({ id, blob });
  });
}

export async function decodeHeicPreview(blob: Blob): Promise<HeicPreviewResult> {
  if (blob.size > HEIC_PREVIEW_MAX_SOURCE_BYTES) {
    throw new Error(`HEIC preview is limited to files up to ${Math.round(HEIC_PREVIEW_MAX_SOURCE_BYTES / (1024 * 1024))} MB.`);
  }

  if (typeof Worker === "undefined") {
    return await decodeHeicPreviewOnMainThread(blob);
  }

  // The queue covers the whole ladder: a failing worker must not let several
  // concurrent main-thread WASM decodes pile up and stall the page.
  return await runQueuedDecode(async () => {
    try {
      return await decodeHeicPreviewInWorker(blob);
    } catch (workerError) {
      if (workerError instanceof HeicWorkerTimeoutError || workerError instanceof HeicWorkerPermanentError) {
        throw workerError;
      }
      try {
        return await decodeHeicPreviewOnMainThread(blob);
      } catch (fallbackError) {
        throw new Error(`${heicErrorMessage(workerError)} Main-thread HEIC decode also failed: ${heicErrorMessage(fallbackError)}`);
      }
    }
  });
}
