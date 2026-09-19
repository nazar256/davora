import { fetchOriginalFile } from "../../lib/api";
import {
  clearAudioPreviewPosition,
  loadAudioPreviewPosition,
  saveAudioPreviewPosition
} from "../../lib/audioResume";
import { loadPdfPreviewModule } from "./browserPdfJsAdapter";
import { classifyOriginalFileDisposition } from "./originalFileDisposition";

export interface BrowserAudioPreviewResumeTarget {
  readonly accountId: string;
  readonly path: string;
}

export interface BrowserPreviewPopup {
  readonly closed: boolean;
  opener: unknown;
  readonly location: { href: string };
  close(): void;
}

export interface BrowserOriginalFileOpenTask {
  readonly completion: Promise<void>;
  cancel(): void;
}

export interface BrowserPreviewModalRuntime {
  readonly pdf: {
    loadPdfJs: typeof loadPdfPreviewModule;
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    requestAnimationFrame(callback: FrameRequestCallback): number;
    getDevicePixelRatio(): number;
    createResizeObserver(callback: ResizeObserverCallback): ResizeObserver | undefined;
  };
  readonly video: {
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(timeoutId: number | undefined): void;
    getLocationHref(): string;
  };
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number | undefined): void;
  now(): number;
  getLocationHref(): string;
  startOriginalFileOpen(input: { readonly path: string; readonly token: string }): BrowserOriginalFileOpenTask;
  addWindowKeydownListener(listener: (event: KeyboardEvent) => void): () => void;
  loadAudioPreviewPosition(target: BrowserAudioPreviewResumeTarget): number | undefined;
  saveAudioPreviewPosition(target: BrowserAudioPreviewResumeTarget, positionSeconds: number): void;
  clearAudioPreviewPosition(target: BrowserAudioPreviewResumeTarget): void;
}

export interface BrowserPreviewModalRuntimeOptions {
  readonly setTimeout?: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout?: (timeoutId: number) => void;
  readonly openPopup?: () => BrowserPreviewPopup | null;
  readonly fetchOriginalFile?: typeof fetchOriginalFile;
}

const OBJECT_URL_REVOKE_DELAY_MS = 5 * 60_000;

