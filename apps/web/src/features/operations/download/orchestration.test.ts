import type { FileEntry } from "@davora/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchDownloadPlan } from "../../../lib/batchDownload";
import { downloadSelectionAsZip } from "../../../lib/batchDownload";
import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken, type OperationContextToken } from "../policy";
import type { BatchArchiveInput } from "../selection";
import { DOWNLOAD_CONTEXT_CHANGED_MESSAGE } from "./model";
import { runBatchDownloadOrchestration, runFocusedDownloadOrchestration } from "./orchestration";
import type { DownloadBatchPort, DownloadOrchestrationPorts, DownloadRequestScope } from "./orchestrationPorts";

type BatchZipOptions = Parameters<DownloadBatchPort["downloadSelectionAsZip"]>[0];

class FakeDeferredJsZip {
  folder(_name: string): this {
    return this;
  }

  file(_name: string, _content: unknown): void {}

  async generateAsync(): Promise<Blob> {
    return new Blob(["zip"]);
  }
}

function deferJsZipModule() {
  let resolveModule: ((module: { default: typeof FakeDeferredJsZip }) => void) | undefined;
  const moduleReady = new Promise<{ default: typeof FakeDeferredJsZip }>((resolve) => {
    resolveModule = resolve;
  });
  let resolveImportStarted: (() => void) | undefined;
  const importStarted = new Promise<void>((resolve) => {
    resolveImportStarted = resolve;
  });
  vi.doMock("jszip", async () => {
    resolveImportStarted?.();
    return moduleReady;
  });
  return {
    importStarted,
    resolve() {
      resolveModule?.({ default: FakeDeferredJsZip });
    }
  };
}

afterEach(() => {
  vi.doUnmock("jszip");
  vi.resetModules();
});

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

function createScope(overrides: Partial<{ registered: boolean; owned: boolean; aborted: boolean }> = {}) {
  const controller = new AbortController();
  let registered = overrides.registered ?? true;
  let owned = overrides.owned ?? true;
  if (overrides.aborted) {
    controller.abort();
  }
  const scope: DownloadRequestScope = {
    signal: controller.signal,
    isRegistered: () => registered,
    isOwned: () => registered && owned && !controller.signal.aborted,
    release: vi.fn(() => {
      registered = false;
    })
  };
  return {
    scope,
    setRegistered(next: boolean) {
      registered = next;
    },
    setOwned(next: boolean) {
      owned = next;
    },
    abort() {
      controller.abort();
    }
  };
}

type MutableFixture = DownloadOrchestrationPorts & {
  scope: ReturnType<typeof createScope>;
  transferEvents: string[];
  setContextCurrent(next: boolean): void;
  setOwned(next: boolean): void;
};

function ports(overrides: Partial<DownloadOrchestrationPorts> = {}): MutableFixture {
  const transferEvents: string[] = [];
  let nextId = 0;
  const scopeHolder = createScope();
  let contextCurrent = true;
  const defaultPorts: DownloadOrchestrationPorts = {
    registry: {
      acquire: vi.fn(() => scopeHolder.scope)
    },
    transfers: {
      createId: vi.fn(() => `transfer-${nextId += 1}`),
      enqueue: vi.fn(() => { transferEvents.push("enqueue"); }),
      beginPreparation: vi.fn((id: string) => { transferEvents.push(`prepare:${id}`); }),
      beginTransfer: vi.fn((id: string) => { transferEvents.push(`transfer:${id}`); }),
      reportProgress: vi.fn((id: string, loaded: number, total?: number | null) => {
        transferEvents.push(`progress:${id}:${loaded}/${total ?? "?"}`);
      }),
      reportFailure: vi.fn((id: string, failure: { sourcePath: string; error: string }) => {
        transferEvents.push(`file-failure:${id}:${failure.sourcePath}`);
      }),
      complete: vi.fn((id: string) => { transferEvents.push(`complete:${id}`); }),
      completePartial: vi.fn((id: string) => { transferEvents.push(`partial:${id}`); }),
      fail: vi.fn((id: string, message: string) => { transferEvents.push(`fail:${id}:${message}`); })
    },
    files: {
      prepareDownload: vi.fn(async (
        _path: string,
        options: { onProgress: (loadedBytes: number, totalBytes?: number) => void; signal: AbortSignal }
      ) => {
        options.onProgress(3, 5);
        return { blob: new Blob(["download"]), filename: "download.bin" };
      }),
      fetchBlob: vi.fn(async () => ({ blob: new Blob(["batch"]), filename: "file.txt" })),
      listFiles: vi.fn(async () => ({ completeness: "complete" as const, items: [] })),
      triggerBrowserDownload: vi.fn()
    },
    batch: {
      downloadSelectionAsZip: vi.fn(async (options: BatchZipOptions) => {
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
          failedFiles: [],
          totalBytes: 12
        };
        options.onPlanReady?.(plan);
        return { blob: new Blob(["zip"]), plan };
      })
    },
    context: {
      isCurrent: vi.fn(() => contextCurrent)
    },
    session: {
      terminateExpired: vi.fn(),
      terminateReconnectRequired: vi.fn()
    },
    errors: {
      isUnauthorized: vi.fn((error: unknown) => error instanceof ApiRequestError && error.status === 401),
      isReconnectRequired: vi.fn((error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required"),
      toErrorMessage: vi.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback)
    },
    presentation: {
      reportStatus: vi.fn(),
      reportListError: vi.fn()
    }
  };

  const fixture: MutableFixture = {
    ...defaultPorts,
    ...overrides,
    registry: overrides.registry ?? defaultPorts.registry,
    transfers: { ...defaultPorts.transfers, ...overrides.transfers },
    files: { ...defaultPorts.files, ...overrides.files },
    batch: { ...defaultPorts.batch, ...overrides.batch },
    context: { ...defaultPorts.context, ...overrides.context },
    session: { ...defaultPorts.session, ...overrides.session },
    errors: { ...defaultPorts.errors, ...overrides.errors },
    presentation: { ...defaultPorts.presentation, ...overrides.presentation },
    scope: scopeHolder,
    transferEvents,
    setContextCurrent(next: boolean) {
      contextCurrent = next;
    },
    setOwned(next: boolean) {
      scopeHolder.setOwned(next);
    }
  };

  fixture.context.isCurrent = vi.fn(() => contextCurrent);

  return fixture;
}

