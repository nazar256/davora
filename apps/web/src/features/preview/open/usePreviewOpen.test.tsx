import type { FileEntry } from "@davora/shared";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PreviewOpenPorts } from "./ports";
import { createPreviewRequestKey } from "../session/model";
import { usePreviewOpen, type UsePreviewOpenInput } from "./usePreviewOpen";

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, size: 1, mimeType: "image/png" };
}

function createPorts(): PreviewOpenPorts {
  return {
    session: {
      open: vi.fn(async () => ({
        kind: "opened" as const,
        key: createPreviewRequestKey({
          requestSequence: 1,
          accountId: "alpha",
          cacheNamespace: "ns",
          path: "test.txt",
          contextGeneration: "1",
          connectionMode: "online",
          heicPreviewEnabled: false,
          freshnessIntervalMs: 1000,
          cacheLimitBytes: 1024
        })
      })),
      applyRefresh: vi.fn(async () => ({ kind: "not-ready" as const })),
      clearOwner: vi.fn()
    },
    navigation: {
      pushPreviewSurface: vi.fn(),
      closeMobileDetails: vi.fn()
    },
    folderAudio: {
      pause: vi.fn(),
      activate: vi.fn()
    },
    surface: {
      close: vi.fn(),
      isOpen: vi.fn(() => false),
      setOpenedEntry: vi.fn(),
      setOpenedEntryPath: vi.fn(),
      clearSelection: vi.fn(),
      setPreviewError: vi.fn(),
      setStatus: vi.fn(),
      reportListError: vi.fn(),
      markWorkerAvailable: vi.fn()
    },
    unsupportedDownload: {
      isCurrentHandler: vi.fn(() => true),
      canDownloadFocused: vi.fn(() => true),
      download: vi.fn(async () => undefined),
      reportCacheOnlyBlocked: vi.fn(),
      reportStarting: vi.fn(),
      prepareForDownload: vi.fn()
    },
    explicitOffline: {
      readCachedBlob: vi.fn(async () => undefined),
      triggerLocalOpen: vi.fn(),
      isRetentionCurrent: vi.fn(() => true),
      reportLocalOpen: vi.fn(),
      reportUnreadable: vi.fn()
    },
    prefetch: {
      runtime: {
        probe: vi.fn(async () => false),
        prefetch: vi.fn(async () => ({ kind: "cached" as const }))
      },
      context: {
        getContextGeneration: vi.fn(() => "1"),
        getAccountId: vi.fn(() => "alpha"),
        getCacheNamespace: vi.fn(() => "ns"),
        isStillCurrent: vi.fn(() => true),
        nextPrefetchSequence: vi.fn(() => 1),
        trackPrefetchAbort: vi.fn(),
        untrackPrefetchAbort: vi.fn(),
        createAbort: vi.fn(() => ({ id: "abort", abort: vi.fn() }))
      },
      acceptPolicy: { accept: () => true },
      refreshCacheSummary: vi.fn(async () => undefined)
    },
    refresh: {
      applyPending: vi.fn(async () => undefined)
    }
  };
}

function createInput(
  overrides: Partial<UsePreviewOpenInput> = {}
): UsePreviewOpenInput {
  return {
    visibleItems: [entry("Archive/a.png")],
    openedEntry: undefined,
    experimentalHeicPreviewEnabled: false,
    previewFreshnessIntervalSeconds: 60,
    maxCacheableFileSizeBytes: 1024,
    token: "token-a",
    cacheOnlyMode: false,
    cacheNamespace: "ns",
    activeAccount: { id: "alpha", cacheNamespace: "ns", displayName: "Workspace" },
    explicitOfflineMode: false,
    offline: false,
    previewContextGeneration: () => "1",
    ports: createPorts(),
    onInvalidatePrefetch: vi.fn(),
    ...overrides
  };
}

describe("usePreviewOpen", () => {
  it("invalidates prefetch when token identity changes while staying truthy", () => {
    const onInvalidatePrefetch = vi.fn();
    const { rerender } = renderHook(
      ({ token }) => usePreviewOpen(createInput({ token, onInvalidatePrefetch })),
      { initialProps: { token: "token-a" } }
    );

    expect(onInvalidatePrefetch).toHaveBeenCalledTimes(1);

    onInvalidatePrefetch.mockClear();
    rerender({ token: "token-b" });
    expect(onInvalidatePrefetch).toHaveBeenCalledTimes(1);

    onInvalidatePrefetch.mockClear();
    rerender({ token: "token-b" });
    expect(onInvalidatePrefetch).not.toHaveBeenCalled();
  });
});
