import {
  HEIC_PREVIEW_MAX_SOURCE_BYTES,
  HEIC_PREVIEW_OUTPUT_MIME_TYPE,
  HEIC_PREVIEW_TIMEOUT_MS
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

interface HeicWorkerSuccessMessage {
  id: number;
  ok: true;
  blob: Blob;
  width: number;
  height: number;
}

interface HeicWorkerErrorMessage {
  id: number;
  ok: false;
  error: string;
}

type HeicWorkerMessage = HeicWorkerSuccessMessage | HeicWorkerErrorMessage;

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
      failAndRecover(new Error("HEIC preview decoding timed out."));
    }, HEIC_PREVIEW_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
    };

    const handleMessage = (event: MessageEvent<HeicWorkerMessage>) => {
      if (event.data.id !== id) {
        return;
      }
      cleanup();
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }
      resolve({
        blob: event.data.blob,
        width: event.data.width,
        height: event.data.height,
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
    throw new Error("HEIC preview requires Web Worker support in this browser.");
  }

  return await runQueuedDecode(() => decodeHeicPreviewInWorker(blob));
}