function appendOpenFallbackAnchor(openUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = openUrl;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function safeDownloadFilename(filename: string, path: string): string {
  const pathFallback = path.split(/[\\/]/).at(-1) ?? "";
  const candidate = (filename.trim() || pathFallback.trim())
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .replace(/^\.+_?/, "_")
    .trim();
  return !candidate || candidate === "." || candidate === ".." ? "download" : candidate;
}

function appendDownloadAnchor(downloadUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function pdfWrapper(sourceUrl: string): Blob {
  return new Blob(
    [
      `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>PDF</title></head><body style="margin:0"><iframe src="${sourceUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0" title="PDF"></iframe></body></html>`
    ],
    { type: "text/html" }
  );
}

function closePopup(popup: BrowserPreviewPopup | undefined): void {
  if (!popup) return;
  try {
    popup.close();
  } catch {
    // Best-effort cleanup for a browser-owned popup.
  }
}

function preopenIsolatedPopup(openPopup: () => BrowserPreviewPopup | null): BrowserPreviewPopup | undefined {
  let popup: BrowserPreviewPopup | null = null;
  try {
    popup = openPopup();
  } catch {
    return undefined;
  }
  if (!popup || popup.closed) {
    closePopup(popup ?? undefined);
    return undefined;
  }
  try {
    popup.opener = null;
    return popup;
  } catch {
    closePopup(popup);
    return undefined;
  }
}

function startOriginalFileOpen(
  input: { readonly path: string; readonly token: string },
  requestOriginalFile: typeof fetchOriginalFile,
  schedule: (callback: () => void, delayMs: number) => number,
  cancelScheduled: (timeoutId: number) => void,
  openPopup: () => BrowserPreviewPopup | null
): BrowserOriginalFileOpenTask {
  const controller = new AbortController();
  let popup = preopenIsolatedPopup(openPopup);
  let cancelled = false;
  let completed = false;
  let revokeTimeoutId: number | undefined;
  const allocatedUrls = new Set<string>();

  const revokeAllocatedUrls = () => {
    for (const url of allocatedUrls) {
      allocatedUrls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Continue revoking the remaining URLs exactly once.
      }
    }
  };
  const cleanupFailure = () => {
    if (revokeTimeoutId !== undefined) {
      try {
        cancelScheduled(revokeTimeoutId);
      } catch {
        // URL cleanup below remains authoritative.
      }
      revokeTimeoutId = undefined;
    }
    revokeAllocatedUrls();
    closePopup(popup);
    popup = undefined;
  };

  const completion = (async () => {
    try {
      const original = await requestOriginalFile(input.path, input.token, controller.signal);
      if (cancelled) return;
      let disposition;
      try {
        disposition = await classifyOriginalFileDisposition({
          blob: original.blob,
          responseMimeType: original.mimeType
        });
      } catch {
        disposition = { kind: "download", mimeType: "application/octet-stream" } as const;
      }
      if (cancelled) {
        cleanupFailure();
        return;
      }

      const canonicalBlob = new Blob([original.blob], { type: disposition.mimeType });
      const sourceUrl = URL.createObjectURL(canonicalBlob);
      allocatedUrls.add(sourceUrl);
      if (disposition.kind === "download") {
        closePopup(popup);
        popup = undefined;
        appendDownloadAnchor(sourceUrl, safeDownloadFilename(original.filename, input.path));
        if (cancelled) {
          cleanupFailure();
          return;
        }
        revokeTimeoutId = schedule(() => {
          revokeTimeoutId = undefined;
          revokeAllocatedUrls();
        }, OBJECT_URL_REVOKE_DELAY_MS);
        completed = true;
        return;
      }

      const openUrl = disposition.mimeType === "application/pdf"
        ? URL.createObjectURL(pdfWrapper(sourceUrl))
        : sourceUrl;
      allocatedUrls.add(openUrl);
      if (cancelled) {
        cleanupFailure();
        return;
      }

      let navigated = false;
      if (popup?.closed) {
        closePopup(popup);
        popup = undefined;
      }
      if (popup && !popup.closed) {
        try {
          popup.location.href = openUrl;
          navigated = true;
        } catch {
          closePopup(popup);
          popup = undefined;
        }
      }
      if (!navigated) {
        appendOpenFallbackAnchor(openUrl);
      }
      if (cancelled) {
        cleanupFailure();
        return;
      }
      revokeTimeoutId = schedule(() => {
        revokeTimeoutId = undefined;
        revokeAllocatedUrls();
      }, OBJECT_URL_REVOKE_DELAY_MS);
      completed = true;
    } catch (error) {
      if (cancelled) return;
      cleanupFailure();
      throw error;
    }
  })();

  return {
    completion,
    cancel() {
      if (cancelled || completed) return;
      cancelled = true;
      controller.abort();
      cleanupFailure();
    }
  };
}

function locationHref(): string {
  return window.location.href;
}

export function createBrowserPreviewModalRuntime(
  options: BrowserPreviewModalRuntimeOptions = {}
): BrowserPreviewModalRuntime {
  const requestOriginalFile = options.fetchOriginalFile ?? fetchOriginalFile;
  const setTimeout = options.setTimeout ?? ((callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs));
  const cancelTimeout = options.clearTimeout ?? ((timeoutId: number) => window.clearTimeout(timeoutId));
  const clearTimeout = (timeoutId: number | undefined): void => {
    if (timeoutId !== undefined) {
      cancelTimeout(timeoutId);
    }
  };
  const openPopup = options.openPopup ?? (() => typeof window.open === "function" ? window.open("about:blank", "_blank") : null);
  return {
    pdf: {
      loadPdfJs: loadPdfPreviewModule,
      fetch: (input, init) => globalThis.fetch(input, init),
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      getDevicePixelRatio: () => globalThis.devicePixelRatio ?? 1,
      createResizeObserver: (callback) => typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(callback)
    },
    video: {
      setTimeout,
      clearTimeout,
      getLocationHref: locationHref
    },
    setTimeout,
    clearTimeout,
    now: () => Date.now(),
    getLocationHref: locationHref,
    startOriginalFileOpen: (input) => startOriginalFileOpen(input, requestOriginalFile, setTimeout, cancelTimeout, openPopup),
    addWindowKeydownListener: (listener) => {
      window.addEventListener("keydown", listener);
      return () => window.removeEventListener("keydown", listener);
    },
    loadAudioPreviewPosition,
    saveAudioPreviewPosition,
    clearAudioPreviewPosition
  } satisfies BrowserPreviewModalRuntime;
}
