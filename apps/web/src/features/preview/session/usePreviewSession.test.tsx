import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createPreviewSnapshot, type PreviewSessionState } from "./model";
import type {
  PreviewAcquisition,
  PreviewCacheEntry,
  PreviewCacheSnapshot,
  PreviewCacheWriteResult,
  PreviewFailure,
  PreviewMaterial,
  PreviewResource,
  PreviewSessionPorts
} from "./ports";
import type { PreviewSessionAdapterBundle, PreviewSessionCompositionFactories, UsePreviewSessionInput } from "./usePreviewSessionPorts";
import { usePreviewSession } from "./usePreviewSession";

const request = {
  accountId: "alpha",
  cacheNamespace: "ns",
  path: "Docs/report.txt",
  contextGeneration: "1",
  connectionMode: "online" as const,
  heicPreviewEnabled: false,
  freshnessIntervalMs: 10_000,
  cacheLimitBytes: 1000,
  target: "previewable" as const
};

function acquisition(fingerprint: string, source: "inline" | "blob" | "stream" = "inline"): PreviewAcquisition {
  return {
    snapshot: createPreviewSnapshot({
      preview: {
        path: request.path,
        name: "report.txt",
        isFolder: false,
        viewer: "text",
        content: fingerprint,
        encoding: "utf8",
        truncated: false,
        bytesRead: fingerprint.length
      },
      fingerprint,
      source
    }),
    ...(source === "inline" ? {} : { material: { id: `material-${fingerprint}`, kind: source } })
  };
}

function cacheSnapshot(): PreviewCacheSnapshot {
  return { itemCount: 1, totalBytes: 5, limitBytes: 1000 };
}

function cacheWriteResult(snapshot = cacheSnapshot()): PreviewCacheWriteResult {
  return { kind: "stored", snapshot };
}

function createAdapterBundle(overrides: Partial<PreviewSessionPorts> = {}): PreviewSessionAdapterBundle & {
  published: PreviewSessionState[];
  cacheSnapshots: PreviewCacheSnapshot[];
  cacheEvents: Array<{ kind: string }>;
  publishedFailures: PreviewFailure[];
  releases: string[];
  aborts: string[];
} {
  const ports = createPorts(overrides);
  return {
    cache: ports.cache,
    live: ports.live,
    abort: ports.abort,
    resources: ports.resources,
    failures: ports.failures,
    prefetch: {
      probe: vi.fn(async () => false),
      prefetch: vi.fn(async () => ({ kind: "cached" as const }))
    },
    clock: ports.clock,
    resolveResourceUrl: (resource) => `url://${resource.id}`,
    published: ports.published,
    cacheSnapshots: ports.cacheSnapshots,
    cacheEvents: ports.cacheEvents,
    publishedFailures: ports.publishedFailures,
    releases: ports.releases,
    aborts: ports.aborts
  };
}

function createPorts(overrides: Partial<PreviewSessionPorts> = {}) {
  const published: PreviewSessionState[] = [];
  const cacheSnapshots: PreviewCacheSnapshot[] = [];
  const cacheEvents: Array<{ kind: string }> = [];
  const publishedFailures: PreviewFailure[] = [];
  const releases: string[] = [];
  const aborts: string[] = [];
  let abortCount = 0;
  const ports: PreviewSessionPorts & {
    published: PreviewSessionState[];
    cacheSnapshots: PreviewCacheSnapshot[];
    cacheEvents: Array<{ kind: string }>;
    publishedFailures: PreviewFailure[];
    releases: string[];
    aborts: string[];
  } = {
    cache: {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => cacheWriteResult())
    },
    live: {
      acquire: vi.fn(async () => acquisition("live"))
    },
    abort: {
      create: vi.fn(() => {
        const id = `abort-${++abortCount}`;
        return { id, abort: () => aborts.push(id) };
      })
    },
    resources: {
      apply: vi.fn((material: PreviewMaterial): PreviewResource => ({ id: `resource-${material.id}`, kind: material.kind })),
      release: vi.fn((resource: PreviewResource) => { releases.push(resource.id); })
    },
    current: { isCurrent: () => true },
    failures: { classify: (error) => ({ kind: "ordinary", message: error instanceof Error ? error.message : "unavailable" }) },
    failurePublication: { publishFailure: (_key, failure) => { publishedFailures.push(failure); return true; } },
    publication: { publish: (state) => { published.push(state); return true; } },
    cachePublication: {
      publishSnapshot: (_key, snapshot) => { cacheSnapshots.push(snapshot); return true; },
      publishEvent: (event) => { cacheEvents.push(event); return true; }
    },
    clock: { now: () => 10_001 },
    published,
    cacheSnapshots,
    cacheEvents,
    publishedFailures,
    releases,
    aborts,
    ...overrides
  };
  return ports;
}

