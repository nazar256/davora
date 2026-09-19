import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../../test/primitives";
import { executeFolderLoad, type FolderControllerCallbacks, type FolderLoadInput } from "./controller";
import type { FolderEvent, FolderRequest } from "./model";
import type { FolderLoadOutcome, FolderPorts } from "./ports";

const contextToken = {};
const request: FolderRequest = {
  key: { accountId: "alpha", cacheNamespace: "ns-alpha", path: "Docs" },
  generation: 1,
  contextToken
};
const cachedItems: FileEntry[] = [{ path: "Docs/cached.txt", name: "cached.txt", isFolder: false }];
const liveItems: FileEntry[] = [{ path: "Docs/live.txt", name: "live.txt", isFolder: false }];

const setup = (overrides: Partial<FolderPorts> = {}, accept = true) => {
  const events: FolderEvent[] = [];
  const ports: FolderPorts = {
    createAbortHandle: () => new AbortController(),
    loadFolder: vi.fn(async (): Promise<FolderLoadOutcome> => ({ kind: "success", items: liveItems })),
    readCachedFolder: vi.fn(() => undefined),
    writeCachedFolder: vi.fn(() => undefined),
    ...overrides
  };
  const callbacks: FolderControllerCallbacks = {
    emit: vi.fn((event: FolderEvent) => {
      events.push(event);
      return accept;
    }),
    onSessionTerminated: vi.fn(),
    onWorkerAvailable: vi.fn(),
    onWorkerUnavailable: vi.fn()
  };
  return { callbacks, events, ports };
};

const input = (overrides: Partial<FolderLoadInput> = {}): FolderLoadInput => ({
  request,
  token: "token-alpha",
  mode: "online",
  preferCache: true,
  announceStatus: true,
  explicitOfflineItems: [],
  signal: new AbortController().signal,
  ...overrides
});

describe("folder load controller", () => {
  it("shows cache synchronously, refreshes live, and writes only an accepted result", async () => {
    const deferred = createDeferred<FolderLoadOutcome>();
    const { callbacks, events, ports } = setup({
      readCachedFolder: vi.fn(() => ({ items: cachedItems, cachedAt: "2026-01-01" })),
      loadFolder: vi.fn(() => deferred.promise)
    });

    const completion = executeFolderLoad(input(), ports, callbacks);
    expect(events.map((event) => event.type)).toEqual(["request-started", "cached-snapshot-shown"]);
    deferred.resolve({ kind: "success", items: liveItems });
    await completion;

    expect(events.at(-1)).toMatchObject({ type: "live-response-accepted", items: liveItems, message: "refreshed" });
    expect(ports.writeCachedFolder).toHaveBeenCalledWith("ns-alpha", "Docs", liveItems);
    expect(callbacks.onWorkerAvailable).toHaveBeenCalledOnce();
  });

  it("retains cached items without a load failure when live refresh fails", async () => {
    const error = new Error("refresh failed");
    const { events, ports, callbacks } = setup({
      readCachedFolder: vi.fn(() => ({ items: cachedItems })),
      loadFolder: vi.fn(async (): Promise<FolderLoadOutcome> => ({ kind: "failure", error }))
    });

    await executeFolderLoad(input(), ports, callbacks);

    expect(events.at(-1)).toEqual({ type: "refresh-failed", request, items: cachedItems });
    expect(ports.writeCachedFolder).not.toHaveBeenCalled();
  });

  it.each([
    ["offline", "offline-cache-miss"],
    ["server-unavailable", "server-cache-miss"]
  ] as const)("distinguishes %s cache-only misses without a network call", async (mode, reason) => {
    const { events, ports, callbacks } = setup();

    await executeFolderLoad(input({ mode, token: undefined }), ports, callbacks);

    expect(events.at(-1)).toMatchObject({ type: "load-failed", reason });
    expect(ports.loadFolder).not.toHaveBeenCalled();
  });

  it("publishes explicit-offline items without reading cache or starting network work", async () => {
    const { events, ports, callbacks } = setup();

    await executeFolderLoad(input({ mode: "explicit-offline", token: undefined, explicitOfflineItems: cachedItems }), ports, callbacks);

    expect(events.at(-1)).toEqual({ type: "explicit-offline-snapshot-shown", request, items: cachedItems });
    expect(ports.readCachedFolder).not.toHaveBeenCalled();
    expect(ports.loadFolder).not.toHaveBeenCalled();
  });

  it("forced reload bypasses cache and reports a live failure", async () => {
    const error = new Error("failed");
    const { events, ports, callbacks } = setup({
      loadFolder: vi.fn(async (): Promise<FolderLoadOutcome> => ({ kind: "failure", error }))
    });

    await executeFolderLoad(input({ preferCache: false }), ports, callbacks);

    expect(ports.readCachedFolder).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "load-failed", request, error, reason: "live-failure" });
  });

  it("marks a successful refresh silent when its caller owns the resulting status", async () => {
    const { events, ports, callbacks } = setup();

    await executeFolderLoad(input({ announceStatus: false }), ports, callbacks);

    expect(events.at(-1)).toMatchObject({ type: "live-response-accepted", message: "silent" });
  });

  it.each(["unauthorized", "reconnect-required"] as const)("terminates the current %s request once", async (kind) => {
    const error = new Error(kind);
    const { callbacks, ports } = setup({ loadFolder: vi.fn(async () => ({ kind, error })) });

    await executeFolderLoad(input(), ports, callbacks);

    expect(callbacks.onSessionTerminated).toHaveBeenCalledWith(kind, error);
    expect(callbacks.onSessionTerminated).toHaveBeenCalledOnce();
  });

  it("does not write cache, update availability, or terminate a stale request", async () => {
    const { callbacks, ports } = setup({}, false);

    await executeFolderLoad(input(), ports, callbacks);

    expect(ports.writeCachedFolder).not.toHaveBeenCalled();
    expect(callbacks.onWorkerAvailable).not.toHaveBeenCalled();
    expect(callbacks.onSessionTerminated).not.toHaveBeenCalled();
  });
});
