export type BrowserFilePreparationResult =
  | { readonly kind: "prepared"; readonly contentBase64: string }
  | { readonly kind: "failed"; readonly message: string };

export interface BrowserUploadFileContentPort {
  prepare(
    file: File,
    onProgress: (loadedBytes: number, totalBytes: number) => boolean,
    signal: AbortSignal
  ): Promise<BrowserFilePreparationResult>;
}

const ABORT_MESSAGE = "Aborted";
const READ_FAILURE_MESSAGE = "Unable to read upload file.";

function failureMessage(error: unknown): string {
  return error instanceof DOMException && error.name === "AbortError"
    ? ABORT_MESSAGE
    : READ_FAILURE_MESSAGE;
}

export function createBrowserUploadFileContent(): BrowserUploadFileContentPort {
  return {
    prepare(file, onProgress, signal) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        let settled = false;

        const cleanup = () => {
          signal.removeEventListener("abort", abort);
          reader.onload = null;
          reader.onerror = null;
          reader.onabort = null;
          reader.onprogress = null;
        };
        const finish = (result: BrowserFilePreparationResult) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(result);
        };
        const abort = () => {
          if (settled) {
            return;
          }
          try {
            reader.abort();
          } catch {
            // Settlement and cleanup still belong to this adapter even if the
            // browser rejects an abort request for an already-terminal reader.
          } finally {
            finish({ kind: "failed", message: ABORT_MESSAGE });
          }
        };

        if (signal.aborted) {
          finish({ kind: "failed", message: ABORT_MESSAGE });
          return;
        }

        signal.addEventListener("abort", abort, { once: true });
        reader.onerror = () => {
          if (!settled) {
            finish({ kind: "failed", message: failureMessage(reader.error) });
          }
        };
        reader.onabort = () => {
          if (!settled) {
            finish({ kind: "failed", message: ABORT_MESSAGE });
          }
        };
        reader.onprogress = (event) => {
          if (settled) {
            return;
          }
          if (event.loaded >= 0 && event.total > 0 && onProgress(event.loaded, event.total) === false) {
            abort();
          }
        };
        reader.onload = () => {
          if (settled) {
            return;
          }
          const value = String(reader.result ?? "");
          const commaIndex = value.indexOf(",");
          finish({ kind: "prepared", contentBase64: commaIndex >= 0 ? value.slice(commaIndex + 1) : value });
        };

        try {
          reader.readAsDataURL(file);
        } catch (error) {
          finish({ kind: "failed", message: failureMessage(error) });
        }
      });
    }
  };
}
