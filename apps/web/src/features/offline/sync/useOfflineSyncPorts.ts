import type { CapabilitySet, FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../../operations/policy";
import type { BatchSelectionCapture } from "../../operations/selection";
import type { TransferTask } from "../../transfers";
import { selectActiveSyncByDedupeKey } from "../../transfers";
import type { OfflineSyncDialogSnapshot } from "./dialogModel";
import type { OfflineSyncArchiveInput } from "./model";
import type {
  OfflineSyncConfirmOrchestrationPorts,
  OfflineSyncDownloadedBlob,
  OfflineSyncEstimateAbortHandle,
  OfflineSyncOpenOrchestrationPorts,
  OfflineSyncPorts
} from "./orchestrationPorts";
import {
  buildOfflineSyncPlanFromArchive,
  classifyOfflineSyncPlanError,
  type OfflineSyncErrorClassifierDeps
} from "./planAdapters";
import { createOfflineSyncRetentionPort, type OfflineSyncRetentionDeps } from "./retentionAdapters";

export interface OfflineSyncRegistrySource {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly isValid: () => boolean;
    readonly ownership?: { readonly checkAborted: boolean };
  }): {
    readonly signal: AbortSignal;
    isRegistered(): boolean;
    isOwned(): boolean;
    release(): void;
  } | undefined;
}

export interface OfflineSyncTransferDraftInput {
  readonly id: string;
  readonly accountId: string;
  readonly kind: "sync";
  readonly label: string;
  readonly totalBytes?: number;
  readonly syncRootEntries: readonly { readonly path: string; readonly name: string; readonly isFolder: boolean }[];
  readonly dedupeKey: string;
}

export interface OfflineSyncTransferSource {
  createId(): string;
  enqueue(input: OfflineSyncTransferDraftInput): void;
  requeue(input: OfflineSyncTransferDraftInput): void;
  beginPreparation(id: string, progress?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }): void;
  beginTransfer(id: string, details?: { readonly loadedBytes?: number; readonly totalBytes?: number | null }): void;
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
}

export interface OfflineSyncPresentationSource {
  setStatus(message: string): void;
  reportListError(error: Error): void;
  closeMobileDetails(): void;
  showMobileActions(): void;
  setDialog?(dialog: OfflineSyncDialogSnapshot | undefined): void;
  updateDialog?(
    updater: (previous: OfflineSyncDialogSnapshot | undefined) => OfflineSyncDialogSnapshot | undefined
  ): void;
  setBusy?(busy: boolean): void;
}

export interface OfflineSyncContextSource {
  isCurrentOperationContext(left: OperationContextToken, right: OperationContextToken): boolean;
  isOperationAllowed(intent: OperationIntent): boolean;
  getCurrentCapabilities(): CapabilitySet | undefined;
  capabilitiesMatch(captured: CapabilitySet): boolean;
}

export interface CreateOfflineSyncPortsInput {
  readonly createAbortHandle: () => OfflineSyncEstimateAbortHandle;
  readonly getToken: () => string | undefined;
  readonly getCacheNamespace: () => string | undefined;
  readonly listFiles: (path: string, token: string, signal?: AbortSignal) => Promise<{ items: FileEntry[] }>;
  readonly cacheFolder?: (namespace: string, path: string, items: FileEntry[]) => void;
  readonly fetchDownloadBlob: (
    sourcePath: string,
    token: string,
    options: {
      readonly onProgress: (loadedBytes: number, totalBytes?: number) => void;
      readonly signal: AbortSignal;
    }
  ) => Promise<OfflineSyncDownloadedBlob>;
  readonly retention: Omit<OfflineSyncRetentionDeps, "errors">;
  readonly registry: OfflineSyncRegistrySource;
  readonly transfers: OfflineSyncTransferSource;
  readonly transferTasks: readonly TransferTask[];
  readonly openTransferTray: () => void;
  readonly presentation: OfflineSyncPresentationSource;
  readonly context: OfflineSyncContextSource;
  readonly session: {
    resetActiveSession(message: string, reconnectRequired: boolean): void;
  };
  readonly selection: {
    removeCaptured(capture: BatchSelectionCapture): void;
  };
  readonly errors: OfflineSyncErrorClassifierDeps & {
    toErrorMessage(error: unknown, fallback: string): string;
  };
}

