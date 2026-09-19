// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { FileEntry, FilePreview } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserPreviewAbortPort,
  BrowserPreviewLiveAdapter,
  BrowserPreviewMaterialStore,
  type PreviewTransport
} from "../../../platform/preview/browserPreviewAdapters";
import { createBrowserPreviewModalRuntime } from "../../../platform/preview/browserPreviewModalRuntime";
import {
  downloadUnsupportedPreviewFile,
  openPreviewFile,
  prefetchUpcomingPreviewMedia
} from "../open/controller";
import {
  buildMediaGalleryItems,
  buildPreviewNavigationItems,
  resolveAdjacentMediaItem,
  shouldSkipPrefetchForCurrentItem
} from "../open/model";
import type { PreviewOpenPorts } from "../open/ports";
import {
  PreviewSessionController,
  createPreviewRequestKey,
  createPreviewSnapshot,
  type PreviewAcquisition,
  type PreviewCacheEntry,
  type PreviewCacheEvent,
  type PreviewCacheSnapshot,
  type PreviewMaterial,
  type PreviewRequestKey,
  type PreviewResource,
  type PreviewSessionPorts,
  type PreviewSessionCompositionFactories,
  type PreviewSessionRuntimeCallbacks,
  type PreviewSessionState
} from "../session";
import type { UsePreviewOpenInput } from "../open/usePreviewOpen";
import { usePreviewOpen } from "../open/usePreviewOpen";
import { usePreviewSession } from "../session/usePreviewSession";
import * as previewOpenModule from "../open";
import * as previewSessionModule from "../session";
import * as folderAudioModule from "../folderAudio";
import { usePreviewWorkspace, type PreviewWorkspaceInput } from "./usePreviewWorkspace";


function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function entry(path: string, mimeType = "image/png"): FileEntry {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    isFolder: false,
    size: 8,
    mimeType
  };
}

function filePreview(path: string, viewer: FilePreview["viewer"] = "text"): FilePreview {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    isFolder: false,
    mimeType: viewer === "text" ? "text/plain" : `application/${viewer}`,
    size: 8,
    viewer,
    content: viewer === "text" ? "content" : "",
    encoding: viewer === "text" ? "utf8" : "none",
    truncated: false,
    bytesRead: 8,
    requiresOriginalBlob: viewer !== "text"
  };
}

function acquisition(
  path: string,
  fingerprint: string,
  sourceKind: "inline" | "blob" | "stream" = "inline"
): PreviewAcquisition {
  return {
    snapshot: createPreviewSnapshot({
      preview: filePreview(path),
      fingerprint,
      source: sourceKind
    }),
    ...(sourceKind === "inline" ? {} : { material: { id: `material-${fingerprint}`, kind: sourceKind } })
  };
}

function request(path = "Docs/report.txt") {
  return {
    accountId: "alpha",
    cacheNamespace: "cache-alpha",
    path,
    contextGeneration: "generation-alpha",
    connectionMode: "online" as const,
    heicPreviewEnabled: false,
    freshnessIntervalMs: 60_000,
    cacheLimitBytes: 1024,
    target: "previewable" as const
  };
}

function createSessionPorts(overrides: Partial<PreviewSessionPorts> = {}) {
  const published: PreviewSessionState[] = [];
  const cacheSnapshots: PreviewCacheSnapshot[] = [];
  const cacheEvents: PreviewCacheEvent[] = [];
  const releases: string[] = [];
  const aborts: string[] = [];
  let abortSequence = 0;
  const ports: PreviewSessionPorts = {
    cache: {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 1, totalBytes: 8, limitBytes: 1024 } }))
    },
    live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "live", "blob")) },
    abort: {
      create: vi.fn(() => {
        const id = `abort-${++abortSequence}`;
        return { id, abort: () => aborts.push(id) };
      })
    },
    resources: {
      apply: vi.fn((material: PreviewMaterial): PreviewResource => ({ id: `resource-${material.id}`, kind: material.kind })),
      release: vi.fn((resource: PreviewResource) => releases.push(resource.id))
    },
    current: { isCurrent: () => true },
    failures: { classify: (error) => ({ kind: "ordinary", message: error instanceof Error ? error.message : "failed" }) },
    failurePublication: { publishFailure: () => true },
    publication: { publish: (state) => { published.push(state); return true; } },
    cachePublication: {
      publishSnapshot: (_key, snapshot) => { cacheSnapshots.push(snapshot); return true; },
      publishEvent: (event) => { cacheEvents.push(event); return true; }
    },
    clock: { now: () => 60_001 },
    ...overrides
  };
  return { ports, published, cacheSnapshots, cacheEvents, releases, aborts };
}

function createOpenPorts(events: string[] = []): PreviewOpenPorts {
  const mark = (event: string, callback?: () => void) => () => {
    events.push(event);
    callback?.();
  };
  const ports = {
    session: {
      open: vi.fn(async () => ({ kind: "opened" as const, key: createPreviewRequestKey({ ...request(), requestSequence: 1 }) })),
      applyRefresh: vi.fn(async () => ({ kind: "not-ready" as const })),
      clearOwner: mark("clear-owner")
    },
    navigation: {
      pushPreviewSurface: mark("push-history"),
      closeMobileDetails: mark("close-mobile-details")
    },
    folderAudio: {
      pause: mark("pause-folder-audio"),
      activate: vi.fn((item: FileEntry) => events.push(`activate-folder-audio:${item.path}`))
    },
    surface: {
      close: mark("close-surface"),
      isOpen: vi.fn(() => false),
      setOpenedEntry: vi.fn((item: FileEntry) => events.push(`entry:${item.path}`)),
      setOpenedEntryPath: vi.fn((path: string) => events.push(`path:${path}`)),
      clearSelection: mark("clear-selection"),
      setPreviewError: vi.fn((error?: Error) => events.push(`preview-error:${error?.message ?? "none"}`)),
      setStatus: vi.fn((message: string) => events.push(`status:${message}`)),
      reportListError: vi.fn(),
      markWorkerAvailable: mark("worker-available")
    },
    unsupportedDownload: {
      isCurrentHandler: vi.fn(() => true),
      canDownloadFocused: vi.fn(() => true),
      download: vi.fn(async (path: string) => { events.push(`download:${path}`); }),
      reportCacheOnlyBlocked: vi.fn((path: string) => events.push(`cache-only-blocked:${path}`)),
      reportStarting: vi.fn((path: string) => events.push(`download-starting:${path}`)),
      prepareForDownload: mark("prepare-download")
    },
    explicitOffline: {
      readCachedBlob: vi.fn(async () => undefined),
      triggerLocalOpen: vi.fn((blob: Blob, filename: string) => events.push(`local-open:${filename}:${blob.size}`)),
      isRetentionCurrent: vi.fn(() => true),
      reportLocalOpen: vi.fn(mark("local-open-reported")),
      reportUnreadable: vi.fn(mark("local-open-unreadable"))
    },
    prefetch: {
      runtime: {
        probe: vi.fn(async () => false),
        prefetch: vi.fn(async () => ({ kind: "cached" as const }))
      },
      context: {
        getContextGeneration: vi.fn(() => "generation-alpha"),
        getAccountId: vi.fn(() => "alpha"),
        getCacheNamespace: vi.fn(() => "cache-alpha"),
        isStillCurrent: vi.fn(() => true),
        nextPrefetchSequence: vi.fn(() => 2),
        trackPrefetchAbort: vi.fn(),
        untrackPrefetchAbort: vi.fn(),
        createAbort: vi.fn(() => ({ id: "prefetch-abort", abort: vi.fn() }))
      },
      acceptPolicy: { accept: () => true },
      refreshCacheSummary: vi.fn(async () => undefined)
    },
    refresh: { applyPending: vi.fn(async () => undefined) }
  } satisfies PreviewOpenPorts;
  return ports;
}