function createInput(overrides: Partial<UsePreviewSessionInput> = {}): UsePreviewSessionInput {
  const bundle = createAdapterBundle();
  return {
    accountId: "alpha",
    cacheNamespace: "ns",
    accountName: "Workspace",
    token: "token-a",
    cacheOnlyMode: false,
    openedEntryPath: request.path,
    composition: {
      createSessionAdapters: () => bundle
    },
    callbacks: {
      onResetSession: vi.fn(),
      onMarkWorkerUnavailable: vi.fn(),
      onPublishCacheSummary: vi.fn(),
      onStreamCacheReady: vi.fn(),
      onStreamCacheFailed: vi.fn(),
      onOpenedEntryClear: vi.fn()
    },
    ...overrides
  };
}

describe("usePreviewSession", () => {
  it("maps controller publications into preview UI state", async () => {
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => ({
          acquisition: acquisition("cached", "blob"),
          cachedAt: "2026-07-18T12:00:00.000Z",
          cachedAtMs: 5_000
        } satisfies PreviewCacheEntry)),
        write: vi.fn(async () => cacheWriteResult())
      }
    });
    const input = createInput({
      composition: { createSessionAdapters: () => bundle }
    });
    const { result } = renderHook(() => usePreviewSession(input));

    await act(async () => {
      await result.current.open(request);
    });

    await waitFor(() => {
      expect(result.current.selected?.content).toBe("cached");
      expect(result.current.previewOpen).toBe(true);
      expect(result.current.loadingPreview).toBe(false);
      expect(result.current.previewCacheState.source).toBe("cache");
      expect(result.current.selectedBlobUrl).toBe("url://resource-material-cached");
    });
  });

  it("aborts and releases resources on close", async () => {
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => cacheWriteResult())
      },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const input = createInput({
      composition: { createSessionAdapters: () => bundle }
    });
    const { result } = renderHook(() => usePreviewSession(input));

    await act(async () => {
      await result.current.open(request);
    });
    expect(bundle.releases).toEqual([]);

    act(() => {
      result.current.close();
    });
    expect(bundle.aborts.length).toBeGreaterThan(0);
    expect(bundle.releases).toEqual(["resource-material-live"]);
    expect(result.current.sessionState.kind).toBe("closed");
    expect(input.callbacks.onOpenedEntryClear).toHaveBeenCalled();
  });

  it("invalidates active preview work on unmount", async () => {
    let resolveLive!: (value: PreviewAcquisition) => void;
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => cacheWriteResult())
      },
      live: {
        acquire: vi.fn(async () => new Promise<PreviewAcquisition>((resolve) => {
          resolveLive = resolve;
        }))
      }
    });
    const input = createInput({
      composition: { createSessionAdapters: () => bundle }
    });
    const { result, unmount } = renderHook(() => usePreviewSession(input));

    await act(async () => {
      void result.current.open(request);
    });
    await waitFor(() => expect(bundle.live.acquire).toHaveBeenCalled());
    unmount();
    resolveLive(acquisition("late", "blob"));
    await act(async () => undefined);
    expect(bundle.aborts.length).toBeGreaterThan(0);
  });

  it("runs cleanup safely across StrictMode mount and unmount", () => {
    const input = createInput();
    const { unmount } = renderHook(() => usePreviewSession(input), { wrapper: StrictMode });
    unmount();
    expect(input.callbacks.onOpenedEntryClear).toHaveBeenCalled();
  });

  it("resets preview state when preview context identity changes", async () => {
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => cacheWriteResult())
      },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const input = createInput({
      composition: { createSessionAdapters: () => bundle }
    });
    const { result, rerender } = renderHook(
      (props: UsePreviewSessionInput) => usePreviewSession(props),
      { initialProps: input }
    );

    await act(async () => {
      await result.current.open(request);
    });
    expect(result.current.sessionState.kind).toBe("live");

    rerender({ ...input, token: "token-b" });
    expect(result.current.sessionState.kind).toBe("closed");
    expect(input.callbacks.onOpenedEntryClear).toHaveBeenCalled();
  });

  it("publishes cache summaries and stream-cache status only for the active account namespace", async () => {
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => cacheWriteResult())
      },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const onPublishCacheSummary = vi.fn();
    const onStreamCacheReady = vi.fn();
    const input = createInput({
      composition: { createSessionAdapters: () => bundle },
      callbacks: {
        ...createInput().callbacks,
        onPublishCacheSummary,
        onStreamCacheReady
      }
    });
    const { result } = renderHook(() => usePreviewSession(input));

    await act(async () => {
      await result.current.open(request);
      await result.current.controller.waitForBackground();
    });

    expect(onPublishCacheSummary).toHaveBeenCalledWith(cacheSnapshot());
    expect(onStreamCacheReady).toHaveBeenCalledWith(request.path, "Workspace");
  });

  it("routes session-terminal and backend-unavailable failures through composition callbacks", async () => {
    const terminalBundle = createAdapterBundle({
      failures: {
        classify: () => ({ kind: "session-terminal", reason: "session-expired", message: "Session expired" })
      },
      live: { acquire: vi.fn(async () => { throw new Error("expired"); }) }
    });
    const onResetSession = vi.fn();
    const terminalInput = createInput({
      composition: { createSessionAdapters: () => terminalBundle },
      callbacks: {
        ...createInput().callbacks,
        onResetSession
      }
    });
    const terminal = renderHook(() => usePreviewSession(terminalInput));
    await act(async () => {
      await terminal.result.current.open(request);
    });
    expect(onResetSession).toHaveBeenCalledWith("Session expired", false);

    const backendBundle = createAdapterBundle({
      failures: {
        classify: () => ({ kind: "backend-unavailable", message: "Worker unavailable" })
      },
      live: { acquire: vi.fn(async () => { throw new Error("backend"); }) }
    });
    const onMarkWorkerUnavailable = vi.fn();
    const backendInput = createInput({
      composition: { createSessionAdapters: () => backendBundle },
      callbacks: {
        ...createInput().callbacks,
        onMarkWorkerUnavailable
      }
    });
    const backend = renderHook(() => usePreviewSession(backendInput));
    await act(async () => {
      await backend.result.current.open(request);
    });
    expect(onMarkWorkerUnavailable).toHaveBeenCalled();
    expect(backend.result.current.previewError?.message).toBe("Worker unavailable");
  });

  it("releases blob resources exactly once and keeps stream URLs non-revocable", async () => {
    const bundle = createAdapterBundle({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => cacheWriteResult())
      },
      live: { acquire: vi.fn(async () => acquisition("blob-live", "blob")) }
    });
    const input = createInput({
      composition: { createSessionAdapters: () => bundle }
    });
    const { result } = renderHook(() => usePreviewSession(input));

    await act(async () => {
      await result.current.open(request);
    });
    expect(bundle.releases).toEqual([]);

    await act(async () => {
      await result.current.open({ ...request, path: "Docs/other.txt" });
    });
    expect(bundle.releases).toEqual(["resource-material-blob-live"]);
  });
});

describe("PreviewSessionController integration via usePreviewSession", () => {
  it("still wires live, cache, prefetch, and abort adapters from composition", () => {
    const createSessionAdapters = vi.fn<PreviewSessionCompositionFactories["createSessionAdapters"]>(() => createAdapterBundle());
    renderHook(() => usePreviewSession(createInput({ composition: { createSessionAdapters } })));
    expect(createSessionAdapters).toHaveBeenCalledTimes(1);
    expect(typeof createSessionAdapters.mock.calls[0]?.[0]?.tokenFor).toBe("function");
  });
});
