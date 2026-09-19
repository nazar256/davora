import { parseNormalizedPath, type CapabilitySet, type FileEntry } from "@davora/shared";
import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../../operations/policy";
import type { BatchArchiveInput, BatchSelectionCapture } from "../../operations/selection";
import { createEstimatingOfflineSyncDialog } from "./dialogModel";
import type { OfflineSyncActionResult } from "./ports";
import type { OfflineSyncPlan } from "./model";
import type { OfflineSyncConfirmOrchestrationPorts, OfflineSyncOpenOrchestrationPorts, OfflineSyncPorts } from "./orchestrationPorts";
import { OFFLINE_SYNC_NO_SESSION_MESSAGE } from "./presentation";
import { useOfflineSync, type UseOfflineSyncInput } from "./useOfflineSync";

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

const capabilities: CapabilitySet = {
  backend: "nextcloud",
  readOnly: false,
  search: true,
  preview: true,
  download: true,
  offlineCache: false,
  createFolder: true,
  upload: true,
  move: true,
  copy: true,
  delete: true,
  mediaPreview: true,
  markdownPreview: true,
  openedFileCache: true
};

function createPorts(): OfflineSyncPorts {
  const open: OfflineSyncOpenOrchestrationPorts = {
    plan: {
      buildEstimatePlan: vi.fn(async () => ({ files: [{ sourcePath: "notes.txt", size: 4 }], totalBytes: 4 }))
    },
    presentation: {
      reportListError: vi.fn(),
      closeMobileDetails: vi.fn(),
      showMobileActions: vi.fn(),
      setDialog: vi.fn(),
      updateDialog: vi.fn()
    },
    context: {
      isCurrentOperationContext: vi.fn(() => true)
    }
  };
  const confirm: OfflineSyncConfirmOrchestrationPorts = {
    registry: {
      acquire: vi.fn(() => ({
        signal: new AbortController().signal,
        isRegistered: () => true,
        isOwned: () => true,
        release: vi.fn()
      }))
    },
    transfers: {
      createId: vi.fn(() => "transfer-1"),
      enqueue: vi.fn(),
      beginPreparation: vi.fn(),
      beginTransfer: vi.fn(),
      reportProgress: vi.fn(),
      reportFailure: vi.fn(),
      complete: vi.fn(),
      completePartial: vi.fn(),
      fail: vi.fn(),
      openTray: vi.fn(),
      findActiveSyncByDedupeKey: vi.fn(() => undefined)
    },
    plan: {
      buildEstimatePlan: vi.fn(async () => ({ files: [], totalBytes: 0 })),
      resolvePlan: vi.fn(async () => ({ kind: "success", value: { files: [], totalBytes: 0 } } as const))
    },
    download: {
      fetchDownloadBlob: vi.fn()
    },
    retention: {
      beginRoot: vi.fn(async () => ({ kind: "success" } as const)),
      persistRetainedFile: vi.fn(async () => ({ kind: "success" } as const)),
      completeRoot: vi.fn(async () => ({ kind: "success" } as const)),
      readSummary: vi.fn(async () => ({ kind: "success", value: {} } as const))
    },
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isOperationAllowed: vi.fn(() => true),
      getCurrentCapabilities: vi.fn(() => capabilities),
      capabilitiesMatch: vi.fn(() => true)
    },
    session: {
      resetActiveSession: vi.fn()
    },
    errors: {
      isUnauthorized: vi.fn(() => false),
      isReconnectRequired: vi.fn(() => false),
      toErrorMessage: (_error, fallback) => fallback
    },
    presentation: {
      setStatus: vi.fn(),
      reportListError: vi.fn(),
      closeMobileDetails: vi.fn(),
      showMobileActions: vi.fn(),
      setDialog: vi.fn(),
      updateDialog: vi.fn(),
      setBusy: vi.fn()
    },
    selection: {
      removeCaptured: vi.fn()
    }
  };
  return {
    createAbortHandle: () => new AbortController(),
    open,
    confirm
  };
}

