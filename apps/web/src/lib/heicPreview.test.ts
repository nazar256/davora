import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";

// jsdom's Blob lacks slice().arrayBuffer(); Node's Blob has both.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsdom's Blob has no arrayBuffer(); Node's Blob satisfies the decoder contract.
const TestBlob = NodeBlob as unknown as typeof Blob;

const decodeHeicToRgbaMock = vi.hoisted(() => vi.fn());
vi.mock("./heicDecoder", () => ({ decodeHeicToRgba: decodeHeicToRgbaMock }));

let decodeHeicPreview: typeof import("./heicPreview")["decodeHeicPreview"];
let HEIC_PREVIEW_TIMEOUT_MS: typeof import("./heicPreview")["HEIC_PREVIEW_TIMEOUT_MS"];

type WorkerListener = (event: MessageEvent) => void;

class FakeHeicWorker {
  static instances: FakeHeicWorker[] = [];
  static current: FakeHeicWorker | undefined;
  listeners = new Map<string, Set<WorkerListener>>();
  messages: unknown[] = [];
  terminated = false;
  terminateCalls = 0;

  constructor() {
    FakeHeicWorker.instances.push(this);
    FakeHeicWorker.current = this;
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminateCalls += 1;
    this.terminated = true;
  }

  reply(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data }));
    }
  }

  fail(message = "worker failed") {
    const event = new MessageEvent("error");
    Object.defineProperty(event, "message", { value: message });
    for (const listener of this.listeners.get("error") ?? []) {
      listener(event);
    }
  }

  failMessage() {
    for (const listener of this.listeners.get("messageerror") ?? []) {
      listener(new MessageEvent("messageerror"));
    }
  }
}

function requestIdAt(worker: FakeHeicWorker, index: number): number {
  const message = worker.messages[index];
  if (!message || typeof message !== "object" || !("id" in message) || typeof message.id !== "number") {
    throw new Error("Controlled HEIC request is unavailable.");
  }
  return message.id;
}

function stubHeicDomCanvas(output: Blob | null = new TestBlob(["main-jpeg"], { type: "image/jpeg" })) {
  const putImageData = vi.fn();
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: (contextId: string) => (contextId === "2d" ? { putImageData } : null),
    toBlob: (callback: (blob: Blob | null) => void) => callback(output)
  };
  const realCreateElement = document.createElement.bind(document);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the fake canvas only satisfies the 2d-context surface the decoder calls.
  const spy = vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions
  ) => (tag === "canvas" ? fakeCanvas : realCreateElement(tag, options))) as typeof document.createElement);
  return { putImageData, fakeCanvas, output, restore: () => spy.mockRestore() };
}

function fakePixels(width: number, height: number) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function fakeRgbaMessage(worker: FakeHeicWorker, index: number, width: number, height: number) {
  return { id: requestIdAt(worker, index), ok: "rgba" as const, rgba: new Uint8ClampedArray(width * height * 4), width, height };
}

function lastWorker(): FakeHeicWorker {
  const worker = FakeHeicWorker.instances.at(-1);
  if (!worker) throw new Error("Controlled HEIC worker was not created.");
  return worker;
}

// jsdom ships no ImageData global; the encode path only forwards it to
// putImageData, so a shape-correct stub is sufficient.
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

