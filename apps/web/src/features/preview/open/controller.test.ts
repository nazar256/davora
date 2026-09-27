import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { downloadUnsupportedPreviewFile, openPreviewFile, prefetchUpcomingPreviewMedia } from "./controller";
import { createPreviewRequestKey } from "../session/model";
import type { PreviewOpenPorts } from "./ports";

function entry(path: string, mimeType: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, size: 1, mimeType };
}

function createPorts(overrides: Partial<PreviewOpenPorts> = {}, events?: string[]): PreviewOpenPorts {
  const setOpenedEntry = vi.fn(() => events?.push("entry"));
  const setOpenedEntryPath = vi.fn(() => events?.push("path"));
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
      setOpenedEntry,
      setOpenedEntryPath,
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
    },
    ...overrides
  };
}

describe("preview open controller", () => {
  it("publishes the exact entry and path identity before opening the session", async () => {
    const events: string[] = [];
    const ports = createPorts({}, events);
    const opened = entry("Archive/report.png", "image/png");

    await openPreviewFile({
      entry: opened,
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: [opened]
    }, ports);

    expect(ports.surface.setOpenedEntryPath).toHaveBeenCalledWith(opened.path);
    expect(ports.surface.setOpenedEntry).toHaveBeenCalledWith(opened);
    expect(events).toEqual(["path", "entry"]);
    expect(ports.session.open).toHaveBeenCalledTimes(1);
  });

  it("replaces same-path metadata while reusing the existing preview surface", async () => {
    const ports = createPorts();
    const first = entry("Archive/report.png", "image/png");
    const replacement = { ...first, name: "renamed-report.png", size: 2 };
    const input = {
      entry: replacement,
      options: { reusePreviewSurface: true },
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online" as const,
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: [first, replacement]
    };

    await openPreviewFile(input, ports);

    expect(ports.navigation.pushPreviewSurface).not.toHaveBeenCalled();
    expect(ports.surface.setOpenedEntryPath).toHaveBeenCalledWith(first.path);
    expect(ports.surface.setOpenedEntry).toHaveBeenCalledWith(replacement);
  });

  it("preserves the preview-error route through the surface error adapter", async () => {
    const ports = createPorts();

    await openPreviewFile({
      entry: entry("Archive/archive.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(ports.surface.setPreviewError).toHaveBeenCalledTimes(1);
    const previewError = vi.mocked(ports.surface.setPreviewError).mock.calls[0]?.[0];
    expect(previewError).toBeInstanceOf(Error);
    expect(previewError?.message).toContain("Offline");
    expect(ports.surface.close).not.toHaveBeenCalled();
    expect(ports.session.open).not.toHaveBeenCalled();
  });

  it("does not open a deferred explicit-offline blob after the owning account is no longer current", async () => {
    const ports = createPorts({
      explicitOffline: {
        readCachedBlob: vi.fn(async () => ({ blob: new Blob(["zip"]), filename: "report.zip" })),
        triggerLocalOpen: vi.fn(),
        isRetentionCurrent: vi.fn(() => false),
        reportLocalOpen: vi.fn(),
        reportUnreadable: vi.fn()
      }
    });
    await openPreviewFile({
      entry: entry("Archive/report.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "ns-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "ns-alpha",
      accountName: "Alpha workspace",
      contextGeneration: "1",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);
    expect(ports.explicitOffline.isRetentionCurrent).toHaveBeenCalledWith("alpha", "ns-alpha");
    expect(ports.explicitOffline.triggerLocalOpen).not.toHaveBeenCalled();
    expect(ports.explicitOffline.reportLocalOpen).not.toHaveBeenCalled();
  });

  it("closes preview before starting unsupported download transfers", async () => {
    const ports = createPorts();
    await downloadUnsupportedPreviewFile("archive.bin", "archive.bin", "Workspace", ports, {
      cacheOnlyMode: false,
      offline: false
    });
    expect(ports.unsupportedDownload.prepareForDownload).toHaveBeenCalled();
    expect(ports.unsupportedDownload.download).toHaveBeenCalledWith("archive.bin", "archive.bin");
  });

  it("reports cache-only unsupported download errors without starting a transfer", async () => {
    const ports = createPorts();
    await downloadUnsupportedPreviewFile("archive.bin", "archive.bin", "Workspace", ports, {
      cacheOnlyMode: true,
      offline: true
    });
    expect(ports.surface.close).toHaveBeenCalled();
    expect(ports.unsupportedDownload.reportCacheOnlyBlocked).toHaveBeenCalled();
    expect(ports.unsupportedDownload.download).not.toHaveBeenCalled();
  });

  it("does not pause folder audio before an unsupported download route is classified", async () => {
    const ports = createPorts();
    await openPreviewFile({
      entry: entry("Archive/archive.zip", "application/zip"),
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);
    expect(ports.folderAudio.pause).not.toHaveBeenCalled();
    expect(ports.unsupportedDownload.download).toHaveBeenCalledWith("Archive/archive.zip", "/Archive/archive.zip");
  });

  it("routes prefer-folder-audio opens through folder audio instead of preview", async () => {
    const ports = createPorts({
      surface: {
        ...createPorts().surface,
        isOpen: vi.fn(() => true)
      }
    });
    await openPreviewFile({
      entry: entry("Archive/song.mp3", "audio/mpeg"),
      options: { preferFolderAudioPlayer: true },
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);
    expect(ports.surface.close).toHaveBeenCalled();
    expect(ports.folderAudio.activate).toHaveBeenCalled();
    expect(ports.surface.clearSelection).toHaveBeenCalled();
    expect(ports.navigation.closeMobileDetails).toHaveBeenCalled();
    expect(ports.session.open).not.toHaveBeenCalled();
  });

  it("reuses preview surface for adjacent gallery opens", async () => {
    const ports = createPorts();
    await openPreviewFile({
      entry: entry("Archive/b.png", "image/png"),
      options: { reusePreviewSurface: true },
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: [
        entry("Archive/a.png", "image/png"),
        entry("Archive/b.png", "image/png")
      ]
    }, ports);
    expect(ports.navigation.pushPreviewSurface).not.toHaveBeenCalled();
    expect(ports.session.open).toHaveBeenCalled();
  });

  it("does not prefetch adjacent videos", async () => {
    const ports = createPorts();
    await prefetchUpcomingPreviewMedia({
      startIndex: 0,
      mediaItems: [
        entry("Archive/photo.png", "image/png"),
        entry("Archive/clip.mp4", "video/mp4")
      ],
      accountId: "alpha",
      cacheNamespace: "ns",
      contextGeneration: "1",
      cacheOnlyMode: false,
      hasToken: true,
      hasActiveAccount: true,
      cacheNamespacePresent: true,
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024
    }, ports, { accept: () => true });
    expect(ports.prefetch.runtime.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches the configured next three images from cache-only storage in nearest-first order", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const prefetch = vi.fn(async (request: { readonly path: string }) => {
      if (request.path === "Archive/b.heic") await firstPending;
      return { kind: "persisted" as const };
    });
    const ports = createPorts({
      prefetch: {
        ...createPorts().prefetch,
        runtime: { probe: vi.fn(async () => false), prefetch }
      }
    });

    const running = prefetchUpcomingPreviewMedia({
      startIndex: 0,
      mediaItems: ["a", "b", "c", "d", "e"].map((name) => entry(`Archive/${name}.heic`, "image/heic")),
      accountId: "alpha",
      cacheNamespace: "ns",
      contextGeneration: "1",
      cacheOnlyMode: true,
      hasToken: false,
      hasActiveAccount: true,
      cacheNamespacePresent: true,
      heicPreviewEnabled: true,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      prefetchAheadCount: 3
    }, ports, { accept: () => true });

    await vi.waitFor(() => expect(prefetch).toHaveBeenCalledTimes(1));
    expect(prefetch.mock.calls[0]?.[0]).toMatchObject({ path: "Archive/b.heic", connectionMode: "cache-only" });
    releaseFirst?.();
    await running;

    expect(prefetch.mock.calls.map(([request]) => request.path)).toEqual([
      "Archive/b.heic",
      "Archive/c.heic",
      "Archive/d.heic"
    ]);
  });
});
