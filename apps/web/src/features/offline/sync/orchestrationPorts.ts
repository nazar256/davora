import type { CapabilitySet } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../../operations/policy";
import type { BatchSelectionCapture } from "../../operations/selection";
import type { TransferTask } from "../../transfers";
import type { OfflineSyncDialogSnapshot } from "./dialogModel";
import type { OfflineSyncArchiveInput, OfflineSyncJob, OfflineSyncPlan, OfflineSyncPlannedFile } from "./model";
import type { OfflineSyncActionResult, OfflineSyncExecutionFact, OfflineSyncValueResult } from "./ports";

export interface OfflineSyncRequestScope {
  readonly signal: AbortSignal;
  isRegistered(): boolean;
  isOwned(): boolean;
  release(): void;
}

export interface OfflineSyncRegistryPort {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly isValid: () => boolean;
    readonly ownership?: { readonly checkAborted: boolean };
  }): OfflineSyncRequestScope | undefined;
}

export interface OfflineSyncTransferEnqueueInput {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
  readonly totalBytes?: number;
  readonly syncRootEntries: readonly { readonly path: string; readonly name: string; readonly isFolder: boolean }[];
  readonly dedupeKey: string;
}

export interface OfflineSyncTransferPort {
  createId(): string;
  enqueue(input: OfflineSyncTransferEnqueueInput): void;
  /** Requeue a terminal task in place (clears its error/failure state); enqueues when absent. */
  requeue(input: OfflineSyncTransferEnqueueInput): void;
  beginPreparation(id: string, progress?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }): void;
  beginTransfer(
    id: string,
    details?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }
  ): void;
  reportProgress(id: string, phase: "transferring", loadedBytes: number, totalBytes?: number | null): void;
  reportFailure(id: string, failure: { readonly sourcePath: string; readonly stage: "download" | "persistence"; readonly error: string }): void;
  complete(id: string, details?: { readonly loadedBytes?: number; readonly totalBytes?: number }): void;
  completePartial(
    id: string,
    failures: readonly { readonly sourcePath: string; readonly error: string }[],
    message: string,
    details?: { readonly loadedBytes?: number; readonly totalBytes?: number }
  ): void;
  fail(id: string, message: string): void;
  openTray(): void;
  findActiveSyncByDedupeKey(accountId: string, dedupeKey: string): { readonly id: string } | undefined;
}

export interface OfflineSyncEstimatePlanPort {
  buildEstimatePlan(
    archiveInput: OfflineSyncArchiveInput,
    execution: OfflineSyncEstimateExecution
  ): Promise<OfflineSyncPlan>;
}

export interface OfflineSyncEstimateExecution {
  readonly signal: AbortSignal;
  checkStillOwned(): boolean;
}

export interface OfflineSyncEstimateAbortHandle {
  readonly signal: AbortSignal;
  abort(): void;
}

/**
 * An estimate enumeration that is still in flight when the sync is confirmed.
 * `adopt` transfers ownership from the dialog attempt to the sync scope so
 * dialog invalidation no longer aborts it; `abort` terminates it.
 */
export interface OfflineSyncPendingEstimate {
  readonly promise: Promise<OfflineSyncPlan>;
  adopt(): void;
  abort(): void;
}

export interface OfflineSyncPlanPort extends OfflineSyncEstimatePlanPort {
  resolvePlan(
    archiveInput: OfflineSyncArchiveInput,
    signal: AbortSignal,
    checkStillOwned: () => boolean
  ): Promise<OfflineSyncValueResult<OfflineSyncPlan>>;
}

export interface OfflineSyncDownloadedBlob {
  readonly blob: Blob;
  readonly filename?: string;
}

export interface OfflineSyncDownloadPort {
  fetchDownloadBlob(
    sourcePath: string,
    options: {
      readonly onProgress: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal: AbortSignal;
    }
  ): Promise<OfflineSyncDownloadedBlob>;
}