describe("decodeHeicPreview", () => {
  const originalWorker = globalThis.Worker;
  const originalImageData = globalThis.ImageData;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    decodeHeicToRgbaMock.mockReset().mockRejectedValue(new Error("main-thread decode unavailable"));
    FakeHeicWorker.instances = [];
    FakeHeicWorker.current = undefined;
    Object.defineProperty(globalThis, "Worker", {
      value: FakeHeicWorker,
      configurable: true,
      writable: true
    });
    Object.defineProperty(globalThis, "ImageData", {
      value: FakeImageData,
      configurable: true,
      writable: true
    });
    return import("./heicPreview").then((module) => {
      decodeHeicPreview = module.decodeHeicPreview;
      HEIC_PREVIEW_TIMEOUT_MS = module.HEIC_PREVIEW_TIMEOUT_MS;
    });
  });

  async function flushDecodeQueue(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "Worker", {
      value: originalWorker,
      configurable: true,
      writable: true
    });
    Object.defineProperty(globalThis, "ImageData", {
      value: originalImageData,
      configurable: true,
      writable: true
    });
  });

  it("terminates timed-out HEIC workers and recovers with a fresh worker", async () => {
    stubHeicDomCanvas();
    const timedOutDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    const timedOutExpectation = expect(timedOutDecode).rejects.toThrow(/timed out/i);
    await flushDecodeQueue();
    const firstWorker = FakeHeicWorker.instances[0];

    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);

    await timedOutExpectation;
    expect(firstWorker.terminated).toBe(true);
    // A hung decode must not be retried on the main thread — it would freeze the UI.
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();

    const recoveredDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const secondWorker = FakeHeicWorker.instances[1];
    expect(secondWorker).not.toBe(firstWorker);

    secondWorker.reply(fakeRgbaMessage(secondWorker, 0, 320, 240));

    await expect(recoveredDecode).resolves.toMatchObject({
      width: 320,
      height: 240,
      mimeType: "image/jpeg"
    });
  });

  it("cleans up worker errors exactly once and recovers with a fresh worker", async () => {
    stubHeicDomCanvas();
    const failedDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const failedWorker = lastWorker();
    failedWorker.fail("decode failed");
    failedWorker.failMessage();
    await expect(failedDecode).rejects.toThrow("decode failed");
    expect(failedWorker.terminateCalls).toBe(1);
    expect(failedWorker.listeners.get("message")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("error")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("messageerror")?.size ?? 0).toBe(0);

    const recoveredDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const recoveredWorker = lastWorker();
    expect(recoveredWorker).not.toBe(failedWorker);
    recoveredWorker.reply(fakeRgbaMessage(recoveredWorker, 0, 1, 1));
    await expect(recoveredDecode).resolves.toBeDefined();
  });

  it("serializes concurrent decodes and keeps late responses from a completed request inert", async () => {
    stubHeicDomCanvas();
    const firstDecode = decodeHeicPreview(new TestBlob(["first"], { type: "image/heic" }));
    const secondDecode = decodeHeicPreview(new TestBlob(["second"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    expect(worker.messages).toHaveLength(1);
    worker.reply(fakeRgbaMessage(worker, 0, 2, 3));
    await expect(firstDecode).resolves.toBeDefined();
    await flushDecodeQueue();
    expect(worker.messages).toHaveLength(2);
    worker.reply(fakeRgbaMessage(worker, 1, 4, 5));
    await expect(secondDecode).resolves.toBeDefined();
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);
  });

  it("reuses a worker after a decode failure while removing the failed request listeners", async () => {
    stubHeicDomCanvas();
    const failedDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    const failedRequest = { id: requestIdAt(worker, 0) };
    worker.reply({ id: failedRequest.id, ok: false, error: "unsupported HEIC payload" });
    await expect(failedDecode).rejects.toThrow("unsupported HEIC payload");
    expect(worker.terminated).toBe(false);
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);

    const recoveredDecode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    expect(FakeHeicWorker.instances).toHaveLength(1);
    worker.reply(fakeRgbaMessage(worker, 1, 8, 9));
    await expect(recoveredDecode).resolves.toBeDefined();
  });

  it("makes timeout callbacks and late worker responses inert", async () => {
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    const request = { id: requestIdAt(worker, 0) };
    const timeoutExpectation = expect(decode).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);
    await timeoutExpectation;
    expect(worker.terminateCalls).toBe(1);
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();
    worker.reply({ id: request.id, ok: "rgba", rgba: new Uint8ClampedArray(4), width: 1, height: 1 });
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);
  });

  it("encodes worker-transferred RGBA pixels on a DOM canvas", async () => {
    const canvasStub = stubHeicDomCanvas();
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    const pixels = fakePixels(8, 6);
    worker.reply({ id: requestIdAt(worker, 0), ok: "rgba", rgba: pixels.data, width: 8, height: 6 });

    const result = await decode;
    expect(result).toMatchObject({ blob: canvasStub.output, width: 8, height: 6, mimeType: "image/jpeg" });
    expect(canvasStub.fakeCanvas.width).toBe(8);
    expect(canvasStub.fakeCanvas.height).toBe(6);
    expect(canvasStub.putImageData).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();
  });

  it("retries the decode on the main thread when the worker reports a failure", async () => {
    const canvasStub = stubHeicDomCanvas();
    decodeHeicToRgbaMock.mockResolvedValue(fakePixels(8, 6));
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "decoder init failed" });

    await expect(decode).resolves.toMatchObject({ blob: canvasStub.output, width: 8, height: 6 });
    expect(decodeHeicToRgbaMock).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
  });

  it("retries the decode on the main thread when the worker errors out", async () => {
    stubHeicDomCanvas();
    decodeHeicToRgbaMock.mockResolvedValue(fakePixels(4, 3));
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    lastWorker().fail("worker script failed");

    await expect(decode).resolves.toMatchObject({ width: 4, height: 3, mimeType: "image/jpeg" });
    expect(decodeHeicToRgbaMock).toHaveBeenCalledTimes(1);
  });

  it("decodes on the main thread when Web Workers are unavailable", async () => {
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    stubHeicDomCanvas();
    decodeHeicToRgbaMock.mockResolvedValue(fakePixels(4, 3));

    await expect(decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" })))
      .resolves.toMatchObject({ width: 4, height: 3, mimeType: "image/jpeg" });
    expect(FakeHeicWorker.instances).toHaveLength(0);
    expect(decodeHeicToRgbaMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry deterministic worker failures on the main thread", async () => {
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "HEIC preview is limited to 40 megapixels.", retryable: false });

    await expect(decode).rejects.toThrow("megapixels");
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();
  });

  it("enforces the pixel limit on the main-thread fallback path", async () => {
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    decodeHeicToRgbaMock.mockRejectedValue(new Error("HEIC preview is limited to 40 megapixels."));

    await expect(decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" })))
      .rejects.toThrow("megapixels");
  });

  it("reports both failure messages when worker and main-thread decodes fail", async () => {
    stubHeicDomCanvas();
    decodeHeicToRgbaMock.mockRejectedValue(new Error("invalid HEIC structure"));
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    const expectation = expect(decode).rejects.toThrow(/worker canvas missing.*invalid HEIC structure/);
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "worker canvas missing" });

    await expectation;
  });

  it("preserves non-Error rejection details in combined failure reports", async () => {
    stubHeicDomCanvas();
    decodeHeicToRgbaMock.mockRejectedValue("Error: worker spawn refused");
    const decode = decodeHeicPreview(new TestBlob(["heic"], { type: "image/heic" }));
    const expectation = expect(decode).rejects.toThrow(/decode unavailable.*worker spawn refused/);
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "decode unavailable" });

    await expectation;
  });

  it("returns JPEG bytes unchanged when a server delivers them under a .heic name", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xaa, 0xbb, 0xcc, 0xdd, 0xff, 0xd9]);
    const result = await decodeHeicPreview(new TestBlob([jpegBytes], { type: "image/heic" }));

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(jpegBytes);
    expect(FakeHeicWorker.instances).toHaveLength(0);
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();
  });

  it.each([
    ["PNG", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), "image/png"],
    ["GIF", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4, 5, 6]), "image/gif"],
    ["WebP", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 1, 2]), "image/webp"],
    ["AVIF", new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 1, 2]), "image/avif"]
  ])("returns %s bytes unchanged instead of decoding them", async (_label, bytes, mimeType) => {
    const result = await decodeHeicPreview(new TestBlob([bytes], { type: "image/heic" }));

    expect(result.mimeType).toBe(mimeType);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(FakeHeicWorker.instances).toHaveLength(0);
    expect(decodeHeicToRgbaMock).not.toHaveBeenCalled();
  });

  it("still routes a real HEIF container through the decoder", async () => {
    stubHeicDomCanvas();
    const heicHead = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const decode = decodeHeicPreview(new TestBlob([heicHead, new Uint8Array(64)], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply(fakeRgbaMessage(worker, 0, 2, 2));

    await expect(decode).resolves.toMatchObject({ width: 2, height: 2, mimeType: "image/jpeg" });
  });
});