function focusedInput(context: OperationContextToken = createOperationContextToken()) {
  return {
    path: "notes.txt",
    displayPath: "notes.txt",
    accountId: "account-a",
    context
  };
}

function batchInput(entries: readonly FileEntry[], context: OperationContextToken = createOperationContextToken()) {
  const archiveInput: BatchArchiveInput = {
    roots: entries.map((entry) => ({ entry, archiveRoot: entry.path })),
    archiveLabel: "home"
  };
  return {
    entries,
    archiveInput,
    accountId: "account-a",
    accountName: "Batch download workspace",
    context,
    resolveDisplayPath: (path: string) => path
  };
}

describe("runFocusedDownloadOrchestration", () => {
  it("reports progress and triggers browser download on success", async () => {
    const adapter = ports();

    await runFocusedDownloadOrchestration(focusedInput(), adapter);

    expect(adapter.transfers.reportProgress).toHaveBeenCalledWith("transfer-1", 3, 5);
    expect(adapter.files.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "download.bin");
    expect(adapter.transfers.complete).toHaveBeenCalledWith("transfer-1");
    expect(adapter.scope.scope.release).toHaveBeenCalledTimes(1);
  });

  it("fails without triggering browser download when context ownership is lost", async () => {
    const scopeHolder = createScope();
    const adapter = ports({
      registry: {
        acquire: vi.fn(() => scopeHolder.scope)
      },
      files: {
        prepareDownload: vi.fn(async () => {
          scopeHolder.setOwned(false);
          return { blob: new Blob(["download"]), filename: "download.bin" };
        }),
        fetchBlob: vi.fn(),
        listFiles: vi.fn(),
        triggerBrowserDownload: vi.fn()
      }
    });

    await runFocusedDownloadOrchestration(focusedInput(), adapter);

    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(adapter.transfers.fail).toHaveBeenCalledWith("transfer-1", DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
  });

  it("terminates the session on unauthorized errors", async () => {
    const adapter = ports({
      files: {
        prepareDownload: vi.fn(async () => {
          throw new ApiRequestError("Session expired", 401, "unauthorized");
        }),
        fetchBlob: vi.fn(),
        listFiles: vi.fn(),
        triggerBrowserDownload: vi.fn()
      }
    });

    await runFocusedDownloadOrchestration(focusedInput(), adapter);

    expect(adapter.session.terminateExpired).toHaveBeenCalledWith("Session expired. Create a fresh session for this account.");
    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it("terminates reconnect-required sessions without exposing secrets", async () => {
    const secret = "reconnect-secret-token";
    const adapter = ports({
      files: {
        prepareDownload: vi.fn(async () => {
          throw new ApiRequestError(secret, 403, "account_reconnect_required");
        }),
        fetchBlob: vi.fn(),
        listFiles: vi.fn(),
        triggerBrowserDownload: vi.fn()
      }
    });

    await runFocusedDownloadOrchestration(focusedInput(), adapter);

    expect(adapter.session.terminateReconnectRequired)
      .toHaveBeenCalledWith("This account needs to be reconnected before downloading files.");
    for (const call of [
      ...vi.mocked(adapter.presentation.reportListError).mock.calls,
      ...vi.mocked(adapter.transfers.fail).mock.calls
    ]) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});

describe("runBatchDownloadOrchestration", () => {
  it("acquires one abort scope and contains deferred batch work after context invalidation", async () => {
    const scopeHolder = createScope();
    let resolveListing: ((result: { completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }) => void) | undefined;
    const listing = new Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>((resolve) => {
      resolveListing = resolve;
    });
    let resolveFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    let resolveBlob: ((result: { readonly blob: Blob; readonly filename?: string }) => void) | undefined;
    const blob = new Promise<{ readonly blob: Blob; readonly filename?: string }>((resolve) => {
      resolveBlob = resolve;
    });
    const latePlan: BatchDownloadPlan = {
      archiveName: "documents.zip",
      selectedCount: 1,
      selectedFileCount: 1,
      selectedDirectoryCount: 0,
      directories: [],
      files: [{ sourcePath: "Archive/photo.png", archivePath: "photo.png", size: 5 }],
      failedFiles: [],
      totalBytes: 5
    };
    let batchOptions: BatchZipOptions | undefined;
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      files: {
        prepareDownload: vi.fn(),
        fetchBlob: vi.fn((_path: string, _options?: { readonly signal?: AbortSignal }) => {
          resolveFetchStarted?.();
          return blob;
        }),
        listFiles: vi.fn((_path: string, options?: { readonly signal?: AbortSignal }) => {
          void options;
          return listing;
        }),
        triggerBrowserDownload: vi.fn()
      },
      batch: {
        downloadSelectionAsZip: vi.fn(async (options: BatchZipOptions) => {
          batchOptions = options;
          await options.listFiles("Archive");
          await options.fetchFile("Archive/photo.png");
          return {
            blob: new Blob(["zip"]),
            plan: latePlan
          };
        })
      }
    });
    const pending = runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);
    await Promise.resolve();
    resolveListing?.({ completeness: "complete" as const, items: [entry("Archive/photo.png")] });
    await fetchStarted;

    const progressCallsBeforeInvalidation = vi.mocked(adapter.transfers.reportProgress).mock.calls.length;
    const failureCallsBeforeInvalidation = vi.mocked(adapter.transfers.reportFailure).mock.calls.length;
    const statusCallsBeforeInvalidation = vi.mocked(adapter.presentation.reportStatus).mock.calls.length;
    const preparationCallsBeforeInvalidation = vi.mocked(adapter.transfers.beginPreparation).mock.calls.length;
    const transferCallsBeforeInvalidation = vi.mocked(adapter.transfers.beginTransfer).mock.calls.length;
    const completionCallsBeforeInvalidation = vi.mocked(adapter.transfers.complete).mock.calls.length;
    const partialCallsBeforeInvalidation = vi.mocked(adapter.transfers.completePartial).mock.calls.length;
    adapter.setContextCurrent(false);
    adapter.setOwned(false);
    scopeHolder.abort();
    batchOptions?.onFileProgress?.(4, 5);
    batchOptions?.onFileFailed?.({ sourcePath: "Archive/photo.png", error: "late failure" });
    batchOptions?.onArchiveProgress?.(50);
    batchOptions?.onPlanReady?.(latePlan);
    resolveBlob?.({ blob: new Blob(["photo"]), filename: "photo.png" });
    await pending;

    expect(adapter.registry.acquire).toHaveBeenCalledWith(expect.objectContaining({
      intent: { kind: "downloadBatch", count: 1 }
    }));
    expect(adapter.files.listFiles).toHaveBeenCalledWith("Archive", { signal: scopeHolder.scope.signal });
    expect(adapter.files.fetchBlob).toHaveBeenCalledWith(
      "Archive/photo.png",
      expect.objectContaining({ signal: scopeHolder.scope.signal })
    );
    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.transfers.reportProgress).mock.calls.length).toBe(progressCallsBeforeInvalidation);
    expect(vi.mocked(adapter.transfers.reportFailure).mock.calls.length).toBe(failureCallsBeforeInvalidation);
    expect(vi.mocked(adapter.presentation.reportStatus).mock.calls.length).toBe(statusCallsBeforeInvalidation);
    expect(vi.mocked(adapter.transfers.beginPreparation).mock.calls.length).toBe(preparationCallsBeforeInvalidation);
    expect(vi.mocked(adapter.transfers.beginTransfer).mock.calls.length).toBe(transferCallsBeforeInvalidation);
    expect(vi.mocked(adapter.transfers.complete).mock.calls.length).toBe(completionCallsBeforeInvalidation);
    expect(vi.mocked(adapter.transfers.completePartial).mock.calls.length).toBe(partialCallsBeforeInvalidation);
  });

  it("contains late JSZip resolution after batch context invalidation", async () => {
    const deferred = deferJsZipModule();
    const scopeHolder = createScope();
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      files: {
        prepareDownload: vi.fn(),
        listFiles: vi.fn(async () => ({
          completeness: "complete" as const,
          items: [entry("Archive/photo.png")]
        })),
        fetchBlob: vi.fn(async () => ({ blob: new Blob(["photo"]) })),
        triggerBrowserDownload: vi.fn()
      },
      batch: { downloadSelectionAsZip }
    });

    const pending = runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);
    await deferred.importStarted;
    const statusCallsBeforeInvalidation = vi.mocked(adapter.presentation.reportStatus).mock.calls.length;
    adapter.setContextCurrent(false);
    adapter.setOwned(false);
    scopeHolder.abort();
    deferred.resolve();
    await pending;

    expect(adapter.files.listFiles).toHaveBeenCalledTimes(1);
    expect(adapter.files.fetchBlob).not.toHaveBeenCalled();
    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(adapter.transfers.complete).not.toHaveBeenCalled();
    expect(adapter.transfers.completePartial).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.presentation.reportStatus).mock.calls.length).toBe(statusCallsBeforeInvalidation);
    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
  });

  it("completes the real batch path when deferred JSZip resolution stays current", async () => {
    const deferred = deferJsZipModule();
    const scopeHolder = createScope();
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      files: {
        prepareDownload: vi.fn(),
        listFiles: vi.fn(async () => ({
          completeness: "complete" as const,
          items: [entry("Archive/photo.png")]
        })),
        fetchBlob: vi.fn(async () => ({ blob: new Blob(["photo"]) })),
        triggerBrowserDownload: vi.fn()
      },
      batch: { downloadSelectionAsZip }
    });

    const pending = runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);
    await deferred.importStarted;
    deferred.resolve();
    await pending;

    expect(adapter.files.listFiles).toHaveBeenCalledTimes(1);
    expect(adapter.files.fetchBlob).toHaveBeenCalledTimes(1);
    expect(adapter.files.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "archive.zip");
    expect(adapter.transfers.complete).toHaveBeenCalledWith("transfer-1", { label: "archive.zip" });
    expect(adapter.transfers.fail).not.toHaveBeenCalled();
    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
  });

  it("contains late batch work when the scope is unregistered while context remains current", async () => {
    const scopeHolder = createScope();
    let resolveBatch: (() => void) | undefined;
    const batchReady = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      batch: {
        downloadSelectionAsZip: vi.fn(async () => {
          await batchReady;
          return {
            blob: new Blob(["zip"]),
            plan: {
              archiveName: "documents.zip",
              selectedCount: 1,
              selectedFileCount: 1,
              selectedDirectoryCount: 0,
              directories: [],
              files: [{ sourcePath: "Archive/photo.png", archivePath: "photo.png", size: 5 }],
              failedFiles: [],
              totalBytes: 5
            }
          };
        })
      }
    });
    const pending = runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);
    await Promise.resolve();
    scopeHolder.setRegistered(false);
    resolveBatch?.();
    await pending;

    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(adapter.transfers.complete).not.toHaveBeenCalled();
    expect(adapter.transfers.fail).not.toHaveBeenCalled();
    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
  });

  it("terminalizes unowned batch work as context-changed without saving while context remains current", async () => {
    const scopeHolder = createScope();
    let resolveBatch: (() => void) | undefined;
    const batchReady = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      batch: {
        downloadSelectionAsZip: vi.fn(async () => {
          await batchReady;
          return {
            blob: new Blob(["zip"]),
            plan: {
              archiveName: "documents.zip",
              selectedCount: 1,
              selectedFileCount: 1,
              selectedDirectoryCount: 0,
              directories: [],
              files: [{ sourcePath: "Archive/photo.png", archivePath: "photo.png", size: 5 }],
              failedFiles: [],
              totalBytes: 5
            }
          };
        })
      }
    });
    const pending = runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);
    await Promise.resolve();
    scopeHolder.setOwned(false);
    resolveBatch?.();
    await pending;

    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(adapter.transfers.complete).not.toHaveBeenCalled();
    expect(adapter.transfers.fail).toHaveBeenCalledWith("transfer-1", DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
  });

  it.each(["list", "fetch", "zip"] as const)("releases the batch scope exactly once on %s errors", async (failurePoint) => {
    const scopeHolder = createScope();
    const adapter = ports({
      registry: { acquire: vi.fn(() => scopeHolder.scope) },
      files: {
        prepareDownload: vi.fn(),
        fetchBlob: vi.fn(async () => {
          if (failurePoint === "fetch") {
            throw new Error("fetch failed");
          }
          return { blob: new Blob(["file"]) };
        }),
        listFiles: vi.fn(async () => {
          if (failurePoint === "list") {
            throw new Error("list failed");
          }
          return { completeness: "complete" as const, items: [entry("notes.txt")] };
        }),
        triggerBrowserDownload: vi.fn()
      },
      batch: {
        downloadSelectionAsZip: vi.fn(async (options: BatchZipOptions) => {
          if (failurePoint === "zip") {
            throw new Error("zip failed");
          }
          await options.listFiles("Archive");
          await options.fetchFile("notes.txt");
          throw new Error(`${failurePoint} failed`);
        })
      }
    });

    await runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);

    expect(scopeHolder.scope.release).toHaveBeenCalledTimes(1);
    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it("reports plan-ready status for batch zip downloads", async () => {
    const adapter = ports();

    await runBatchDownloadOrchestration(batchInput([entry("notes.txt"), entry("Archive", true)]), adapter);

    expect(adapter.presentation.reportStatus).toHaveBeenCalledWith(
      "Preparing 1 file and 1 folder as documents.zip in Batch download workspace."
    );
    expect(adapter.files.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "documents.zip");
  });

  it("completes partial transfers and reports list errors for failed files", async () => {
    const presentationEvents: string[] = [];
    const adapter = ports({
      batch: {
        downloadSelectionAsZip: vi.fn(async (options: BatchZipOptions) => {
          const plan: BatchDownloadPlan = {
            archiveName: "documents.zip",
            selectedCount: 1,
            selectedFileCount: 0,
            selectedDirectoryCount: 1,
            directories: ["Archive"],
            files: [
              { sourcePath: "notes.txt", archivePath: "notes.txt", size: 5 },
              { sourcePath: "Archive/photo.png", archivePath: "Archive/photo.png", size: 7 }
            ],
            failedFiles: [{ sourcePath: "notes.txt", error: "Temporary sync failure." }],
            totalBytes: 12
          };
          options.onPlanReady?.(plan);
          const failure = plan.failedFiles[0];
          if (failure) {
            options.onFileFailed?.(failure);
          }
          return { blob: new Blob(["zip"]), plan };
        })
      },
      presentation: {
        reportStatus: vi.fn((message: string) => { presentationEvents.push(`status:${message}`); }),
        reportListError: vi.fn((error: Error) => { presentationEvents.push(`error:${error.message}`); })
      }
    });

    await runBatchDownloadOrchestration(batchInput([entry("Archive", true)]), adapter);

    expect(adapter.transfers.completePartial).toHaveBeenCalledWith(
      "transfer-1",
      [{ sourcePath: "notes.txt", error: "Temporary sync failure." }],
      "Downloaded 1 of 2 files; 1 failed.",
      { label: "documents.zip" }
    );
    expect(adapter.presentation.reportListError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Downloaded 1 of 2 files; 1 failed. Failed: notes.txt: Temporary sync failure."
    }));
    expect(presentationEvents.slice(-2).map((event) => event.split(":", 1)[0])).toEqual(["status", "error"]);
  });

  it("delegates a single non-folder batch entry to focused download", async () => {
    const adapter = ports();

    await runBatchDownloadOrchestration(batchInput([entry("notes.txt")]), adapter);

    expect(adapter.files.prepareDownload).toHaveBeenCalledTimes(1);
    expect(adapter.batch.downloadSelectionAsZip).not.toHaveBeenCalled();
  });

  it("fails batch downloads when context changes before browser save", async () => {
    const adapter = ports({
      batch: {
        downloadSelectionAsZip: vi.fn(async (options: BatchZipOptions) => {
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
          adapter.setContextCurrent(false);
          return { blob: new Blob(["zip"]), plan };
        })
      }
    });

    await runBatchDownloadOrchestration(batchInput([entry("notes.txt"), entry("Archive", true)]), adapter);

    expect(adapter.files.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(adapter.transfers.fail).toHaveBeenCalledWith("transfer-1", DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
  });
});