export interface OfflineSyncRetentionPort {
  beginRoot(
    job: OfflineSyncJob,
    checkStillOwned: () => boolean
  ): Promise<OfflineSyncActionResult>;
  persistRetainedFile(
    job: OfflineSyncJob,
    file: OfflineSyncPlannedFile,
    downloaded: OfflineSyncDownloadedBlob,
    signal: AbortSignal,
    checkStillOwned: () => boolean
  ): Promise<OfflineSyncActionResult>;
  completeRoot(
    job: OfflineSyncJob,
    signal: AbortSignal,
    checkStillOwned: () => boolean
  ): Promise<OfflineSyncActionResult>;
  readSummary(
    cacheNamespace: string,
    signal: AbortSignal,
    checkStillOwned: () => boolean
  ): Promise<OfflineSyncValueResult<unknown>>;
}

export interface OfflineSyncContextPort {
  isCurrentOperationContext(context: OperationContextToken, current: OperationContextToken): boolean;
  isOperationAllowed(intent: OperationIntent): boolean;
  getCurrentCapabilities(): CapabilitySet | undefined;
  capabilitiesMatch(captured: CapabilitySet): boolean;
}

export interface OfflineSyncSessionPort {
  resetActiveSession(message: string, reconnectRequired: boolean): void;
}

export interface OfflineSyncErrorPort {
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export interface OfflineSyncPresentationPort {
  setStatus(message: string): void;
  reportListError(error: Error): void;
  closeMobileDetails(): void;
  showMobileActions(): void;
  setDialog(dialog: OfflineSyncDialogSnapshot | undefined): void;
  updateDialog(
    updater: (previous: OfflineSyncDialogSnapshot | undefined) => OfflineSyncDialogSnapshot | undefined
  ): void;
  setBusy(busy: boolean): void;
}

export interface OfflineSyncSelectionPort {
  removeCaptured(capture: BatchSelectionCapture): void;
}

export interface OfflineSyncOpenOrchestrationPorts {
  readonly plan: OfflineSyncEstimatePlanPort;
  readonly presentation: Pick<
    OfflineSyncPresentationPort,
    "reportListError" | "closeMobileDetails" | "showMobileActions" | "setDialog" | "updateDialog"
  >;
  readonly context: Pick<OfflineSyncContextPort, "isCurrentOperationContext">;
}

export interface OfflineSyncConfirmOrchestrationPorts {
  readonly registry: OfflineSyncRegistryPort;
  readonly transfers: OfflineSyncTransferPort;
  readonly plan: OfflineSyncPlanPort;
  readonly download: OfflineSyncDownloadPort;
  readonly retention: OfflineSyncRetentionPort;
  readonly context: OfflineSyncContextPort;
  readonly session: OfflineSyncSessionPort;
  readonly errors: OfflineSyncErrorPort;
  readonly presentation: OfflineSyncPresentationPort;
  readonly selection: OfflineSyncSelectionPort;
}

export interface OfflineSyncPorts {
  readonly createAbortHandle: () => OfflineSyncEstimateAbortHandle;
  readonly open: OfflineSyncOpenOrchestrationPorts;
  readonly confirm: OfflineSyncConfirmOrchestrationPorts;
}

export type OfflineSyncExecutionPublish = (fact: OfflineSyncExecutionFact) => boolean;

export interface OfflineSyncRetryTask {
  readonly accountId: string;
  readonly syncRootEntries?: readonly { readonly path: string; readonly name: string; readonly isFolder: boolean }[];
  readonly failedFiles?: readonly { readonly sourcePath: string; readonly error: string }[];
}

export function toOfflineSyncRetryTask(task: TransferTask): OfflineSyncRetryTask {
  return {
    accountId: task.accountId,
    ...(task.kind === "sync" ? { syncRootEntries: task.syncRootEntries } : {}),
    ...(task.failedFiles === undefined ? {} : { failedFiles: task.failedFiles })
  };
}
