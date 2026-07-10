import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeHeicPreview, HEIC_PREVIEW_TIMEOUT_MS } from "./heicPreview";

type WorkerListener = (event: MessageEvent) => void;

class FakeHeicWorker {
  static instances: FakeHeicWorker[] = [];
  listeners = new Map<string, Set<WorkerListener>>();
  messages: unknown[] = [];
  terminated = false;

  constructor() {
    FakeHeicWorker.instances.push(this);
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
    this.terminated = true;
  }

  reply(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe("decodeHeicPreview", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeHeicWorker.instances = [];
    Object.defineProperty(globalThis, "Worker", {
      value: FakeHeicWorker,
      configurable: true,
      writable: true
    });
  });

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
    await Promise.resolve();
    const firstWorker = FakeHeicWorker.instances[0];

    await vi.advanceTimersByTimeAsync(HEIC_PREVIEW_TIMEOUT_MS);

    await timedOutExpectation;
    expect(firstWorker.terminated).toBe(true);

    const recoveredDecode = decodeHeicPreview(new Blob(["heic"], { type: "image/heic" }));
    await Promise.resolve();
    const secondWorker = FakeHeicWorker.instances[1];
    expect(secondWorker).not.toBe(firstWorker);

    const request = secondWorker.messages[0] as { id: number };
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    secondWorker.reply({ id: request.id, ok: true, blob: jpeg, width: 320, height: 240 });

    await expect(recoveredDecode).resolves.toMatchObject({
      blob: jpeg,
      width: 320,
      height: 240,
      mimeType: "image/jpeg"
    });
  });
});
