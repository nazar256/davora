import type { FileEntry } from "@davora/shared";

import type { BatchDownloadPlan } from "../../../lib/batchDownload";
import type { OperationContextToken, OperationIntent } from "../policy";
import type { BatchArchiveInput } from "../selection";
import { DOWNLOAD_NO_SESSION_MESSAGE } from "./model";
import type { DownloadOrchestrationPorts } from "./orchestrationPorts";

export interface DownloadRegistrySource {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly intent: OperationIntent;
  }): {
    readonly signal: AbortSignal;
    isRegistered(): boolean;
    isOwned(): boolean;
    release(): void;
  } | undefined;
}

export interface DownloadTransferSource {
  createId(): string;
  enqueue(input: {
    readonly id: string;
    readonly accountId: string;
    readonly kind: "download";
    readonly label: string;
  }): void;
  beginPreparation(id: string, progress?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }): void;
  beginTransfer(
    id: string,
    details?: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number | null }
  ): void;
  reportProgress(id: string, phase: "transferring", loadedBytes: number, totalBytes?: number | null): void;
  reportFailure(id: string, failure: { readonly sourcePath: string; readonly error: string }): void;
  complete(id: string, details?: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number }): void;
  completePartial(
    id: string,
    failures: readonly { readonly sourcePath: string; readonly error: string }[],
    message: string,
    details?: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number }
  ): void;
  fail(id: string, message: string): void;
}

export interface DownloadFileSources {
  prepareDownloadFile(
    path: string,
    token: string,
    options: {
      readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal?: AbortSignal;
    }
  ): Promise<{ readonly blob: Blob; readonly filename: string }>;
  fetchDownloadBlob(
    path: string,
    token: string,
    options?: {
      readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal?: AbortSignal;
    }
  ): Promise<{ readonly blob: Blob; readonly filename?: string }>;
  listFiles(path: string, token: string, signal?: AbortSignal): Promise<{ items: FileEntry[] }>;
  triggerBrowserDownload(blob: Blob, filename: string): void;
}

export interface DownloadBatchSource {
  downloadSelectionAsZip(options: {
    readonly roots: BatchArchiveInput["roots"];
    readonly archiveLabel: string;
    readonly listFiles: (path: string) => Promise<{ readonly items: readonly FileEntry[] }>;
    readonly fetchFile: (
      path: string,
      callbacks?: { readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void }
    ) => Promise<{ readonly blob: Blob; readonly filename?: string }>;
    readonly onPlanReady?: (plan: BatchDownloadPlan) => void;
    readonly onFileProgress?: (loadedBytes: number, totalBytes?: number) => void;
    readonly onArchiveProgress?: (percent: number) => void;
    readonly onFileFailed?: (failure: { readonly sourcePath: string; readonly error: string }) => void;
  }): Promise<{ readonly blob: Blob; readonly plan: BatchDownloadPlan }>;
}

export interface CreateDownloadPortsInput {
  readonly getToken: () => string | undefined;
  readonly files: DownloadFileSources;
  readonly batch: DownloadBatchSource;
  readonly registry: DownloadRegistrySource;
  readonly transfers: DownloadTransferSource;
  readonly context: {
    isOperationContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
  };
  readonly session: {
    resetActiveSession(message: string, reconnectRequired?: boolean): void;
  };
  readonly presentation: {
    reportStatus(message: string): void;
    reportListError(error: Error): void;
  };
  readonly errors: {
    isUnauthorized(error: unknown): boolean;
    isReconnectRequired(error: unknown): boolean;
    toErrorMessage(error: unknown, fallback: string): string;
  };
}

function rejectMissingSession(): Promise<never> {
  return Promise.reject(new Error(DOWNLOAD_NO_SESSION_MESSAGE));
}

async function requireToken(getToken: () => string | undefined): Promise<string> {
  const token = getToken();
  if (!token) {
    await rejectMissingSession();
  }
  return token!;
}

export function createDownloadPorts(input: CreateDownloadPortsInput): DownloadOrchestrationPorts {
  return {
    registry: {
      acquire: ({ context, intent }) => {
        const scope = input.registry.acquire({ context, intent });
        if (!scope) {
          throw new Error("Download abort scope was not acquired.");
        }
        return {
          signal: scope.signal,
          isRegistered: () => scope.isRegistered(),
          isOwned: () => scope.isOwned(),
          release: () => {
            scope.release();
          }
        };
      }
    },
    transfers: {
      createId: () => input.transfers.createId(),
      enqueue: ({ id, accountId, label }) => {
        input.transfers.enqueue({
          id,
          accountId,
          kind: "download",
          label
        });
      },
      beginPreparation: (id, progress) => {
        input.transfers.beginPreparation(id, progress);
      },
      beginTransfer: (id, details) => {
        input.transfers.beginTransfer(id, details);
      },
      reportProgress: (id, loadedBytes, totalBytes) => {
        input.transfers.reportProgress(id, "transferring", loadedBytes, totalBytes);
      },
      reportFailure: (id, failure) => {
        input.transfers.reportFailure(id, failure);
      },
      complete: (id, details) => {
        input.transfers.complete(id, details);
      },
      completePartial: (id, failures, message, details) => {
        input.transfers.completePartial(id, failures, message, details);
      },
      fail: (id, message) => {
        input.transfers.fail(id, message);
      }
    },
    files: {
      prepareDownload: async (path, options) => {
        return input.files.prepareDownloadFile(path, await requireToken(input.getToken), options);
      },
      fetchBlob: async (path, options) => {
        return input.files.fetchDownloadBlob(path, await requireToken(input.getToken), options);
      },
      listFiles: async (path, options) => {
        const token = await requireToken(input.getToken);
        const result = options?.signal
          ? await input.files.listFiles(path, token, options.signal)
          : await input.files.listFiles(path, token);
        return { items: result.items };
      },
      triggerBrowserDownload: input.files.triggerBrowserDownload
    },
    batch: {
      downloadSelectionAsZip: input.batch.downloadSelectionAsZip
    },
    context: {
      isCurrent: input.context.isOperationContextAllowed
    },
    session: {
      terminateExpired: (message) => {
        input.session.resetActiveSession(message);
      },
      terminateReconnectRequired: (message) => {
        input.session.resetActiveSession(message, true);
      }
    },
    errors: input.errors,
    presentation: input.presentation
  };
}