function createInput(ports: OfflineSyncPorts, context: ReturnType<typeof createOperationContextToken>, overrides: Partial<UseOfflineSyncInput> = {}): UseOfflineSyncInput {
  const selected = entry("notes.txt");
  return {
    isCurrentOperationHandler: () => true,
    hasSession: () => true,
    isCacheOnlyBlocked: () => false,
    isOffline: () => false,
    isOperationAllowed: () => true,
    getOperationContextToken: () => context,
    getCurrentOperationContextToken: () => context,
    isCurrentOperationContext: (captured) => captured === context,
    currentFocusedSelection: () => selected,
    getAccountId: () => "alpha",
    getAccountName: () => "Alpha",
    getCacheNamespace: () => "ns-alpha",
    resolveArchiveInput: (entries) => ({ roots: entries.map((item) => ({ entry: item, archiveRoot: item.path })), archiveLabel: "home" }),
    operationContextToken: context,
    ports,
    ...overrides
  };
}

describe("useOfflineSync", () => {
  it("reports missing session when opening offline sync", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync({
      isCurrentOperationHandler: () => true,
      hasSession: () => false,
      isCacheOnlyBlocked: () => false,
      isOffline: () => false,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      getCurrentOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
    currentFocusedSelection: () => entry("notes.txt"),
      getAccountId: () => undefined,
      getAccountName: () => "Alpha",
      getCacheNamespace: () => undefined,
      resolveArchiveInput: (entries) => ({ roots: entries.map((item) => ({ entry: item, archiveRoot: item.path })), archiveLabel: "home" }),
      ports
    }));

    await act(async () => {
      await result.current.openOfflineSyncDialog([]);
    });

    expect(ports.open.presentation.reportListError).toHaveBeenCalledWith(new Error(OFFLINE_SYNC_NO_SESSION_MESSAGE));
    expect(ports.open.presentation.setDialog).not.toHaveBeenCalled();
  });

  it("opens estimation dialog through orchestration ports", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    const archiveInput: BatchArchiveInput = {
      roots: [{ entry: selected, archiveRoot: "roadmap.txt" }],
      archiveLabel: "projects"
    };
    const { result } = renderHook(() => useOfflineSync({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isCacheOnlyBlocked: () => false,
      isOffline: () => false,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      getCurrentOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
    currentFocusedSelection: () => selected,
      getAccountId: () => "alpha",
      getAccountName: () => "Alpha",
      getCacheNamespace: () => "ns-alpha",
      resolveArchiveInput: (_entries, input) => input ?? archiveInput,
      ports
    }));

    await act(async () => {
      await result.current.openOfflineSyncDialog([selected], archiveInput);
    });

    expect(ports.open.presentation.setDialog).toHaveBeenCalledWith(createEstimatingOfflineSyncDialog({
      context,
      entries: [{ path: selected.path, name: selected.name, isFolder: false }],
      archiveInput
    }));
    const estimateCall = vi.mocked(ports.open.plan.buildEstimatePlan).mock.calls[0];
    expect(estimateCall?.[0]).toEqual(archiveInput);
    expect(estimateCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries failed sync entries for the active account", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync({
      isCurrentOperationHandler: () => true,
      hasSession: () => true,
      isCacheOnlyBlocked: () => false,
      isOffline: () => false,
      isOperationAllowed: () => true,
      getOperationContextToken: () => context,
      getCurrentOperationContextToken: () => context,
      isCurrentOperationContext: () => true,
    currentFocusedSelection: () => undefined,
      getAccountId: () => "alpha",
      getAccountName: () => "Alpha",
      getCacheNamespace: () => "ns-alpha",
      resolveArchiveInput: (entries) => ({ roots: entries.map((item) => ({ entry: item, archiveRoot: item.path })), archiveLabel: "home" }),
      ports
    }));

    await act(async () => {
      result.current.retryFailedOfflineSync({
        id: "sync-1",
        accountId: "alpha",
        kind: "sync",
        label: "roadmap.txt",
        dedupeKey: "sync:Projects/roadmap.txt",
        syncRootEntries: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }],
        loadedBytes: 0,
        startedAt: "2026-07-21T10:00:00.000Z",
        phase: "partial",
        finishedAt: "2026-07-21T10:00:01.000Z",
        errorMessage: "1 file failed to sync.",
        failedFiles: [{ sourcePath: "Projects/roadmap.txt", error: "network" }]
      });
      await Promise.resolve();
    });

    expect(ports.open.presentation.setDialog).toHaveBeenCalled();
  });

  it("rejects a late estimate from a reopened dialog in the same context", async () => {
    const ports = createPorts();
    let resolveFirst!: (plan: { files: readonly []; totalBytes: number }) => void;
    let resolveSecond!: (plan: { files: readonly []; totalBytes: number }) => void;
    ports.open.plan.buildEstimatePlan = vi.fn()
      .mockImplementationOnce(() => new Promise<OfflineSyncPlan>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<OfflineSyncPlan>((resolve) => { resolveSecond = resolve; }));
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context)));

    await act(async () => { void result.current.open([entry("first.txt")]); });
    const firstExecution = vi.mocked(ports.open.plan.buildEstimatePlan).mock.calls[0]?.[1];
    await act(async () => { void result.current.open([entry("second.txt")]); });
    expect(firstExecution?.signal.aborted).toBe(true);
    resolveFirst({ files: [], totalBytes: 1 });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dialog?.entries[0]?.path).toBe("second.txt");
    resolveSecond({ files: [], totalBytes: 2 });
    await waitFor(() => expect(result.current.dialog?.plan?.totalBytes).toBe(2));
  });

  it("represents unknown and failed estimates without reopening a stale dialog", async () => {
    const unknownPorts = createPorts();
    unknownPorts.open.plan.buildEstimatePlan = vi.fn(async () => ({ files: [] }));
    const unknownContext = createOperationContextToken();
    const unknown = renderHook(() => useOfflineSync(createInput(unknownPorts, unknownContext)));
    await act(async () => { await unknown.result.current.open([entry("unknown.txt")]); });
    expect(unknown.result.current.dialog).toMatchObject({ phase: "unknown", plan: { files: [] } });
    unknown.unmount();

    const errorPorts = createPorts();
    errorPorts.open.plan.buildEstimatePlan = vi.fn(async () => { throw new Error("estimate failed"); });
    const errorContext = createOperationContextToken();
    const errored = renderHook(() => useOfflineSync(createInput(errorPorts, errorContext)));
    await act(async () => { await errored.result.current.open([entry("error.txt")]); });
    expect(errored.result.current.dialog).toMatchObject({ phase: "unknown", error: "estimate failed" });
    errored.unmount();
  });

  it("keeps dismiss inert when a pending estimate settles late", async () => {
    const ports = createPorts();
    let resolveEstimate!: (plan: OfflineSyncPlan) => void;
    ports.open.plan.buildEstimatePlan = vi.fn(() => new Promise<OfflineSyncPlan>((resolve) => { resolveEstimate = resolve; }));
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context)));
    await act(async () => { void result.current.open([entry("dismissed.txt")]); });
    const execution = vi.mocked(ports.open.plan.buildEstimatePlan).mock.calls[0]?.[1];
    const publications = vi.mocked(ports.open.presentation.setDialog).mock.calls.length;
    act(() => { result.current.dismiss(); });
    expect(execution?.signal.aborted).toBe(true);
    expect(result.current.dialog).toBeUndefined();
    expect(result.current.busy).toBe(false);
    resolveEstimate({ files: [], totalBytes: 4 });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dialog).toBeUndefined();
    expect(ports.open.presentation.setDialog).toHaveBeenCalledTimes(publications + 1);
  });

  it("aborts estimation through the injected abort handle", async () => {
    const controller = new AbortController();
    const abort = vi.fn(() => controller.abort());
    const ports = {
      ...createPorts(),
      createAbortHandle: vi.fn(() => ({ signal: controller.signal, abort }))
    } satisfies OfflineSyncPorts;
    let resolveEstimate!: (plan: OfflineSyncPlan) => void;
    ports.open.plan.buildEstimatePlan = vi.fn(() => new Promise<OfflineSyncPlan>((resolve) => { resolveEstimate = resolve; }));
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context)));

    await act(async () => { void result.current.open([entry("injected-abort.txt")]); });
    act(() => { result.current.dismiss(); });

    expect(ports.createAbortHandle).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
    resolveEstimate({ files: [], totalBytes: 1 });
    await act(async () => { await Promise.resolve(); });
  });

  it("does not publish after unmount when estimation settles late", async () => {
    const ports = createPorts();
    let resolveEstimate!: (plan: OfflineSyncPlan) => void;
    ports.open.plan.buildEstimatePlan = vi.fn(() => new Promise<OfflineSyncPlan>((resolve) => { resolveEstimate = resolve; }));
    const context = createOperationContextToken();
    const { result, unmount } = renderHook(() => useOfflineSync(createInput(ports, context)));
    await act(async () => { void result.current.open([entry("unmounted.txt")]); });
    const execution = vi.mocked(ports.open.plan.buildEstimatePlan).mock.calls[0]?.[1];
    const publications = vi.mocked(ports.open.presentation.setDialog).mock.calls.length;
    unmount();
    expect(execution?.signal.aborted).toBe(true);
    resolveEstimate({ files: [], totalBytes: 5 });
    await Promise.resolve();
    expect(ports.open.presentation.setDialog).toHaveBeenCalledTimes(publications);
  });

  it("confirms immutable archive and selection snapshots after caller mutation", async () => {
    const ports = createPorts();
    const mutableEntry = { path: "original.txt", name: "original.txt", isFolder: false };
    const mutableArchive = {
      roots: [{ entry: mutableEntry, archiveRoot: "original.txt" }],
      archiveLabel: "original"
    };
    const captureIdentity = { accountId: "alpha", path: parseNormalizedPath("original.txt") };
    const capture = {
      accountId: "alpha",
      memberships: [{ identity: captureIdentity, membershipVersion: 7 }]
    } satisfies BatchSelectionCapture;
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context, {
      resolveArchiveInput: () => mutableArchive,
      currentFocusedSelection: () => mutableEntry
    })));
    await act(async () => { await result.current.open([mutableEntry], mutableArchive, capture); });
    mutableEntry.path = "mutated.txt";
    mutableEntry.name = "mutated.txt";
    mutableArchive.roots[0].archiveRoot = "mutated.txt";
    mutableArchive.archiveLabel = "mutated";
    captureIdentity.path = parseNormalizedPath("mutated.txt");
    await act(async () => { await result.current.confirm(); });
    expect(ports.confirm.transfers.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      syncRootEntries: [{ path: "original.txt", name: "original.txt", isFolder: false }]
    }));
    expect(ports.confirm.selection.removeCaptured).toHaveBeenCalledWith(expect.objectContaining({
      memberships: [{ identity: { accountId: "alpha", path: "original.txt" }, membershipVersion: 7 }]
    }));
  });

  it("invalidates late estimation on context replacement and unmount", async () => {
    const ports = createPorts();
    let resolveEstimate!: (plan: { files: readonly []; totalBytes: number }) => void;
    ports.open.plan.buildEstimatePlan = vi.fn(() => new Promise<OfflineSyncPlan>((resolve) => { resolveEstimate = resolve; }));
    let context = createOperationContextToken();
    const { result, rerender, unmount } = renderHook(() => useOfflineSync(createInput(ports, context, {
      lifecycleKey: `path:${context === undefined ? "" : "one"}`
    })));
    await act(async () => { void result.current.open([entry("late.txt")]); });
    context = createOperationContextToken();
    rerender();
    expect(result.current.dialog).toBeUndefined();
    resolveEstimate({ files: [], totalBytes: 3 });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dialog).toBeUndefined();
    unmount();
  });

  it("remains live after StrictMode effect replay", async () => {
    const ports = createPorts();
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context)), {
      wrapper: StrictMode
    });
    await act(async () => { await result.current.open([entry("strict.txt")]); });
    await waitFor(() => expect(result.current.dialog?.phase).toBe("ready"));
  });

  it("deduplicates concurrent confirm calls and never enqueues without registry ownership", async () => {
    const ports = createPorts();
    let releaseBegin!: () => void;
    ports.confirm.retention.beginRoot = vi.fn(() => new Promise<OfflineSyncActionResult>((resolve) => { releaseBegin = () => resolve({ kind: "success" }); }));
    const context = createOperationContextToken();
    const { result } = renderHook(() => useOfflineSync(createInput(ports, context)));
    await act(async () => { await result.current.open([entry("sync.txt")]); });
    await waitFor(() => expect(result.current.dialog?.phase).toBe("ready"));
    await act(async () => {
      void result.current.confirm();
      void result.current.confirm();
    });
    expect(ports.confirm.transfers.enqueue).toHaveBeenCalledOnce();
    releaseBegin();
    await act(async () => { await Promise.resolve(); });

    const noOwnership = createPorts();
    noOwnership.confirm.registry.acquire = vi.fn(() => ({
      signal: new AbortController().signal,
      isRegistered: () => true,
      isOwned: () => false,
      release: vi.fn()
    }));
    const second = renderHook(() => useOfflineSync(createInput(noOwnership, context)));
    await act(async () => { await second.result.current.open([entry("stale.txt")]); });
    await waitFor(() => expect(second.result.current.dialog?.phase).toBe("ready"));
    await act(async () => { await second.result.current.confirm(); });
    expect(noOwnership.confirm.transfers.enqueue).not.toHaveBeenCalled();
    second.unmount();
  });
});
