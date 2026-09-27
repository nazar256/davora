import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const heicToMock = vi.hoisted(() => vi.fn());
vi.mock("heic-to/next", () => ({ heicTo: heicToMock }));

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

function stubHeicDomCanvas(output: Blob | null = new Blob(["main-jpeg"], { type: "image/jpeg" })) {
  const drawImage = vi.fn();
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: (contextId: string) => (contextId === "2d" ? { drawImage } : null),
    toBlob: (callback: (blob: Blob | null) => void) => callback(output)
  };
  const realCreateElement = document.createElement.bind(document);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the fake canvas only satisfies the 2d-context surface the decoder calls.
  const spy = vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions
  ) => (tag === "canvas" ? fakeCanvas : realCreateElement(tag, options))) as typeof document.createElement);
  return { drawImage, fakeCanvas, output, restore: () => spy.mockRestore() };
}

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

function lastWorker(): FakeHeicWorker {
  const worker = FakeHeicWorker.instances.at(-1);
  if (!worker) throw new Error("Controlled HEIC worker was not created.");
  return worker;
}

describe("decodeHeicPreview", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    heicToMock.mockReset().mockRejectedValue(new Error("main-thread decode unavailable"));
    FakeHeicWorker.instances = [];
    FakeHeicWorker.current = undefined;
    Object.defineProperty(globalThis, "Worker", {
      value: FakeHeicWorker,
      configurable: true,
      writable: true
    });
    return import("./heicPreview").then((module) => {
      decodeHeicPreview = module.decodeHeicPreview;
      HEIC_PREVIEW_TIMEOUT_MS = module.HEIC_PREVIEW_TIMEOUT_MS;
    });
  });

  async function flushDecodeQueue(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "Worker", {
      value: originalWorker,
      configurable: true,
      writable: true
    });
  });

  it("terminates timed-out HEIC workers and recovers with a fresh worker", async () => {
    const timedOutDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    const timedOutExpectation = expect(timedOutDecode).rejects.toThrow(/timed out/i);
    await flushDecodeQueue();
    const firstWorker = FakeHeicWorker.instances[0];

    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);

    await timedOutExpectation;
    expect(firstWorker.terminated).toBe(true);
    // A hung decode must not be retried on the main thread — it would freeze the UI.
    expect(heicToMock).not.toHaveBeenCalled();

    const recoveredDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const secondWorker = FakeHeicWorker.instances[1];
    expect(secondWorker).not.toBe(firstWorker);

    const request = { id: requestIdAt(secondWorker, 0) };
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    secondWorker.reply({ id: request.id, ok: true, blob: jpeg, width: 320, height: 240 });

    await expect(recoveredDecode).resolves.toMatchObject({
      blob: jpeg,
      width: 320,
      height: 240,
      mimeType: "image/jpeg"
    });
  });

  it("cleans up worker errors exactly once and recovers with a fresh worker", async () => {
    const failedDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const failedWorker = lastWorker();
    failedWorker.fail("decode failed");
    failedWorker.failMessage();
    await expect(failedDecode).rejects.toThrow("decode failed");
    expect(failedWorker.terminateCalls).toBe(1);
    expect(failedWorker.listeners.get("message")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("error")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("messageerror")?.size ?? 0).toBe(0);

    const recoveredDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const recoveredWorker = lastWorker();
    expect(recoveredWorker).not.toBe(failedWorker);
    const request = { id: requestIdAt(recoveredWorker, 0) };
    recoveredWorker.reply({ id: request.id, ok: true, blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 1, height: 1 });
    await expect(recoveredDecode).resolves.toBeDefined();
  });

  it("serializes concurrent decodes and keeps late responses from a completed request inert", async () => {
    const firstDecode = decodeHeicPreview(new Blob(["first"], { type: "image/heic" }));
    const secondDecode = decodeHeicPreview(new Blob(["second"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    expect(worker.messages).toHaveLength(1);
    const firstRequest = { id: requestIdAt(worker, 0) };
    worker.reply({ id: firstRequest.id, ok: true, blob: new Blob(["first-jpeg"], { type: "image/jpeg" }), width: 2, height: 3 });
    await expect(firstDecode).resolves.toBeDefined();
    await flushDecodeQueue();
    expect(worker.messages).toHaveLength(2);
    const secondRequest = { id: requestIdAt(worker, 1) };
    worker.reply({ id: secondRequest.id, ok: true, blob: new Blob(["second-jpeg"], { type: "image/jpeg" }), width: 4, height: 5 });
    await expect(secondDecode).resolves.toBeDefined();
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);
  });

  it("reuses a worker after a decode failure while removing the failed request listeners", async () => {
    const failedDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    const failedRequest = { id: requestIdAt(worker, 0) };
    worker.reply({ id: failedRequest.id, ok: false, error: "unsupported HEIC payload" });
    await expect(failedDecode).rejects.toThrow("unsupported HEIC payload");
    expect(worker.terminated).toBe(false);
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);

    const recoveredDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    expect(FakeHeicWorker.instances).toHaveLength(1);
    const recoveredRequest = { id: requestIdAt(worker, 1) };
    worker.reply({ id: recoveredRequest.id, ok: true, blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 8, height: 9 });
    await expect(recoveredDecode).resolves.toBeDefined();
  });

  it("makes timeout callbacks and late worker responses inert", async () => {
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    const request = { id: requestIdAt(worker, 0) };
    const timeoutExpectation = expect(decode).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);
    await timeoutExpectation;
    expect(worker.terminateCalls).toBe(1);
    expect(heicToMock).not.toHaveBeenCalled();
    worker.reply({ id: request.id, ok: true, blob: new Blob(["late"], { type: "image/jpeg" }), width: 1, height: 1 });
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);
  });

  it("encodes a worker-transferred bitmap on a DOM canvas when worker-side canvas APIs fail", async () => {
    const canvasStub = stubHeicDomCanvas();
    const bitmap = fakeBitmap(8, 6);
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: "bitmap", bitmap, width: 8, height: 6 });

    const result = await decode;
    expect(result).toMatchObject({ blob: canvasStub.output, width: 8, height: 6, mimeType: "image/jpeg" });
    expect(canvasStub.fakeCanvas.width).toBe(8);
    expect(canvasStub.fakeCanvas.height).toBe(6);
    expect(canvasStub.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it("retries the decode on the main thread when the worker reports a failure", async () => {
    const canvasStub = stubHeicDomCanvas();
    const bitmap = fakeBitmap(8, 6);
    heicToMock.mockResolvedValue(bitmap);
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "OffscreenCanvas is not defined" });

    await expect(decode).resolves.toMatchObject({ blob: canvasStub.output, width: 8, height: 6 });
    expect(heicToMock).toHaveBeenCalledWith(expect.objectContaining({ type: "bitmap" }));
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
  });

  it("retries the decode on the main thread when the worker errors out", async () => {
    stubHeicDomCanvas();
    heicToMock.mockResolvedValue(fakeBitmap(4, 3));
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    lastWorker().fail("worker script failed");

    await expect(decode).resolves.toMatchObject({ width: 4, height: 3, mimeType: "image/jpeg" });
    expect(heicToMock).toHaveBeenCalledTimes(1);
  });

  it("decodes on the main thread when Web Workers are unavailable", async () => {
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    stubHeicDomCanvas();
    heicToMock.mockResolvedValue(fakeBitmap(4, 3));

    await expect(decodeHeicPreview(new Blob(["heic"], { type: "image/heic" })))
      .resolves.toMatchObject({ width: 4, height: 3, mimeType: "image/jpeg" });
    expect(FakeHeicWorker.instances).toHaveLength(0);
    expect(heicToMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry deterministic worker failures on the main thread", async () => {
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "HEIC preview is limited to 40 megapixels.", retryable: false });

    await expect(decode).rejects.toThrow("megapixels");
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it("enforces the pixel limit on the main-thread fallback path", async () => {
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    const bitmap = fakeBitmap(8000, 8000);
    heicToMock.mockResolvedValue(bitmap);

    await expect(decodeHeicPreview(new Blob(["heic"], { type: "image/heic" })))
      .rejects.toThrow("megapixels");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("reports both failure messages when worker and main-thread decodes fail", async () => {
    stubHeicDomCanvas();
    heicToMock.mockRejectedValue(new Error("invalid HEIC structure"));
    const decode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    const expectation = expect(decode).rejects.toThrow(/worker canvas missing.*invalid HEIC structure/);
    await flushDecodeQueue();
    const worker = lastWorker();
    worker.reply({ id: requestIdAt(worker, 0), ok: false, error: "worker canvas missing" });

    await expectation;
  });
});