function createOfflineSyncPlanPort(input: CreateOfflineSyncPortsInput) {
  const resolvePlanDeps = (checkStillOwned: () => boolean, signal: AbortSignal) => {
    const token = input.getToken();
    if (!token) {
      throw new Error("No session available for offline sync.");
    }
    return {
      token,
      cacheNamespace: input.getCacheNamespace(),
      listFiles: input.listFiles,
      ...(input.cacheFolder ? { cacheFolder: input.cacheFolder } : {}),
      options: { signal, checkStillOwned }
    };
  };

  const buildEstimatePlan = async (archiveInput: OfflineSyncArchiveInput, execution: { readonly signal: AbortSignal; checkStillOwned(): boolean }) => {
    const token = input.getToken();
    if (!token) {
      throw new Error("No session available for offline sync.");
    }
    return buildOfflineSyncPlanFromArchive(archiveInput, {
      token,
      cacheNamespace: input.getCacheNamespace(),
      listFiles: input.listFiles,
      ...(input.cacheFolder ? { cacheFolder: input.cacheFolder } : {})
    }, execution);
  };

  return {
    buildEstimatePlan,
    resolvePlan: async (
      archiveInput: OfflineSyncArchiveInput,
      signal: AbortSignal,
      checkStillOwned: () => boolean
    ) => {
      try {
        const { token, cacheNamespace, listFiles, cacheFolder, options } = resolvePlanDeps(checkStillOwned, signal);
        return {
          kind: "success" as const,
          value: await buildOfflineSyncPlanFromArchive(archiveInput, {
            token,
            cacheNamespace,
            listFiles,
            ...(cacheFolder ? { cacheFolder } : {})
          }, options)
        };
      } catch (error) {
        return classifyOfflineSyncPlanError(error, "Unable to prepare offline sync.", checkStillOwned, signal, input.errors);
      }
    }
  };
}

export function createOfflineSyncPorts(input: CreateOfflineSyncPortsInput): OfflineSyncPorts {
  const plan = createOfflineSyncPlanPort(input);
  const openPresentation: OfflineSyncOpenOrchestrationPorts["presentation"] = {
    reportListError: input.presentation.reportListError,
    closeMobileDetails: input.presentation.closeMobileDetails,
    showMobileActions: input.presentation.showMobileActions,
    setDialog: input.presentation.setDialog ?? (() => undefined),
    updateDialog: input.presentation.updateDialog ?? (() => undefined)
  };
  const open: OfflineSyncOpenOrchestrationPorts = {
    plan: { buildEstimatePlan: plan.buildEstimatePlan },
    presentation: openPresentation,
    context: {
      isCurrentOperationContext: input.context.isCurrentOperationContext
    }
  };
  const confirm: OfflineSyncConfirmOrchestrationPorts = {
    registry: {
      acquire: ({ context, isValid, ownership }) => {
        const scope = input.registry.acquire({ context, isValid, ownership });
        if (!scope) {
          return undefined;
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
      enqueue: (enqueueInput) => {
        input.transfers.enqueue({
          id: enqueueInput.id,
          accountId: enqueueInput.accountId,
          kind: "sync",
          label: enqueueInput.label,
          totalBytes: enqueueInput.totalBytes,
          syncRootEntries: enqueueInput.syncRootEntries,
          dedupeKey: enqueueInput.dedupeKey
        });
      },
      requeue: (requeueInput) => {
        input.transfers.requeue({
          id: requeueInput.id,
          accountId: requeueInput.accountId,
          kind: "sync",
          label: requeueInput.label,
          totalBytes: requeueInput.totalBytes,
          syncRootEntries: requeueInput.syncRootEntries,
          dedupeKey: requeueInput.dedupeKey
        });
      },
      beginPreparation: (id, progress) => {
        input.transfers.beginPreparation(id, progress);
      },
      beginTransfer: (id, details) => {
        input.transfers.beginTransfer(id, details);
      },
      reportProgress: (id, _phase, loadedBytes, totalBytes) => {
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
      },
      openTray: input.openTransferTray,
      findActiveSyncByDedupeKey: (accountId, dedupeKey) => {
        const existing = selectActiveSyncByDedupeKey(input.transferTasks, accountId, dedupeKey);
        return existing ? { id: existing.id } : undefined;
      }
    },
    plan,
    download: {
      fetchDownloadBlob: (sourcePath, options) => {
        const token = input.getToken();
        if (!token) {
          return Promise.reject(new Error("No session available for offline sync."));
        }
        return input.fetchDownloadBlob(sourcePath, token, options);
      }
    },
    retention: createOfflineSyncRetentionPort({
      ...input.retention,
      errors: input.errors
    }),
    context: {
      isCurrentOperationContext: input.context.isCurrentOperationContext,
      isOperationAllowed: input.context.isOperationAllowed,
      getCurrentCapabilities: input.context.getCurrentCapabilities,
      capabilitiesMatch: input.context.capabilitiesMatch
    },
    session: {
      resetActiveSession: input.session.resetActiveSession
    },
    errors: input.errors,
    presentation: {
      ...input.presentation,
      setDialog: input.presentation.setDialog ?? (() => undefined),
      updateDialog: input.presentation.updateDialog ?? (() => undefined),
      setBusy: input.presentation.setBusy ?? (() => undefined)
    },
    selection: input.selection
  };
  return {
    createAbortHandle: input.createAbortHandle,
    open,
    confirm
  };
}
