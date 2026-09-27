import { decodeHeicToRgba } from "../lib/heicDecoder";
import { HeicPixelLimitError, heicErrorMessage } from "../lib/heicPreviewShared";

interface HeicWorkerRequest {
  id: number;
  blob: Blob;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the app compiles workers against lib.dom, where self.postMessage is the Window overload without a transfer list.
const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

self.addEventListener("message", (event: MessageEvent<HeicWorkerRequest>) => {
  void (async () => {
    const { id, blob } = event.data;
    try {
      // The decoder runs on this thread: nested/blob workers and canvas APIs
      // are unavailable or unreliable inside some browser workers (Firefox for
      // Android), so raw pixels are transferred and encoded on the main thread.
      const { data, width, height } = await decodeHeicToRgba(blob);
      workerScope.postMessage({ id, ok: "rgba", rgba: data, width, height }, [data.buffer]);
    } catch (error) {
      workerScope.postMessage({
        id,
        ok: false,
        error: heicErrorMessage(error),
        retryable: !(error instanceof HeicPixelLimitError)
      });
    }
  })();
});