function createOpenInput(overrides: Partial<UsePreviewOpenInput> = {}): UsePreviewOpenInput {
  return {
    visibleItems: [entry("Docs/a.png"), entry("Docs/b.pdf", "application/pdf"), entry("Docs/c.mp4", "video/mp4")],
    openedEntry: undefined,
    experimentalHeicPreviewEnabled: false,
    previewFreshnessIntervalSeconds: 60,
    maxCacheableFileSizeBytes: 1024,
    token: "token-alpha",
    cacheOnlyMode: false,
    cacheNamespace: "cache-alpha",
    activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" },
    explicitOfflineMode: false,
    offline: false,
    previewContextGeneration: () => "generation-alpha",
    ports: createOpenPorts(),
    onInvalidatePrefetch: vi.fn(),
    ...overrides
  };
}

type WorkspaceRetention = PreviewWorkspaceInput["ports"]["application"]["retention"];
type MutableWorkspaceRetention = { -readonly [Key in keyof WorkspaceRetention]: WorkspaceRetention[Key] };
type WorkspacePortsFixture = PreviewWorkspaceInput["ports"] & {
  readonly testSurface: PreviewOpenPorts["surface"];
  testRetention: MutableWorkspaceRetention;
};

function workspacePortsForComposition(composition: PreviewSessionCompositionFactories, callbacks: Omit<PreviewSessionRuntimeCallbacks, "onOpenedEntryClear">): WorkspacePortsFixture {
  const openPorts = createOpenPorts();
  const testRetention = {
    readPreview: async () => undefined,
    isCurrent: (account: { accountId: string; cacheNamespace: string }) => openPorts.explicitOffline.isRetentionCurrent(account.accountId, account.cacheNamespace),
    refreshSummary: vi.fn(async () => undefined),
    publishSummary: callbacks.onPublishCacheSummary
  } satisfies MutableWorkspaceRetention;
  const application = {
      runtime: {
        session: composition,
        modal: createBrowserPreviewModalRuntime(),
        folderAudio: {
          storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
          createStreamingFileUrl: async () => "",
          nowIso: () => new Date(0).toISOString(),
          loadAudioPreviewPosition: () => undefined,
          saveAudioPreviewPosition: () => undefined
        }
      },
      session: {
        reset: callbacks.onResetSession,
        markWorkerUnavailable: callbacks.onMarkWorkerUnavailable,
        publishCacheSummary: callbacks.onPublishCacheSummary,
        streamCacheReady: callbacks.onStreamCacheReady,
        streamCacheFailed: callbacks.onStreamCacheFailed
      },
      navigation: {
        pushPreviewSurface: openPorts.navigation.pushPreviewSurface,
        closeNavigation: openPorts.surface.close,
        closeMobileDetails: openPorts.navigation.closeMobileDetails,
        closePreview: openPorts.surface.close
      },
      operation: {
        isCurrent: openPorts.unsupportedDownload.isCurrentHandler,
        canDownload: openPorts.unsupportedDownload.canDownloadFocused,
        download: async (path: string, label: string) => openPorts.unsupportedDownload.download(path, label),
        saveLocal: (blob: Blob, filename: string) => openPorts.explicitOffline.triggerLocalOpen(blob, filename)
      },
      retention: testRetention,
      presentation: {
        announce: openPorts.surface.setStatus,
        reportListError: (error?: Error) => openPorts.surface.reportListError(error),
        clearListError: () => openPorts.surface.reportListError(undefined),
        markWorkerAvailable: openPorts.surface.markWorkerAvailable,
        onImageFitModeChange: vi.fn(),
        toDisplayPath: (path: string) => path
      }
    } satisfies PreviewWorkspaceInput["ports"]["application"];
  return { application, testSurface: openPorts.surface, testRetention };
}

function cacheEntry(value: PreviewAcquisition, cachedAtMs: number): PreviewCacheEntry {
  return { acquisition: value, cachedAtMs, cachedAt: "2026-08-04T00:00:00.000Z" };
}

