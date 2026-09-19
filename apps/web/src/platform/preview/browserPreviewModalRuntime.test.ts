import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface OriginalFileResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly filename: string;
}

const fetchOriginalFile = vi.hoisted(() => vi.fn<(
  path: string,
  token: string,
  signal?: AbortSignal
) => Promise<OriginalFileResult>>());

import { createBrowserPreviewModalRuntime } from "./browserPreviewModalRuntime";
import { loadPdfPreviewModule } from "./browserPdfJsAdapter";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdfBytes = new TextEncoder().encode("%PDF-1.7\npassive");

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new TypeError("Expected binary Blob data."));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}

function createRuntime(options: Omit<Parameters<typeof createBrowserPreviewModalRuntime>[0], "fetchOriginalFile"> = {}) {
  return createBrowserPreviewModalRuntime({ ...options, fetchOriginalFile });
}

describe("createBrowserPreviewModalRuntime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    fetchOriginalFile.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreProperty(URL, "createObjectURL", originalCreateObjectUrl);
    restoreProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    restoreProperty(globalThis, "devicePixelRatio", originalDevicePixelRatio);
  });

  function popup(options: { readonly navigationFails?: boolean; readonly openerFails?: boolean; readonly closed?: boolean } = {}) {
    let opener: unknown = window;
    let href = "about:blank";
    const close = vi.fn();
    return {
      closed: options.closed ?? false,
      get opener() { return opener; },
      set opener(value: unknown) {
        if (options.openerFails) throw new Error("opener denied");
        opener = value;
      },
      location: {
        get href() { return href; },
        set href(value: string) {
          if (options.navigationFails) throw new Error("navigation denied");
          href = value;
        }
      },
      close,
      readOpener: () => opener,
      readHref: () => href
    };
  }

  it("isolates the popup immediately and makes pending cancellation idempotent, abortable, and late-inert", async () => {
    let resolveOriginal: (value: OriginalFileResult) => void = () => {};
    fetchOriginalFile.mockImplementation(() => new Promise((resolve) => {
      resolveOriginal = resolve;
    }));
    const opened = popup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const runtime = createRuntime({ openPopup: () => opened });

    const task = runtime.startOriginalFileOpen({ path: "Photos/photo.png", token: "session-token" });
    expect(opened.readOpener()).toBeNull();
    expect(fetchOriginalFile).toHaveBeenCalledWith("Photos/photo.png", "session-token", expect.any(AbortSignal));
    const signal = fetchOriginalFile.mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    task.cancel();
    task.cancel();
    expect(signal?.aborted).toBe(true);
    expect(opened.close).toHaveBeenCalledTimes(1);
    resolveOriginal({ blob: new Blob(["late"]), mimeType: "image/png", filename: "photo.png" });
    await expect(task.completion).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("opens non-PDF originals and revokes their URL exactly once after five minutes", async () => {
    let revoke: (() => void) | undefined;
    const setTimeout = vi.fn((callback: () => void) => {
      revoke = callback;
      return 43;
    });
    const original = new Blob([pngBytes], { type: "image/png" });
    fetchOriginalFile.mockResolvedValue({ blob: original, mimeType: "image/png", filename: "photo.png" });
    const opened = popup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const task = createRuntime({ setTimeout, openPopup: () => opened })
      .startOriginalFileOpen({ path: "Photos/photo.png", token: "session-token" });
    await expect(task.completion).resolves.toBeUndefined();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const canonicalBlob = createObjectURL.mock.calls[0]?.[0];
    if (!(canonicalBlob instanceof Blob)) throw new Error("Expected canonical image Blob.");
    expect(canonicalBlob).not.toBe(original);
    expect(canonicalBlob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await readBlob(canonicalBlob)))).toEqual(Array.from(pngBytes));
    expect(opened.readHref()).toBe("blob:image");
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    revoke?.();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:image");
    task.cancel();
    expect(opened.close).not.toHaveBeenCalled();
  });

  it.each(["blocked", "navigation-failed", "opener-failed", "closed"] as const)("uses a removed noopener anchor fallback when popup is %s", async (caseName) => {
    fetchOriginalFile.mockResolvedValue({ blob: new Blob([pngBytes], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
    let clicked: HTMLAnchorElement | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fallback");
    const opened = caseName === "blocked" ? null : popup({
      navigationFails: caseName === "navigation-failed",
      openerFails: caseName === "opener-failed",
      closed: caseName === "closed"
    });

    const task = createRuntime({ setTimeout: vi.fn(() => 42), openPopup: () => opened })
      .startOriginalFileOpen({ path: "Photos/photo.png", token: "session-token" });
    await expect(task.completion).resolves.toBeUndefined();

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = clicked;
    if (!anchor) throw new Error("Expected fallback anchor click.");
    expect(anchor.href).toBe("blob:fallback");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(document.body.contains(anchor)).toBe(false);
    if (opened) {
      expect(opened.close).toHaveBeenCalledTimes(1);
    }
  });

  it("wraps PDFs in the established iframe document and revokes source and wrapper exactly once", async () => {
    vi.useRealTimers();
    let revoke: (() => void) | undefined;
    const setTimeout = vi.fn((callback: () => void) => {
      revoke = callback;
      return 44;
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:pdf-source")
      .mockReturnValueOnce("blob:pdf-wrapper");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const opened = popup();
    const original = new Blob([pdfBytes], { type: "application/pdf" });
    fetchOriginalFile.mockResolvedValue({ blob: original, mimeType: "application/pdf", filename: "report.pdf" });

    const task = createRuntime({ setTimeout, openPopup: () => opened })
      .startOriginalFileOpen({ path: "Docs/report.pdf", token: "session-token" });
    await expect(task.completion).resolves.toBeUndefined();

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    const canonicalPdf = createObjectURL.mock.calls[0]?.[0];
    if (!(canonicalPdf instanceof Blob)) throw new Error("Expected canonical PDF Blob.");
    expect(canonicalPdf).not.toBe(original);
    expect(canonicalPdf.type).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await readBlob(canonicalPdf)))).toEqual(Array.from(pdfBytes));
    const wrapper = createObjectURL.mock.calls[1]?.[0];
    if (!(wrapper instanceof Blob)) throw new Error("Expected PDF wrapper Blob.");
    expect(wrapper.type).toBe("text/html");
    const wrapperText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
      reader.addEventListener("error", () => reject(reader.error), { once: true });
      reader.readAsText(wrapper);
    });
    expect(wrapperText).toContain('<iframe src="blob:pdf-source"');
    expect(wrapperText).toContain('title="PDF"');
    expect(opened.readHref()).toBe("blob:pdf-wrapper");
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
    revoke?.();
    revoke?.();
    expect(revokeObjectURL.mock.calls).toEqual([["blob:pdf-source"], ["blob:pdf-wrapper"]]);
  });

  it.each(["second-url", "fallback", "scheduler"] as const)("cleans every allocated URL and popup exactly once when %s fails", async (failure) => {
    fetchOriginalFile.mockResolvedValue({
      blob: new Blob([failure === "second-url" ? pdfBytes : pngBytes], { type: failure === "second-url" ? "application/pdf" : "image/png" }),
      mimeType: failure === "second-url" ? "application/pdf" : "image/png",
      filename: failure === "second-url" ? "report.pdf" : "photo.png"
    });
    const opened = failure === "fallback" ? null : popup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    if (failure === "second-url") {
      createObjectURL.mockReturnValueOnce("blob:source").mockImplementationOnce(() => { throw new Error("wrapper allocation failed"); });
    } else {
      createObjectURL.mockReturnValue("blob:source");
    }
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    if (failure === "fallback") {
      click.mockImplementation(() => { throw new Error("fallback click failed"); });
    }
    const setTimeout = failure === "scheduler"
      ? vi.fn(() => { throw new Error("scheduler failed"); })
      : undefined;
    const runtime = createRuntime({
      openPopup: () => opened,
      ...(setTimeout ? { setTimeout } : {})
    });

    const task = runtime.startOriginalFileOpen({ path: "Docs/file", token: "session-token" });
    await expect(task.completion).rejects.toThrow(/failed/);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:source");
    if (opened) expect(opened.close).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[href="blob:source"]')).toBeNull();
  });

  it.each([
    ["active HTML", "text/html", "text/html", "<!doctype html><script>sentinel()</script>"],
    ["active SVG", "image/svg+xml", "image/svg+xml", "<svg onload='sentinel()'></svg>"],
    ["HTML mislabeled as PNG", "image/png", "image/png", "<!doctype html><script>sentinel()</script>"],
    ["header and Blob mismatch", "application/pdf", "image/png", pngBytes]
  ])("downloads %s from a fresh canonical Blob without navigating", async (_name, responseMimeType, blobMimeType, content) => {
    const original = new Blob([content], { type: blobMimeType });
    fetchOriginalFile.mockResolvedValue({
      blob: original,
      mimeType: responseMimeType,
      filename: "../unsafe\nfile.png"
    });
    const order: string[] = [];
    const opened = popup();
    opened.close.mockImplementation(() => order.push("close"));
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      order.push("click");
      clicked = this;
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");

    const task = createRuntime({ setTimeout: vi.fn(() => 45), openPopup: () => opened })
      .startOriginalFileOpen({ path: "Archive/misleading.pdf", token: "session-token" });
    await expect(task.completion).resolves.toBeUndefined();

    expect(order).toEqual(["close", "click"]);
    expect(opened.readHref()).toBe("about:blank");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const downloadBlob = createObjectURL.mock.calls[0]?.[0];
    if (!(downloadBlob instanceof Blob)) throw new Error("Expected canonical download Blob.");
    expect(downloadBlob).not.toBe(original);
    expect(downloadBlob.type).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(await readBlob(downloadBlob))))
      .toEqual(Array.from(new Uint8Array(await readBlob(original))));
    expect(clicked).toBeDefined();
    expect(clicked?.download).toBe("_unsafe_file.png");
    expect(clicked?.target).toBe("");
    expect(clicked?.rel).toBe("noopener noreferrer");
    expect(document.body.contains(clicked ?? null)).toBe(false);
  });

  it("cancels during the bounded prefix read without allocating or handing off a URL", async () => {
    let resolvePrefix: (value: ArrayBuffer) => void = () => {};
    const prefixRead = new Promise<ArrayBuffer>((resolve) => { resolvePrefix = resolve; });
    const original = new Blob([pngBytes], { type: "image/png" });
    Object.defineProperty(original, "slice", {
      configurable: true,
      value: () => ({ arrayBuffer: () => prefixRead })
    });
    fetchOriginalFile.mockResolvedValue({ blob: original, mimeType: "image/png", filename: "photo.png" });
    const opened = popup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    const task = createRuntime({ openPopup: () => opened })
      .startOriginalFileOpen({ path: "Photos/photo.png", token: "session-token" });
    await Promise.resolve();
    task.cancel();
    resolvePrefix(pngBytes.buffer);
    await expect(task.completion).resolves.toBeUndefined();

    expect(opened.close).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("forwards browser timing, location, PDF rendering, and exact keydown cleanup", () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const runtime = createRuntime();
    const frame = vi.fn();
    const timer = vi.fn();
    const keydown = vi.fn();

    expect(runtime.pdf.requestAnimationFrame(frame)).toBe(7);
    expect(requestAnimationFrame).toHaveBeenCalledWith(frame);
    const timeoutId = runtime.setTimeout(timer, 123);
    expect(vi.getTimerCount()).toBe(1);
    runtime.clearTimeout(timeoutId);
    runtime.clearTimeout(undefined);
    expect(vi.getTimerCount()).toBe(0);
    expect(runtime.getLocationHref()).toBe(window.location.href);
    expect(runtime.video.getLocationHref()).toBe(window.location.href);

    const cleanup = runtime.addWindowKeydownListener(keydown);
    expect(addEventListener).toHaveBeenCalledWith("keydown", keydown);
    cleanup();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith("keydown", keydown);
  });

  it("routes general and video timer cancellation through the injected clearer", () => {
    const setTimeout = vi.fn(() => 71);
    const clearTimeout = vi.fn();
    const runtime = createRuntime({ setTimeout, clearTimeout });
    const callback = vi.fn();

    expect(runtime.setTimeout(callback, 100)).toBe(71);
    expect(runtime.video.setTimeout(callback, 200)).toBe(71);
    runtime.clearTimeout(undefined);
    runtime.video.clearTimeout(undefined);
    expect(clearTimeout).not.toHaveBeenCalled();

    runtime.clearTimeout(71);
    runtime.video.clearTimeout(72);
    expect(clearTimeout.mock.calls).toEqual([[71], [72]]);
  });

  it("forwards PDF fetch, device pixel ratio, ResizeObserver, and audio resume", async () => {
    const response = new Response("pdf");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2.5 });
    const observe = vi.fn();
    const disconnect = vi.fn();
    const resizeObserver = vi.fn(function (this: { observe: typeof observe; disconnect: typeof disconnect }) {
      this.observe = observe;
      this.disconnect = disconnect;
    });
    vi.stubGlobal("ResizeObserver", resizeObserver);
    const runtime = createRuntime();
    const callback = vi.fn();

    expect(runtime.pdf.loadPdfJs).toBe(loadPdfPreviewModule);
    await expect(runtime.pdf.fetch("/worker.pdf", { cache: "force-cache" })).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledWith("/worker.pdf", { cache: "force-cache" });
    expect(runtime.pdf.getDevicePixelRatio()).toBe(2.5);
    expect(runtime.pdf.createResizeObserver(callback)).toMatchObject({ observe, disconnect });
    expect(resizeObserver).toHaveBeenCalledWith(callback);

    const target = { accountId: "account-a", path: "Audio/episode.mp3" };
    runtime.saveAudioPreviewPosition(target, 12.5);
    expect(runtime.loadAudioPreviewPosition(target)).toBe(12.5);
    runtime.clearAudioPreviewPosition(target);
    expect(runtime.loadAudioPreviewPosition(target)).toBeUndefined();

  });
});
