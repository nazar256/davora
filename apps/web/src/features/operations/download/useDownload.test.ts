import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import type { BatchArchiveInput } from "../selection";
import {
  buildOfflineDownloadBlockedMessage,
  buildServerUnavailableDownloadBlockedMessage,
  DOWNLOAD_NO_SESSION_MESSAGE
} from "./model";
import type { DownloadOrchestrationPorts } from "./orchestrationPorts";
import { useDownload } from "./useDownload";

function createPorts(overrides: Partial<DownloadOrchestrationPorts> = {}): DownloadOrchestrationPorts {
  return {
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
      fail: vi.fn()
    },
    files: {
      prepareDownload: vi.fn(async () => ({ blob: new Blob(["download"]), filename: "download.bin" })),
      fetchBlob: vi.fn(),
      listFiles: vi.fn(),
      triggerBrowserDownload: vi.fn()
    },
    batch: {
      downloadSelectionAsZip: vi.fn()
    },
    context: {
      isCurrent: vi.fn(() => true)
    },
    session: {
      terminateExpired: vi.fn(),
      terminateReconnectRequired: vi.fn()
    },
    errors: {
      isUnauthorized: vi.fn(() => false),
      isReconnectRequired: vi.fn(() => false),
      toErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback)
    },
    presentation: {
      reportStatus: vi.fn(),
      reportListError: vi.fn()
    },
    ...overrides
  };
}

describe("useDownload", () => {
  it("does not invoke orchestration when the current capability owner denies a focused download", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useDownload({
      canOperate: () => true,
      canDownloadFocused: () => false,
      canDownloadBatch: () => true,
      hasSession: () => true,
      isCacheOnlyBlocked: () => false,
      isOffline: () => false,
      buildFocusedInput: () => ({ accountId: "account-a", context: createOperationContextToken() }),
      buildBatchInput: () => ({ accountId: "account-a", accountName: "Workspace", context: createOperationContextToken() }),
      getBatchEntries: () => [{ path: "notes.txt", name: "notes.txt", isFolder: false }],
      getBatchArchiveInput: (): BatchArchiveInput => ({ roots: [], archiveLabel: "home" }),
      resolveDisplayPath: (path) => path,
      ports
    }));

    await act(async () => {
      await result.current.downloadFocused("notes.txt", "notes.txt");
    });

    expect(ports.registry.acquire).not.toHaveBeenCalled();
    expect(ports.files.prepareDownload).not.toHaveBeenCalled();
    expect(ports.presentation.reportListError).not.toHaveBeenCalled();
  });

  it("blocks cache-only downloads with the offline copy", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useDownload({
      canOperate: () => true,
      canDownloadFocused: () => true,
      canDownloadBatch: () => true,
      hasSession: () => true,
      isCacheOnlyBlocked: () => true,
      isOffline: () => true,
      buildFocusedInput: () => ({ accountId: "account-a", context: createOperationContextToken() }),
      buildBatchInput: () => ({ accountId: "account-a", accountName: "Workspace", context: createOperationContextToken() }),
      getBatchEntries: () => [{ path: "notes.txt", name: "notes.txt", isFolder: false }],
      getBatchArchiveInput: (): BatchArchiveInput => ({ roots: [], archiveLabel: "home" }),
      resolveDisplayPath: (path) => path,
      ports
    }));

    await act(async () => {
      await result.current.downloadFocused("notes.txt", "notes.txt");
    });

    expect(ports.presentation.reportListError).toHaveBeenCalledWith(new Error(buildOfflineDownloadBlockedMessage()));
    expect(ports.files.prepareDownload).not.toHaveBeenCalled();
  });

  it("blocks cache-only batch downloads with the server-unavailable copy", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useDownload({
      canOperate: () => true,
      canDownloadFocused: () => true,
      canDownloadBatch: () => true,
      hasSession: () => true,
      isCacheOnlyBlocked: () => true,
      isOffline: () => false,
      buildFocusedInput: () => ({ accountId: "account-a", context: createOperationContextToken() }),
      buildBatchInput: () => ({ accountId: "account-a", accountName: "Workspace", context: createOperationContextToken() }),
      getBatchEntries: () => [
        { path: "notes.txt", name: "notes.txt", isFolder: false },
        { path: "Archive", name: "Archive", isFolder: true }
      ],
      getBatchArchiveInput: (): BatchArchiveInput => ({ roots: [], archiveLabel: "home" }),
      resolveDisplayPath: (path) => path,
      ports
    }));

    await act(async () => {
      await result.current.downloadBatch();
    });

    expect(ports.presentation.reportListError).toHaveBeenCalledWith(new Error(buildServerUnavailableDownloadBlockedMessage()));
    expect(ports.batch.downloadSelectionAsZip).not.toHaveBeenCalled();
  });

  it("reports missing session before starting downloads", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useDownload({
      canOperate: () => true,
      canDownloadFocused: () => true,
      canDownloadBatch: () => true,
      hasSession: () => false,
      isCacheOnlyBlocked: () => false,
      isOffline: () => false,
      buildFocusedInput: () => undefined,
      buildBatchInput: () => undefined,
      getBatchEntries: () => [{ path: "notes.txt", name: "notes.txt", isFolder: false }],
      getBatchArchiveInput: (): BatchArchiveInput => ({ roots: [], archiveLabel: "home" }),
      resolveDisplayPath: (path) => path,
      ports
    }));

    await act(async () => {
      await result.current.downloadFocused("notes.txt", "notes.txt");
    });

    expect(ports.presentation.reportListError).toHaveBeenCalledWith(new Error(DOWNLOAD_NO_SESSION_MESSAGE));
  });
});