describe("Phase 4F preview application-composition characterization", () => {
  it("captures every current identity input independently and preserves Alpha-Beta-Alpha request identity", async () => {
    const ports = createOpenPorts();
    const initial = createOpenInput({ ports });
    const { result, rerender } = renderHook((input: UsePreviewOpenInput) => usePreviewOpen(input), { initialProps: initial });

    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    expect(ports.session.open).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: "alpha",
      cacheNamespace: "cache-alpha",
      path: "Docs/a.png",
      contextGeneration: "generation-alpha",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024
    }));

    const beta = createOpenInput({
      ports,
      visibleItems: [entry("Beta/b.png")],
      activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta" },
      token: "token-beta",
      cacheNamespace: "cache-beta",
      cacheOnlyMode: true,
      explicitOfflineMode: true,
      offline: true,
      experimentalHeicPreviewEnabled: true,
      previewFreshnessIntervalSeconds: 17,
      maxCacheableFileSizeBytes: 2048,
      previewContextGeneration: () => "generation-beta"
    });
    rerender(beta);
    await act(async () => { await result.current.openFile(entry("Beta/b.png")); });
    expect(ports.session.open).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: "beta",
      cacheNamespace: "cache-beta",
      path: "Beta/b.png",
      contextGeneration: "generation-beta",
      connectionMode: "cache-only",
      heicPreviewEnabled: true,
      freshnessIntervalMs: 17_000,
      cacheLimitBytes: 2048
    }));

    rerender(createOpenInput({ ports, openedEntry: entry("Docs/a.png"), previewContextGeneration: () => "generation-alpha-again" }));
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    expect(ports.session.open).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: "alpha",
      cacheNamespace: "cache-alpha",
      path: "Docs/a.png",
      contextGeneration: "generation-alpha-again",
      connectionMode: "online"
    }));
    expect(ports.session.open).toHaveBeenCalledTimes(3);
  });

  it("forwards one changed composition identity at a time", async () => {
    const cases: readonly {
      readonly name: string;
      readonly mutate: (input: UsePreviewOpenInput) => UsePreviewOpenInput;
      readonly expected: Record<string, unknown>;
    }[] = [
      { name: "account ID", mutate: (input) => ({ ...input, activeAccount: { ...input.activeAccount!, id: "beta" } }), expected: { accountId: "beta" } },
      { name: "cache namespace", mutate: (input) => ({ ...input, activeAccount: { ...input.activeAccount!, cacheNamespace: "cache-beta" } }), expected: { cacheNamespace: "cache-beta" } },
      { name: "token", mutate: (input) => ({ ...input, token: undefined }), expected: { hasToken: false } },
      { name: "current path", mutate: (input) => ({ ...input, visibleItems: [entry("Archive/a.png")] }), expected: {} },
      { name: "opened path", mutate: (input) => ({ ...input, openedEntry: entry("Docs/opened.png") }), expected: { path: "Docs/target.png" } },
      { name: "cache-only", mutate: (input) => ({ ...input, cacheOnlyMode: true }), expected: { connectionMode: "cache-only" } },
      { name: "explicit offline", mutate: (input) => ({ ...input, explicitOfflineMode: true }), expected: {} },
      { name: "browser offline", mutate: (input) => ({ ...input, offline: true }), expected: {} },
      { name: "HEIC", mutate: (input) => ({ ...input, experimentalHeicPreviewEnabled: true }), expected: { heicPreviewEnabled: true } },
      { name: "freshness", mutate: (input) => ({ ...input, previewFreshnessIntervalSeconds: 17 }), expected: { freshnessIntervalMs: 17_000 } },
      { name: "cache limit", mutate: (input) => ({ ...input, maxCacheableFileSizeBytes: 2048 }), expected: { cacheLimitBytes: 2048 } },
      { name: "context generation", mutate: (input) => ({ ...input, previewContextGeneration: () => "generation-beta" }), expected: { contextGeneration: "generation-beta" } }
    ];

    for (const testCase of cases) {
      const ports = createOpenPorts();
      const baseline = createOpenInput({ ports });
      const { result, rerender } = renderHook((input: UsePreviewOpenInput) => usePreviewOpen(input), { initialProps: baseline });
      const changed = testCase.mutate({ ...baseline, ports });
      rerender(changed);
      const target = entry(testCase.name === "opened path" ? "Docs/target.png" : "Docs/a.png");
      await act(async () => { await result.current.openFile(target); });
      if (testCase.name === "token") {
        expect(ports.session.open, testCase.name).not.toHaveBeenCalled();
        continue;
      }
      const requestInput = vi.mocked(ports.session.open).mock.lastCall?.[0];
      if (!requestInput) throw new Error(`No request captured for ${testCase.name}`);
      expect(requestInput, testCase.name).toEqual(expect.objectContaining(testCase.expected));
    }
  });

  it("keeps a deferred Alpha completion inert across Alpha-Beta-Alpha application context changes", async () => {
    let resolveAlpha!: (value: PreviewAcquisition) => void;
    const acquisitionPromise = new Promise<PreviewAcquisition>((resolve) => { resolveAlpha = resolve; });
    const callbackPorts = {
      onResetSession: vi.fn(),
      onMarkWorkerUnavailable: vi.fn(),
      onPublishCacheSummary: vi.fn(),
      onStreamCacheReady: vi.fn(),
      onStreamCacheFailed: vi.fn(),
      onOpenedEntryClear: vi.fn()
    };
    const prefetchCalls = { started: 0, completed: 0 };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => acquisitionPromise) },
        abort: { create: vi.fn(() => ({ id: "application-abort", abort: vi.fn() })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "stale" }) },
        prefetch: {
          probe: vi.fn(async () => false),
          prefetch: vi.fn(async () => { prefetchCalls.started += 1; prefetchCalls.completed += 1; return { kind: "cached" as const }; })
        },
        clock: { now: () => 60_001 },
        resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const first = {
      context: {
        activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" },
        accountName: "Alpha",
        token: "token-alpha",
        cacheNamespace: "cache-alpha",
        cacheOnlyMode: false,
        currentPath: "Docs",
        visibleItems: [entry("Docs/a.png"), entry("Docs/b.png")],
        explicitOfflineMode: false,
        offline: false
      },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 },
      ports: workspacePortsForComposition(composition, callbackPorts)
    } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: first });
    let opening!: Promise<void>;
    await act(async () => {
      opening = result.current.openFile(entry("Docs/a.png"));
      await Promise.resolve();
    });
    rerender({ ...first, context: { ...first.context, activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta" }, accountName: "Beta", token: "token-beta", cacheNamespace: "cache-beta" } });
    rerender({ ...first, context: { ...first.context } });
    resolveAlpha(acquisition("Docs/a.png", "stale-alpha", "blob"));
    await act(async () => { await opening; });

    expect(result.current.modal.selected).toBeUndefined();
    expect(result.current.modal.selectedBlobUrl).toBeUndefined();
    expect(result.current.modal.previewError).toBeUndefined();
    expect(result.current.modal.loadingPreview).toBe(false);
    expect(result.current.modal.previewCacheState).toEqual({ source: "none", refreshing: false, stale: false, updateReady: false });
    expect(result.current.modal.pendingPreviewUpdate).toBeUndefined();
    expect(callbackPorts.onPublishCacheSummary).not.toHaveBeenCalled();
    expect(callbackPorts.onStreamCacheReady).not.toHaveBeenCalled();
    expect(callbackPorts.onStreamCacheFailed).not.toHaveBeenCalled();
    expect(prefetchCalls.started).toBe(0);
  });

  it("keeps a stale Alpha failure inert after a workspace account replacement", async () => {
    let rejectAlpha!: (error: Error) => void;
    const failurePromise = new Promise<PreviewAcquisition>((_resolve, reject) => { rejectAlpha = reject; });
    const callbacks = {
      onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(),
      onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn(), onOpenedEntryClear: vi.fn()
    };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => failurePromise) },
        abort: { create: vi.fn(() => ({ id: "failure-abort", abort: vi.fn() })) },
        resources: { apply: vi.fn(), release: vi.fn() },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "stale ordinary failure" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) },
        clock: { now: () => 60_001 }, resolveResourceUrl: () => undefined
      })
    };
    const baseContext = {
      activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha",
      cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false
    };
    const input = { context: baseContext, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((next: PreviewWorkspaceInput) => usePreviewWorkspace(next), { initialProps: input });
    let opening!: Promise<void>;
    await act(async () => { opening = result.current.openFile(entry("Docs/a.png")); await Promise.resolve(); });
    rerender({ ...input, context: { ...baseContext, activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta" }, accountName: "Beta", token: "token-beta", cacheNamespace: "cache-beta" } });
    rejectAlpha(new Error("late failure"));
    await act(async () => { await opening; });
    expect(result.current.modal.previewError).toBeUndefined();
    expect(callbacks.onResetSession).not.toHaveBeenCalled();
    expect(callbacks.onMarkWorkerUnavailable).not.toHaveBeenCalled();
  });

  it.each([
    ["account ID", (context: PreviewWorkspaceInput["context"]) => ({ ...context, activeAccount: { ...context.activeAccount!, id: "beta" } })],
    ["cache namespace", (context: PreviewWorkspaceInput["context"]) => ({ ...context, cacheNamespace: "cache-beta" })],
    ["token", (context: PreviewWorkspaceInput["context"]) => ({ ...context, token: "token-beta" })],
    ["cache-only", (context: PreviewWorkspaceInput["context"]) => ({ ...context, cacheOnlyMode: true })]
  ] as const)("invalidates one workspace session identity: %s", async (_name, mutate) => {
    let resolveLate!: (value: PreviewAcquisition) => void;
    const late = new Promise<PreviewAcquisition>((resolve) => { resolveLate = resolve; });
    const abort = vi.fn();
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn(), onOpenedEntryClear: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => late) }, abort: { create: vi.fn(() => ({ id: "identity-abort", abort })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "late" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) },
        clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const base: PreviewWorkspaceInput = {
      context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 },
      ports: workspacePortsForComposition(composition, callbacks)
    };
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    let opening!: Promise<void>;
    await act(async () => { opening = result.current.openFile(entry("Docs/a.png")); await Promise.resolve(); });
    rerender({ ...base, context: mutate(base.context) });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(result.current.modal.selected).toBeUndefined();
    expect(result.current.modal.previewError).toBeUndefined();
    resolveLate(acquisition("Docs/a.png", "late", "blob"));
    await act(async () => { await opening; });
    expect(result.current.modal.selected).toBeUndefined();
    expect(result.current.modal.pendingPreviewUpdate).toBeUndefined();
    expect(callbacks.onPublishCacheSummary).not.toHaveBeenCalled();
    expect(callbacks.onStreamCacheReady).not.toHaveBeenCalled();
  });

  it.each(["clearForPathTransition", "clearAccountContext", "dismiss"] as const)("aborts and idempotently clears late work through bridge.%s", async (command) => {
    let resolveLate!: (value: PreviewAcquisition) => void;
    const late = new Promise<PreviewAcquisition>((resolve) => { resolveLate = resolve; });
    const abort = vi.fn();
    const release = vi.fn();
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn(), onOpenedEntryClear: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => late) }, abort: { create: vi.fn(() => ({ id: "bridge-abort", abort })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "late" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) },
        clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const input = {
      context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 },
      ports: workspacePortsForComposition(composition, callbacks)
    } satisfies PreviewWorkspaceInput;
    const { result } = renderHook(() => usePreviewWorkspace(input));
    let opening!: Promise<void>;
    await act(async () => { opening = result.current.openFile(entry("Docs/a.png")); await Promise.resolve(); });
    act(() => result.current.bridge[command]());
    act(() => result.current.bridge[command]());
    expect(abort).toHaveBeenCalledTimes(1);
    resolveLate(acquisition("Docs/a.png", "late", "blob"));
    await act(async () => { await opening; });
    expect(result.current.modal.selected).toBeUndefined();
    expect(result.current.modal.previewError).toBeUndefined();
    expect(result.current.modal.pendingPreviewUpdate).toBeUndefined();
    expect(release).not.toHaveBeenCalled();
  });

  it.each(["clearForPathTransition", "clearAccountContext", "dismiss"] as const)("releases published material once through bridge.%s", async (command) => {
    const release = vi.fn();
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) }, live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "published", "blob")) }, abort: { create: vi.fn(() => ({ id: "published-abort", abort: vi.fn() })) }, resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release }, failures: { classify: () => ({ kind: "ordinary" as const, message: "published" }) }, prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const input = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const clearSelection = vi.spyOn(input.ports.testSurface, "clearSelection");
    const { result } = renderHook(() => usePreviewWorkspace(input));
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    act(() => result.current.bridge[command]());
    act(() => result.current.bridge[command]());
    expect(release).toHaveBeenCalledTimes(1);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(result.current.modal.entry).toBeUndefined();
  });

  it.each(["clearForPathTransition", "clearAccountContext", "dismiss"] as const)("clears workspace identity exactly once through bridge.%s callback seam", async (command) => {
    const clearOpenedEntryPath = vi.fn();
    const sessionClose = vi.fn();
    let onOpenedEntryClear!: () => void;
    const sessionSpy = vi.spyOn(previewSessionModule, "usePreviewSession").mockImplementation((input) => {
      onOpenedEntryClear = input.callbacks.onOpenedEntryClear;
      sessionClose.mockImplementation(() => onOpenedEntryClear());
      const sessionChild = {
        controller: new PreviewSessionController(createSessionPorts().ports),
        sessionState: { kind: "closed" as const },
        previewOpen: false,
        selected: undefined,
        setSelected: vi.fn(),
        previewResource: undefined,
        selectedBlobUrl: undefined,
        previewOpenRef: { current: false },
        previewError: undefined,
        setPreviewError: vi.fn(),
        loadingPreview: false,
        setPreviewOpen: vi.fn(),
        setLoadingPreview: vi.fn(),
        previewCacheState: { source: "none", refreshing: false, stale: false, updateReady: false },
        setPendingPreviewUpdate: vi.fn(),
        setPreviewCacheState: vi.fn(),
        pendingPreviewUpdate: undefined,
        close: sessionClose,
        open: vi.fn(),
        applyRefresh: vi.fn(),
        invalidatePrefetch: vi.fn(),
        clearOwner: vi.fn(),
        abortPort: createSessionPorts().ports.abort,
        prefetchPort: {
          probe: vi.fn(async () => false),
          prefetch: vi.fn(async () => ({ kind: "cached" as const }))
        },
        contextGenerationRef: { current: 0 },
        openedEntryPathRef: { current: undefined },
        setOpenedEntryPath: vi.fn(),
        clearOpenedEntryPath,
        prefetchContext: {
          getContextGeneration: () => "0",
          getAccountId: () => "alpha",
          getCacheNamespace: () => "cache-alpha",
          isStillCurrent: () => true,
          nextPrefetchSequence: () => 1,
          trackPrefetchAbort: () => undefined,
          untrackPrefetchAbort: () => undefined,
          createAbort: () => ({ id: "mock", abort: vi.fn() })
        }
      } satisfies ReturnType<typeof usePreviewSession>;
      return sessionChild;
    });
    const openSpy = vi.spyOn(previewOpenModule, "usePreviewOpen").mockImplementation((input) => ({
      mediaItems: [],
      previewNavigationItems: [],
      openedMediaIndex: -1,
      openFile: vi.fn(async (opened: FileEntry) => {
        input.ports.surface.setOpenedEntryPath(opened.path);
        input.ports.surface.setOpenedEntry(opened);
      }),
      openAdjacentMedia: vi.fn(),
      applyPendingRefresh: vi.fn(async () => undefined),
      previousMediaItem: undefined,
      nextMediaItem: undefined
    } satisfies ReturnType<typeof usePreviewOpen>));
    const interaction = {
      playing: false,
      pause: vi.fn(),
      activate: vi.fn(),
      stage: undefined
    } satisfies ReturnType<typeof folderAudioModule.useFolderAudioMount>["interaction"];
    const previewOpenSources = {
      pause: vi.fn(),
      activate: vi.fn()
    } satisfies ReturnType<typeof folderAudioModule.useFolderAudioMount>["previewOpenSources"];
    const folderSpy = vi.spyOn(folderAudioModule, "useFolderAudioMount").mockImplementation(() => ({
      playing: false,
      interaction,
      hasPlayer: false,
      previewOpenSources,
      pauseForExclusivePlayback: vi.fn(),
      bindPreviewMediaPlaybackChange: vi.fn(() => vi.fn())
    } satisfies ReturnType<typeof folderAudioModule.useFolderAudioMount>));
    try {
      const input = {
        context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false },
        settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 },
        ports: { ...workspacePortsForComposition({ createSessionAdapters: () => { throw new Error("unused"); } }, { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() }) }
      } satisfies PreviewWorkspaceInput;
      const clearSelection = vi.spyOn(input.ports.testSurface, "clearSelection");
      const { result } = renderHook(() => usePreviewWorkspace(input));
      await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
      expect(result.current.modal.entry?.path).toBe("Docs/a.png");
      act(() => result.current.bridge[command]());
      act(() => result.current.bridge[command]());
      expect(sessionClose).toHaveBeenCalledTimes(1);
      expect(clearOpenedEntryPath).toHaveBeenCalledTimes(1);
      expect(result.current.modal.entry).toBeUndefined();
      expect(clearSelection).not.toHaveBeenCalled();
      expect(source("./usePreviewWorkspace.ts")).toContain("onOpenedEntryClear: () => clearIdentityRef.current()");
    } finally {
      sessionSpy.mockRestore();
      openSpy.mockRestore();
      folderSpy.mockRestore();
    }
  });
  it("publishes the closed-session callback exactly once for bridge-owned session dismissal", async () => {
    const onOpenedEntryClear = vi.fn();
    const callbacks = {
      onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(),
      onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn(), onOpenedEntryClear
    };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "callback", "blob")) },
        abort: { create: vi.fn(() => ({ id: "callback-abort", abort: vi.fn() })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "callback" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) },
        clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    } satisfies PreviewSessionCompositionFactories;
    const { result } = renderHook(() => usePreviewSession({
      accountId: "alpha", cacheNamespace: "cache-alpha", accountName: "Alpha", token: "token-alpha", cacheOnlyMode: false,
      openedEntryPath: "Docs/a.png", composition, callbacks
    }));
    onOpenedEntryClear.mockClear();
    await act(async () => { await result.current.open({ ...request("Docs/a.png"), contextGeneration: "1" }); await Promise.resolve(); });
    expect(result.current.previewOpen).toBe(true);
    act(() => result.current.close());
    expect(onOpenedEntryClear).toHaveBeenCalledTimes(1);
    act(() => result.current.close());
    expect(onOpenedEntryClear).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["account", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, activeAccount: { ...input.context.activeAccount!, id: "beta" } } }), { accountId: "beta", cacheNamespace: "cache-alpha" }],
    ["cache namespace", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, cacheNamespace: "cache-beta", activeAccount: { ...input.context.activeAccount!, cacheNamespace: "cache-beta" } } }), { cacheNamespace: "cache-beta" }],
    ["token", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, token: "token-beta" } }), {}],
    ["current path", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, currentPath: "Archive" } }), { path: "Docs/a.png" }],
    ["visible items", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, visibleItems: [entry("Docs/a.png"), entry("Docs/b.png")] } }), { path: "Docs/a.png" }],
    ["HEIC", (input: PreviewWorkspaceInput) => ({ ...input, settings: { ...input.settings, experimentalHeicPreviewEnabled: true } }), { heicPreviewEnabled: true }],
    ["freshness", (input: PreviewWorkspaceInput) => ({ ...input, settings: { ...input.settings, previewFreshnessIntervalSeconds: 17 } }), { freshnessIntervalMs: 17_000 }],
    ["cache limit", (input: PreviewWorkspaceInput) => ({ ...input, settings: { ...input.settings, maxCacheableFileSizeBytes: 2048 } }), { cacheLimitBytes: 2048 }],
    ["offline", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, offline: true } }), { path: "Docs/a.png" }],
    ["explicit offline", (input: PreviewWorkspaceInput) => ({ ...input, context: { ...input.context, explicitOfflineMode: true } }), { path: "Docs/a.png" }]
  ] as const)("shapes the next workspace.openFile request for %s", async (_name, mutate, expected) => {
    let capturedKey: PreviewRequestKey | undefined;
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async (key: PreviewRequestKey) => { capturedKey = key; return acquisition(key.path, "next", "blob"); }) }, abort: { create: vi.fn(() => ({ id: "shape-abort", abort: vi.fn() })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() }, failures: { classify: () => ({ kind: "ordinary" as const, message: "shape" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: () => "blob:next"
      })
    };
    const base = {
      context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() })
    } satisfies PreviewWorkspaceInput;
    const { result } = renderHook(() => usePreviewWorkspace(mutate(base)));
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    expect(capturedKey).toEqual({
      requestSequence: 1,
      accountId: "alpha",
      cacheNamespace: "cache-alpha",
      path: "Docs/a.png",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      ...expected
    });
  });

  it("keeps token admission and media-gallery transitions tied to the rerendered workspace identity", async () => {
    const liveKeys: PreviewRequestKey[] = [];
    const admittedTokens: Array<string | undefined> = [];
    const prefetchKeys: PreviewRequestKey[] = [];
    let tokenFor!: (key: PreviewRequestKey) => string | undefined;
    const composition = {
      createSessionAdapters: ({ tokenFor: suppliedTokenFor }: { readonly tokenFor: (key: PreviewRequestKey) => string | undefined }) => {
        tokenFor = suppliedTokenFor;
        return {
          cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
          live: {
            acquire: vi.fn(async (key: PreviewRequestKey) => {
              liveKeys.push(key);
              admittedTokens.push(tokenFor(key));
              return acquisition(key.path, `live-${key.path}`, "blob");
            })
          },
          abort: { create: vi.fn(() => ({ id: "gallery-abort", abort: vi.fn() })) },
          resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() },
          failures: { classify: () => ({ kind: "ordinary" as const, message: "gallery" }) },
          prefetch: {
            probe: vi.fn(async () => false),
            prefetch: vi.fn(async (key: PreviewRequestKey) => { prefetchKeys.push(key); return { kind: "cached" as const }; })
          },
          clock: { now: () => 60_001 },
          resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
        };
      }
    };
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const base = {
      context: {
        activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha",
        cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs",
        visibleItems: [entry("Docs/a.png"), entry("Docs/b.png")], explicitOfflineMode: false, offline: false
      },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 },
      ports: workspacePortsForComposition(composition, callbacks)
    } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });

    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    await act(async () => { await Promise.resolve(); });
    expect(liveKeys[0]).toMatchObject({ accountId: "alpha", cacheNamespace: "cache-alpha", path: "Docs/a.png", connectionMode: "online" });
    expect(admittedTokens[0]).toBe("token-alpha");
    expect(result.current.nextMediaItem?.path).toBe("Docs/b.png");
    expect(prefetchKeys.at(-1)).toMatchObject({ accountId: "alpha", cacheNamespace: "cache-alpha", path: "Docs/b.png" });

    const beta = {
      ...base,
      context: {
        ...base.context,
        activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta" }, accountName: "Beta", token: "token-beta",
        cacheNamespace: "cache-beta", currentPath: "Archive", visibleItems: [entry("Archive/b.png"), entry("Archive/c.png")]
      }
    } satisfies PreviewWorkspaceInput;
    rerender(beta);
    expect(result.current.modal.entry).toBeUndefined();
    await act(async () => { await result.current.openFile(entry("Archive/b.png")); });
    await act(async () => { await Promise.resolve(); });
    expect(liveKeys.at(-1)).toMatchObject({ accountId: "beta", cacheNamespace: "cache-beta", path: "Archive/b.png", connectionMode: "online" });
    expect(admittedTokens.at(-1)).toBe("token-beta");
    expect(result.current.nextMediaItem?.path).toBe("Archive/c.png");
    expect(prefetchKeys.at(-1)).toMatchObject({ accountId: "beta", cacheNamespace: "cache-beta", path: "Archive/c.png" });
    await act(async () => { result.current.openAdjacentMedia(1); await Promise.resolve(); });
    expect(liveKeys.at(-1)?.path).toBe("Archive/c.png");
    expect(admittedTokens.at(-1)).toBe("token-beta");
  });

  it("does not publish a prefetch completion after token invalidation", async () => {
    let resolvePrefetch!: (value: { readonly kind: "persisted" }) => void;
    const prefetchCompletion = new Promise<{ readonly kind: "persisted" }>((resolve) => { resolvePrefetch = resolve; });
    const refreshCacheSummary = vi.fn(async () => undefined);
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "live", "inline")) }, abort: { create: vi.fn(() => ({ id: "prefetch-stale", abort: vi.fn() })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() }, failures: { classify: () => ({ kind: "ordinary" as const, message: "prefetch" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => prefetchCompletion) }, clock: { now: () => 60_001 }, resolveResourceUrl: () => undefined
      })
    };
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const base = {
      context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png"), entry("Docs/b.png")], explicitOfflineMode: false, offline: false },
      settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks)
    } satisfies PreviewWorkspaceInput;
    base.ports.testRetention.refreshSummary = refreshCacheSummary;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    rerender({ ...base, context: { ...base.context, token: "token-beta" } });
    resolvePrefetch({ kind: "persisted" });
    await act(async () => { await Promise.resolve(); });
    expect(refreshCacheSummary).not.toHaveBeenCalled();
  });

  it("keeps stale terminal and backend-unavailable failures inert at the workspace seam", async () => {
    for (const failure of [
      { kind: "session-terminal" as const, reason: "session-expired" as const, message: "stale session" },
      { kind: "backend-unavailable" as const, message: "stale backend" }
    ]) {
      let rejectLate!: (error: Error) => void;
      const late = new Promise<PreviewAcquisition>((_resolve, reject) => { rejectLate = reject; });
      const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
      const composition = {
        createSessionAdapters: () => ({
          cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 0, totalBytes: 0, limitBytes: 1024 } })) },
          live: { acquire: vi.fn(async () => late) }, abort: { create: vi.fn(() => ({ id: "failure-kind", abort: vi.fn() })) }, resources: { apply: vi.fn(), release: vi.fn() },
          failures: { classify: () => failure }, prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: () => undefined
        })
      };
      const base = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
      const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
      let opening!: Promise<void>;
      await act(async () => { opening = result.current.openFile(entry("Docs/a.png")); await Promise.resolve(); });
      rerender({ ...base, context: { ...base.context, token: "token-beta" } });
      rejectLate(new Error(failure.message));
      await act(async () => { await opening; });
      expect(result.current.modal.previewError, failure.kind).toBeUndefined();
      expect(callbacks.onResetSession, failure.kind).not.toHaveBeenCalled();
      expect(callbacks.onMarkWorkerUnavailable, failure.kind).not.toHaveBeenCalled();
    }
  });

  it("does not publish stale refresh-ready after workspace identity replacement", async () => {
    let resolveRefresh!: (value: PreviewAcquisition) => void;
    const refresh = new Promise<PreviewAcquisition>((resolve) => { resolveRefresh = resolve; });
    const release = vi.fn();
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => cacheEntry(acquisition("Docs/a.png", "cached", "blob"), 0)), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 1, totalBytes: 8, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => refresh) }, abort: { create: vi.fn(() => ({ id: "refresh-stale", abort: vi.fn() })) }, resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release }, failures: { classify: () => ({ kind: "ordinary" as const, message: "refresh" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const base = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 1, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    expect(result.current.modal.previewCacheState.source).toBe("cache");
    rerender({ ...base, context: { ...base.context, token: "token-beta" } });
    resolveRefresh(acquisition("Docs/a.png", "fresh", "blob"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.applyPendingRefresh(); });
    expect(result.current.modal.pendingPreviewUpdate).toBeUndefined();
    expect(result.current.modal.previewCacheState.updateReady).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps an Alpha apply-refresh command inert after a Beta workspace transition", async () => {
    let resolveRefresh!: (value: PreviewAcquisition) => void;
    const refresh = new Promise<PreviewAcquisition>((resolve) => { resolveRefresh = resolve; });
    const release = vi.fn();
    const apply = vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind }));
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => cacheEntry(acquisition("Docs/a.png", "cached", "blob"), 0)), write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 1, totalBytes: 8, limitBytes: 1024 } })) },
        live: { acquire: vi.fn(async () => refresh) }, abort: { create: vi.fn(() => ({ id: "apply-stale", abort: vi.fn() })) },
        resources: { apply, release },
        failures: { classify: () => ({ kind: "ordinary" as const, message: "refresh" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) },
        clock: { now: () => 60_001 }, resolveResourceUrl: (resource: PreviewResource) => `blob:${resource.id}`
      })
    };
    const base = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 1, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    resolveRefresh(acquisition("Docs/a.png", "fresh", "blob"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.modal.previewCacheState).toMatchObject({ source: "cache", stale: true, updateReady: true });
    const alphaApply = result.current.applyPendingRefresh;

    rerender({ ...base, context: { ...base.context, activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta" }, accountName: "Beta", token: "token-beta", cacheNamespace: "cache-beta" } });
    const betaModalBaseline = {
      previewOpen: result.current.modal.previewOpen,
      selected: result.current.modal.selected,
      selectedBlobUrl: result.current.modal.selectedBlobUrl,
      previewError: result.current.modal.previewError,
      loadingPreview: result.current.modal.loadingPreview,
      previewCacheState: result.current.modal.previewCacheState,
      pendingPreviewUpdate: result.current.modal.pendingPreviewUpdate,
      openedEntry: result.current.modal.entry
    };
    const countsBeforeCapturedApply = {
      apply: apply.mock.calls.length,
      release: release.mock.calls.length,
      publishCacheSummary: callbacks.onPublishCacheSummary.mock.calls.length,
      streamCacheReady: callbacks.onStreamCacheReady.mock.calls.length,
      streamCacheFailed: callbacks.onStreamCacheFailed.mock.calls.length
    };
    expect(betaModalBaseline).toEqual({
      previewOpen: false,
      selected: undefined,
      selectedBlobUrl: undefined,
      previewError: undefined,
      loadingPreview: false,
      previewCacheState: { source: "none", refreshing: false, stale: false, updateReady: false },
      pendingPreviewUpdate: undefined,
      openedEntry: undefined
    });
    await act(async () => { await alphaApply(); });
    expect({
      previewOpen: result.current.modal.previewOpen,
      selected: result.current.modal.selected,
      selectedBlobUrl: result.current.modal.selectedBlobUrl,
      previewError: result.current.modal.previewError,
      loadingPreview: result.current.modal.loadingPreview,
      previewCacheState: result.current.modal.previewCacheState,
      pendingPreviewUpdate: result.current.modal.pendingPreviewUpdate,
      openedEntry: result.current.modal.entry
    }).toEqual(betaModalBaseline);
    expect({
      apply: apply.mock.calls.length,
      release: release.mock.calls.length,
      publishCacheSummary: callbacks.onPublishCacheSummary.mock.calls.length,
      streamCacheReady: callbacks.onStreamCacheReady.mock.calls.length,
      streamCacheFailed: callbacks.onStreamCacheFailed.mock.calls.length
    }).toEqual(countsBeforeCapturedApply);
  });

  it("does not publish a stale stream cache summary after identity replacement", async () => {
    let resolveWrite!: (value: { readonly kind: "stored"; readonly snapshot: PreviewCacheSnapshot }) => void;
    const write = new Promise<{ readonly kind: "stored"; readonly snapshot: PreviewCacheSnapshot }>((resolve) => { resolveWrite = resolve; });
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => write) },
        live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "stream", "stream")) }, abort: { create: vi.fn(() => ({ id: "stream-stale", abort: vi.fn() })) },
        resources: { apply: vi.fn((material: PreviewMaterial) => ({ id: material.id, kind: material.kind })), release: vi.fn() }, failures: { classify: () => ({ kind: "ordinary" as const, message: "stream" }) },
        prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: () => "stream:url"
      })
    };
    const base = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    rerender({ ...base, context: { ...base.context, token: "token-beta" } });
    resolveWrite({ kind: "stored", snapshot: { itemCount: 1, totalBytes: 8, limitBytes: 1024 } });
    await act(async () => { await Promise.resolve(); });
    expect(callbacks.onPublishCacheSummary).not.toHaveBeenCalled();
    expect(callbacks.onStreamCacheReady).not.toHaveBeenCalled();
    expect(callbacks.onStreamCacheFailed).not.toHaveBeenCalled();
  });

  it("keeps a rejected stale stream cache write ownership-inert", async () => {
    let rejectWrite!: (error: Error) => void;
    const write = new Promise<never>((_resolve, reject) => { rejectWrite = reject; });
    const callbacks = { onResetSession: vi.fn(), onMarkWorkerUnavailable: vi.fn(), onPublishCacheSummary: vi.fn(), onStreamCacheReady: vi.fn(), onStreamCacheFailed: vi.fn() };
    const composition = {
      createSessionAdapters: () => ({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => write) }, live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "stream-rejected", "stream")) }, abort: { create: vi.fn(() => ({ id: "stream-reject", abort: vi.fn() })) }, resources: { apply: vi.fn(), release: vi.fn() }, failures: { classify: () => ({ kind: "ordinary" as const, message: "write rejected" }) }, prefetch: { probe: vi.fn(async () => false), prefetch: vi.fn(async () => ({ kind: "cached" as const })) }, clock: { now: () => 60_001 }, resolveResourceUrl: () => "stream:url"
      })
    };
    const base = { context: { activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha" }, accountName: "Alpha", token: "token-alpha", cacheNamespace: "cache-alpha", cacheOnlyMode: false, currentPath: "Docs", visibleItems: [entry("Docs/a.png")], explicitOfflineMode: false, offline: false }, settings: { experimentalHeicPreviewEnabled: false, previewFreshnessIntervalSeconds: 60, maxCacheableFileSizeBytes: 1024 }, ports: workspacePortsForComposition(composition, callbacks) } satisfies PreviewWorkspaceInput;
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: base });
    await act(async () => { await result.current.openFile(entry("Docs/a.png")); });
    rerender({ ...base, context: { ...base.context, token: "token-beta" } });
    rejectWrite(new Error("late write"));
    await act(async () => { await Promise.resolve(); });
    expect(callbacks.onPublishCacheSummary).not.toHaveBeenCalled();
    expect(callbacks.onStreamCacheReady).not.toHaveBeenCalled();
    expect(callbacks.onStreamCacheFailed).not.toHaveBeenCalled();
    expect(result.current.modal.previewError).toBeUndefined();
  });

  it("characterizes fresh/stale/cache-only/stream acquisition, refresh application, cache summaries, HEIC fallback, and late completion release", async () => {
    const fresh = createSessionPorts({
      cache: {
        read: vi.fn(async () => cacheEntry(acquisition(request().path, "fresh"), 60_000)),
        write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 1, totalBytes: 8, limitBytes: 1024 } }))
      }
    });
    await expect(new PreviewSessionController(fresh.ports).open(request())).resolves.toMatchObject({ kind: "opened" });
    expect(fresh.ports.live.acquire).not.toHaveBeenCalled();
    expect(fresh.published.at(-1)).toMatchObject({ kind: "cached", status: "fresh" });

    const staleLive = { promise: Promise.resolve(acquisition(request().path, "new", "blob")) };
    const stale = createSessionPorts({
      cache: {
        read: vi.fn(async () => cacheEntry(acquisition(request().path, "old", "blob"), 0)),
        write: vi.fn(async () => ({ kind: "stored" as const, snapshot: { itemCount: 2, totalBytes: 16, limitBytes: 1024 } }))
      },
      live: { acquire: vi.fn(async () => staleLive.promise) }
    });
    const staleController = new PreviewSessionController(stale.ports);
    await staleController.open(request());
    await staleController.waitForBackground();
    expect(stale.published.at(-1)).toMatchObject({ kind: "refresh-ready", current: { fingerprint: "old" }, next: { fingerprint: "new" } });
    await expect(staleController.applyRefresh()).resolves.toMatchObject({ kind: "applied" });
    expect(stale.releases).toEqual(["resource-material-old"]);

    const stream = createSessionPorts({
      live: { acquire: vi.fn(async () => acquisition(request().path, "stream", "stream")) }
    });
    const streamController = new PreviewSessionController(stream.ports);
    await streamController.open({ ...request(), cacheLimitBytes: 2048 });
    await streamController.waitForBackground();
    expect(stream.cacheSnapshots).toHaveLength(1);
    expect(stream.cacheEvents[0]).toMatchObject({ kind: "stream-cache-ready" });

    const cacheOnly = createSessionPorts();
    await expect(new PreviewSessionController(cacheOnly.ports).open({ ...request(), connectionMode: "cache-only" })).resolves.toMatchObject({ kind: "failed" });
    expect(cacheOnly.ports.live.acquire).not.toHaveBeenCalled();

    const materials = new BrowserPreviewMaterialStore();
    const heic: FilePreview = { ...filePreview("Photos/source.heic", "image"), mimeType: "image/heic" };
    const transport: PreviewTransport = {
      getFile: vi.fn(async () => ({ file: heic })),
      fetchOriginalFile: vi.fn(async () => ({ blob: new Blob(["heic"]), mimeType: "image/heic", filename: "source.heic" })),
      createStreamingFileUrl: vi.fn(async () => "https://worker.invalid/stream")
    };
    const disabled = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport })
      .acquire(createPreviewRequestKey({ ...request(), requestSequence: 1 }), new BrowserPreviewAbortPort().create());
    expect(disabled.snapshot.unsupported).toBe("heic-fallback");
    expect(transport.fetchOriginalFile).not.toHaveBeenCalled();

    let resolvePending!: (value: PreviewAcquisition) => void;
    const pending = createSessionPorts({ live: { acquire: vi.fn(() => new Promise<PreviewAcquisition>((resolve) => { resolvePending = resolve; })) } });
    const controller = new PreviewSessionController(pending.ports);
    const open = controller.open(request());
    await Promise.resolve();
    controller.close();
    resolvePending(acquisition(request().path, "late", "blob"));
    await open;
    expect(pending.aborts).toEqual(["abort-1"]);
    expect(pending.releases).toEqual([]);
  });

  it("preserves unsupported, worker-unavailable, explicit-offline readable/unreadable, coordination order, and folder-audio exclusivity", async () => {
    const events: string[] = [];
    const ports = createOpenPorts(events);
    await openPreviewFile({
      entry: entry("Docs/archive.zip", "application/zip"),
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "cache-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "cache-alpha",
      accountName: "Alpha",
      contextGeneration: "generation-alpha",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);
    expect(events).toEqual(["prepare-download", "download-starting:/Docs/archive.zip", "download:Docs/archive.zip"]);

    const workerUnavailable = createOpenPorts();
    await openPreviewFile({
      entry: entry("Docs/archive.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "cache-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "cache-alpha",
      accountName: "Alpha",
      contextGeneration: "generation-alpha",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, workerUnavailable);
    const workerError = vi.mocked(workerUnavailable.surface.setPreviewError).mock.calls[0]?.[0];
    expect(workerError?.message).toMatch(/local server is unavailable/i);
    expect(workerUnavailable.session.open).not.toHaveBeenCalled();

    const cachedBlob = new Blob(["offline"]);
    const readable = createOpenPorts();
    vi.mocked(readable.explicitOffline.readCachedBlob).mockResolvedValue({ blob: cachedBlob, filename: "archive.zip" });
    await openPreviewFile({
      entry: entry("Docs/archive.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "cache-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "cache-alpha",
      accountName: "Alpha",
      contextGeneration: "generation-alpha",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, readable);
    expect(readable.explicitOffline.triggerLocalOpen).toHaveBeenCalledWith(cachedBlob, "archive.zip");
    expect(readable.explicitOffline.reportLocalOpen).toHaveBeenCalled();

    const unreadable = createOpenPorts();
    await openPreviewFile({
      entry: entry("Docs/archive.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "cache-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "cache-alpha",
      accountName: "Alpha",
      contextGeneration: "generation-alpha",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, unreadable);
    expect(unreadable.explicitOffline.reportUnreadable).toHaveBeenCalledTimes(1);

    const folderAudio = createOpenPorts();
    await openPreviewFile({
      entry: entry("Docs/song.mp3", "audio/mpeg"),
      options: { preferFolderAudioPlayer: true },
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "cache-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "cache-alpha",
      accountName: "Alpha",
      contextGeneration: "generation-alpha",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, folderAudio);
    expect(folderAudio.folderAudio.activate).toHaveBeenCalledWith(expect.objectContaining({ path: "Docs/song.mp3" }));
    expect(folderAudio.session.open).not.toHaveBeenCalled();

    await downloadUnsupportedPreviewFile("Docs/archive.zip", "/Docs/archive.zip", "Alpha", unreadable, { cacheOnlyMode: true, offline: true });
    expect(unreadable.unsupportedDownload.download).not.toHaveBeenCalled();
    expect(unreadable.unsupportedDownload.reportCacheOnlyBlocked).toHaveBeenCalled();
  });

  it("preserves gallery eligibility, previous/next identity, video prefetch exclusion, and replacement cleanup semantics", async () => {
    const items = [
      entry("Docs/a.png", "image/png"),
      entry("Docs/report.pdf", "application/pdf"),
      entry("Docs/song.mp3", "audio/mpeg"),
      entry("Docs/clip.mp4", "video/mp4"),
      entry("Docs/source.heic", "image/heic")
    ];
    const galleryWithoutHeic = buildMediaGalleryItems(items, false);
    const galleryWithHeic = buildMediaGalleryItems(items, true);
    expect(galleryWithoutHeic.map((item) => item.path)).toEqual(["Docs/a.png", "Docs/song.mp3", "Docs/clip.mp4"]);
    expect(galleryWithHeic).toHaveLength(4);
    const videoNavigation = buildPreviewNavigationItems(galleryWithoutHeic, entry("Docs/clip.mp4", "video/mp4"));
    expect(videoNavigation.map((item) => item.path)).toEqual(["Docs/clip.mp4"]);
    expect(resolveAdjacentMediaItem(galleryWithoutHeic, 1, -1)?.path).toBe("Docs/a.png");
    expect(resolveAdjacentMediaItem(galleryWithoutHeic, 1, 1)?.path).toBe("Docs/clip.mp4");
    expect(shouldSkipPrefetchForCurrentItem(entry("Docs/clip.mp4", "video/mp4"))).toBe(true);
    expect(shouldSkipPrefetchForCurrentItem(entry("Docs/a.png"))).toBe(false);

    const ports = createOpenPorts();
    await prefetchUpcomingPreviewMedia({
      startIndex: 0,
      mediaItems: [entry("Docs/a.png"), entry("Docs/clip.mp4", "video/mp4")],
      accountId: "alpha",
      cacheNamespace: "cache-alpha",
      contextGeneration: "generation-alpha",
      cacheOnlyMode: false,
      hasToken: true,
      hasActiveAccount: true,
      cacheNamespacePresent: true,
      heicPreviewEnabled: false,
      freshnessIntervalMs: 60_000,
      cacheLimitBytes: 1024
    }, ports, { accept: () => true });
    expect(ports.prefetch.runtime.prefetch).not.toHaveBeenCalled();

    const session = createSessionPorts({ live: { acquire: vi.fn(async (key: PreviewRequestKey) => acquisition(key.path, "replacement", "blob")) } });
    const controller = new PreviewSessionController(session.ports);
    await controller.open(request());
    controller.close();
    controller.close();
    expect(session.aborts).toEqual(["abort-1"]);
    expect(session.releases).toEqual(["resource-material-replacement"]);
  });

  it("records the current browser runtime forwarding and exactly-once resource boundary", () => {
    const runtime = createBrowserPreviewModalRuntime();
    for (const member of [
      "startOriginalFileOpen", "setTimeout", "clearTimeout", "getLocationHref", "addWindowKeydownListener",
      "loadAudioPreviewPosition", "saveAudioPreviewPosition", "clearAudioPreviewPosition", "pdf", "video"
    ]) {
      expect(runtime, `modal runtime member ${member}`).toHaveProperty(member);
    }
    const browserRuntime = source("../../../platform/preview/browserPreviewModalRuntime.ts");
    const folderAudioRuntime = source("../../../platform/preview/browserFolderAudioPorts.ts");
    expect(browserRuntime).toMatch(/window\.open|openPopup/);
    expect(browserRuntime).toMatch(/noopener|noreferrer/);
    expect(browserRuntime).toMatch(/createObjectURL|revokeObjectURL/);
    expect(browserRuntime).toMatch(/requestAnimationFrame|ResizeObserver|addEventListener/);
    expect(browserRuntime).not.toMatch(/retry/i);
    expect(folderAudioRuntime).toMatch(/createStreamingFileUrl/);
    expect(folderAudioRuntime).toMatch(/loadAudioPreviewPosition|saveAudioPreviewPosition/);
  });
});
