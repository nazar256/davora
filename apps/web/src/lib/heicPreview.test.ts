import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("decodeHeicPreview", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
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
    const failedWorker = FakeHeicWorker.instances.at(-1);
    if (!failedWorker) throw new Error("Controlled HEIC worker was not created.");
    failedWorker.fail("decode failed");
    failedWorker.failMessage();
    await expect(failedDecode).rejects.toThrow("decode failed");
    expect(failedWorker.terminateCalls).toBe(1);
    expect(failedWorker.listeners.get("message")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("error")?.size ?? 0).toBe(0);
    expect(failedWorker.listeners.get("messageerror")?.size ?? 0).toBe(0);

    const recoveredDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await flushDecodeQueue();
    const recoveredWorker = FakeHeicWorker.instances.at(-1);
    if (!recoveredWorker) throw new Error("Recovered HEIC worker was not created.");
    expect(recoveredWorker).not.toBe(failedWorker);
    const request = { id: requestIdAt(recoveredWorker, 0) };
    recoveredWorker.reply({ id: request.id, ok: true, blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 1, height: 1 });
    await expect(recoveredDecode).resolves.toBeDefined();
  });

  it("serializes concurrent decodes and keeps late responses from a completed request inert", async () => {
    const firstDecode = decodeHeicPreview(new Blob(["first"], { type: "image/heic" }));
    const secondDecode = decodeHeicPreview(new Blob(["second"], { type: "image/heic" }));
    await flushDecodeQueue();
    const worker = FakeHeicWorker.instances.at(-1);
    if (!worker) throw new Error("Controlled HEIC worker was not created.");
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
    const worker = FakeHeicWorker.instances.at(-1);
    if (!worker) throw new Error("Controlled HEIC worker was not created.");
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
    const worker = FakeHeicWorker.instances.at(-1);
    if (!worker) throw new Error("Controlled HEIC worker was not created.");
    const request = { id: requestIdAt(worker, 0) };
    const timeoutExpectation = expect(decode).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);
    await timeoutExpectation;
    expect(worker.terminateCalls).toBe(1);
    worker.reply({ id: request.id, ok: true, blob: new Blob(["late"], { type: "image/jpeg" }), width: 1, height: 1 });
    expect(worker.listeners.get("message")?.size ?? 0).toBe(0);
  });
});
