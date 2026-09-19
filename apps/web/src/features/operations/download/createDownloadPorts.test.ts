import { describe, expect, it, vi } from "vitest";

import type { BatchDownloadPlan } from "../../../lib/batchDownload";
import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import type { BatchArchiveInput } from "../selection";
import {
  createDownloadPorts,
  type CreateDownloadPortsInput,
  type DownloadBatchSource,
  type DownloadFileSources
} from "./createDownloadPorts";
import { DOWNLOAD_NO_SESSION_MESSAGE } from "./model";
import { runBatchDownloadOrchestration, runFocusedDownloadOrchestration } from "./orchestration";

type PrepareDownloadOptions = Parameters<DownloadFileSources["prepareDownloadFile"]>[2];
type DownloadSelectionAsZipOptions = Parameters<DownloadBatchSource["downloadSelectionAsZip"]>[0];

function createInput(overrides: Partial<CreateDownloadPortsInput> = {}): CreateDownloadPortsInput & {
  readonly acquiredScope: {
    readonly signal: AbortSignal;
    isRegistered: ReturnType<typeof vi.fn>;
    isOwned: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
} {
  const acquiredScope = {
    signal: new AbortController().signal,
    isRegistered: vi.fn(() => true),
    isOwned: vi.fn(() => true),
    release: vi.fn()
  };
  return {
    getToken: () => "token-alpha",
    files: {
      prepareDownloadFile: vi.fn(async (
        _path: string,
        _token: string,
        options?: PrepareDownloadOptions
      ) => {
        options?.onProgress?.(3, 5);
        return { blob: new Blob(["download"]), filename: "notes.txt" };
      }),
      fetchDownloadBlob: vi.fn(async () => ({ blob: new Blob(["batch"]), filename: "notes.txt" })),
      listFiles: vi.fn(async () => ({ items: [] })),
      triggerBrowserDownload: vi.fn()
    },
    batch: {
      downloadSelectionAsZip: vi.fn(async (options: DownloadSelectionAsZipOptions) => {
        const plan: BatchDownloadPlan = {
          archiveName: "documents.zip",
          selectedCount: 1,
          selectedFileCount: 1,
          selectedDirectoryCount: 0,
          directories: [],
          files: [{ sourcePath: "notes.txt", archivePath: "notes.txt", size: 5 }],
          failedFiles: [],
          totalBytes: 5
        };
        options.onPlanReady?.(plan);
        return { blob: new Blob(["zip"]), plan };
      })
    },
    registry: {
      acquire: vi.fn(() => acquiredScope)
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
    context: {
      isOperationContextAllowed: vi.fn(() => true)
    },
    session: {
      resetActiveSession: vi.fn()
    },
    presentation: {
      reportStatus: vi.fn(),
      reportListError: vi.fn()
    },
    errors: {
      isUnauthorized: (error: unknown) => error instanceof ApiRequestError && error.status === 401,
      isReconnectRequired: (error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
      toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
    },
    acquiredScope,
    ...overrides
  };
}

describe("createDownloadPorts", () => {
  it("rejects token-gated file ports when no session is available", async () => {
    const input = createInput({ getToken: () => undefined });
    const ports = createDownloadPorts(input);

    await expect(ports.files.prepareDownload("notes.txt", {
      onProgress: vi.fn(),
      signal: new AbortController().signal
    })).rejects.toThrow(DOWNLOAD_NO_SESSION_MESSAGE);
    await expect(ports.files.fetchBlob("notes.txt")).rejects.toThrow(DOWNLOAD_NO_SESSION_MESSAGE);
    await expect(ports.files.listFiles("")).rejects.toThrow(DOWNLOAD_NO_SESSION_MESSAGE);
    expect(input.transfers.enqueue).not.toHaveBeenCalled();
    expect(input.registry.acquire).not.toHaveBeenCalled();
  });

  it("passes the session token through focused download adapters", async () => {
    const input = createInput();
    const ports = createDownloadPorts(input);
    const signal = new AbortController().signal;
    const onProgress = vi.fn();

    await ports.files.prepareDownload("notes.txt", { onProgress, signal });
    await ports.files.fetchBlob("Archive/photo.png", { onProgress });
    await ports.files.listFiles("Archive");

    expect(input.files.prepareDownloadFile).toHaveBeenCalledWith("notes.txt", "token-alpha", { onProgress, signal });
    expect(input.files.fetchDownloadBlob).toHaveBeenCalledWith("Archive/photo.png", "token-alpha", { onProgress });
    expect(input.files.listFiles).toHaveBeenCalledWith("Archive", "token-alpha");
  });

  it("keeps browser and batch download helpers behind feature ports", async () => {
    const input = createInput();
    const ports = createDownloadPorts(input);
    const blob = new Blob(["zip"]);

    ports.files.triggerBrowserDownload(blob, "notes.txt");
    await ports.batch.downloadSelectionAsZip({
      roots: [],
      archiveLabel: "home",
      listFiles: vi.fn(async () => ({ items: [] })),
      fetchFile: vi.fn(async () => ({ blob: new Blob(["file"]) }))
    });

    expect(input.files.triggerBrowserDownload).toHaveBeenCalledWith(blob, "notes.txt");
    expect(input.batch.downloadSelectionAsZip).toHaveBeenCalledTimes(1);
  });

  it("wires focused downloads through registry acquire, transfer progress, and release", async () => {
    const input = createInput();
    const ports = createDownloadPorts(input);
    const context = createOperationContextToken();

    await runFocusedDownloadOrchestration({
      path: "notes.txt",
      displayPath: "notes.txt",
      accountId: "account-a",
      context
    }, ports);

    expect(input.registry.acquire).toHaveBeenCalledWith({
      context,
      intent: { kind: "downloadFocused", present: true, isFolder: false }
    });
    expect(input.transfers.enqueue).toHaveBeenCalledWith({
      id: "transfer-1",
      accountId: "account-a",
      kind: "download",
      label: "notes.txt"
    });
    expect(input.transfers.beginTransfer).toHaveBeenCalledWith("transfer-1", undefined);
    expect(input.transfers.reportProgress).toHaveBeenCalledWith("transfer-1", "transferring", expect.any(Number), expect.any(Number));
    expect(input.transfers.complete).toHaveBeenCalledWith("transfer-1", undefined);
    expect(input.files.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(input.acquiredScope.release).toHaveBeenCalledTimes(1);
  });

  it("releases the abort scope when focused downloads fail", async () => {
    const input = createInput({
      files: {
        ...createInput().files,
        prepareDownloadFile: vi.fn(async () => {
          throw new Error("Temporary sync failure.");
        })
      }
    });
    const ports = createDownloadPorts(input);

    await runFocusedDownloadOrchestration({
      path: "notes.txt",
      displayPath: "notes.txt",
      accountId: "account-a",
      context: createOperationContextToken()
    }, ports);

    expect(input.transfers.fail).toHaveBeenCalledWith("transfer-1", "Temporary sync failure.");
    expect(input.acquiredScope.release).toHaveBeenCalledTimes(1);
  });

  it("routes batch zip downloads through transfer lifecycle and partial completion", async () => {
    const input = createInput({
      batch: {
        downloadSelectionAsZip: vi.fn(async (options: DownloadSelectionAsZipOptions) => {
          const failure = { sourcePath: "notes.txt", error: "Temporary sync failure." };
          const plan: BatchDownloadPlan = {
            archiveName: "documents.zip",
            selectedCount: 2,
            selectedFileCount: 1,
            selectedDirectoryCount: 1,
            directories: ["Archive"],
            files: [
              { sourcePath: "notes.txt", archivePath: "notes.txt", size: 5 },
              { sourcePath: "Archive/photo.png", archivePath: "Archive/photo.png", size: 7 }
            ],
            failedFiles: [failure],
            totalBytes: 12
          };
          options.onPlanReady?.(plan);
          options.onFileFailed?.(failure);
          return { blob: new Blob(["zip"]), plan };
        })
      }
    });
    const ports = createDownloadPorts(input);
    const archiveInput: BatchArchiveInput = {
      roots: [
        { entry: { path: "notes.txt", name: "notes.txt", isFolder: false }, archiveRoot: "notes.txt" },
        { entry: { path: "Archive", name: "Archive", isFolder: true }, archiveRoot: "Archive" }
      ],
      archiveLabel: "home"
    };

    await runBatchDownloadOrchestration({
      entries: archiveInput.roots.map((root) => root.entry),
      archiveInput,
      accountId: "account-a",
      accountName: "Workspace",
      context: createOperationContextToken(),
      resolveDisplayPath: (path) => path
    }, ports);

    expect(input.transfers.enqueue).toHaveBeenCalledWith({
      id: "transfer-1",
      accountId: "account-a",
      kind: "download",
      label: "1 file and 1 folder selected"
    });
    expect(input.transfers.beginPreparation).toHaveBeenCalledWith("transfer-1", undefined);
    expect(input.transfers.reportFailure).toHaveBeenCalledWith("transfer-1", {
      sourcePath: "notes.txt",
      error: "Temporary sync failure."
    });
    expect(input.transfers.completePartial).toHaveBeenCalledWith(
      "transfer-1",
      [{ sourcePath: "notes.txt", error: "Temporary sync failure." }],
      "Downloaded 1 of 2 files; 1 failed.",
      { label: "documents.zip" }
    );
    expect(input.files.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "documents.zip");
  });

  it("short-circuits single non-folder batch entries to focused download", async () => {
    const input = createInput();
    const ports = createDownloadPorts(input);

    await runBatchDownloadOrchestration({
      entries: [{ path: "notes.txt", name: "notes.txt", isFolder: false }],
      archiveInput: {
        roots: [{ entry: { path: "notes.txt", name: "notes.txt", isFolder: false }, archiveRoot: "notes.txt" }],
        archiveLabel: "home"
      },
      accountId: "account-a",
      accountName: "Workspace",
      context: createOperationContextToken(),
      resolveDisplayPath: (path) => path
    }, ports);

    expect(input.files.prepareDownloadFile).toHaveBeenCalledTimes(1);
    expect(input.batch.downloadSelectionAsZip).not.toHaveBeenCalled();
  });

  it("terminates expired and reconnect-required sessions through session ports", async () => {
    const unauthorizedInput = createInput({
      files: {
        ...createInput().files,
        prepareDownloadFile: vi.fn(async () => {
          throw new ApiRequestError("Session expired", 401, "unauthorized");
        })
      }
    });
    await runFocusedDownloadOrchestration({
      path: "notes.txt",
      displayPath: "notes.txt",
      accountId: "account-a",
      context: createOperationContextToken()
    }, createDownloadPorts(unauthorizedInput));
    expect(unauthorizedInput.session.resetActiveSession).toHaveBeenCalledWith(
      "Session expired. Create a fresh session for this account."
    );

    const reconnectInput = createInput({
      files: {
        ...createInput().files,
        prepareDownloadFile: vi.fn(async () => {
          throw new ApiRequestError("reconnect-secret", 403, "account_reconnect_required");
        })
      }
    });
    await runFocusedDownloadOrchestration({
      path: "notes.txt",
      displayPath: "notes.txt",
      accountId: "account-a",
      context: createOperationContextToken()
    }, createDownloadPorts(reconnectInput));
    expect(reconnectInput.session.resetActiveSession).toHaveBeenCalledWith(
      "This account needs to be reconnected before downloading files.",
      true
    );
  });
});
