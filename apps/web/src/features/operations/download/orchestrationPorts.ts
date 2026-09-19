import type { FileEntry } from "@davora/shared";

import type { BatchDownloadFailure, BatchDownloadPlan } from "../../../lib/batchDownload";
import type { OperationContextToken, OperationIntent } from "../policy";
import type { BatchArchiveInput } from "../selection";

export interface DownloadRequestScope {
  readonly signal: AbortSignal;
  isRegistered(): boolean;
  isOwned(): boolean;
  release(): void;
}

export interface DownloadRegistryPort {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly intent: OperationIntent;
  }): DownloadRequestScope;
}

export interface DownloadTransferPort {
  createId(): string;
  enqueue(input: { readonly id: string; readonly accountId: string; readonly label: string }): void;
  beginPreparation(id: string, progress?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }): void;
  beginTransfer(
    id: string,
    details?: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number | null }
  ): void;
  reportProgress(id: string, loadedBytes: number, totalBytes?: number | null): void;
  reportFailure(id: string, failure: BatchDownloadFailure): void;
  complete(id: string, details?: { readonly label?: string }): void;
  completePartial(
    id: string,
    failures: readonly BatchDownloadFailure[],
    message: string,
    details?: { readonly label?: string }
  ): void;
  fail(id: string, message: string): void;
}

export interface DownloadFilePort {
  prepareDownload(
    path: string,
    options: {
      readonly onProgress: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal: AbortSignal;
    }
  ): Promise<{ readonly blob: Blob; readonly filename: string }>;
  fetchBlob(
    path: string,
    options?: {
      readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal?: AbortSignal;
    }
  ): Promise<{ readonly blob: Blob; readonly filename?: string }>;
  listFiles(path: string, options?: { readonly signal?: AbortSignal }): Promise<{ readonly items: readonly FileEntry[] }>;
  triggerBrowserDownload(blob: Blob, filename: string): void;
}

export interface DownloadBatchPort {
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
    readonly onFileFailed?: (failure: BatchDownloadFailure) => void;
  }): Promise<{ readonly blob: Blob; readonly plan: BatchDownloadPlan }>;
}

export interface DownloadContextPort {
  isCurrent(context: OperationContextToken, intent: OperationIntent): boolean;
}

export interface DownloadSessionPort {
  terminateExpired(message: string): void;
  terminateReconnectRequired(message: string): void;
}

export interface DownloadErrorPort {
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export interface DownloadPresentationPort {
  reportStatus(message: string): void;
  reportListError(error: Error): void;
}

export interface DownloadOrchestrationPorts {
  readonly registry: DownloadRegistryPort;
  readonly transfers: DownloadTransferPort;
  readonly files: DownloadFilePort;
  readonly batch: DownloadBatchPort;
  readonly context: DownloadContextPort;
  readonly session: DownloadSessionPort;
  readonly errors: DownloadErrorPort;
  readonly presentation: DownloadPresentationPort;
}
