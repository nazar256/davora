import { assertNever } from "@davora/shared";

import type { OperationIntent } from "../../operations/policy";
import { executeOfflineSync } from "./controller";
import {
  createEstimatingOfflineSyncDialog,
  snapshotOfflineSyncArchiveInput,
  snapshotOfflineSyncSelectionCapture,
  type OfflineSyncDialogSnapshot
} from "./dialogModel";
import { createOfflineSyncJob, type OfflineSyncArchiveInput, type OfflineSyncEntrySnapshot } from "./model";
import {
  buildOfflineSyncAlreadyRunningStatus,
  buildOfflineSyncCompletedStatus,
  buildOfflineSyncPartialStatus,
  buildOfflineSyncPartialTransferMessage,
  buildOfflineSyncStartedStatus,
  deriveOfflineSyncRootLabels,
  OFFLINE_SYNC_CONTEXT_CHANGED_MESSAGE,
  OFFLINE_SYNC_ESTIMATE_ERROR_FALLBACK,
  OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE,
  OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE,
  OFFLINE_SYNC_SUPERSEDED_MESSAGE
} from "./presentation";
import type {
  OfflineSyncConfirmOrchestrationPorts,
  OfflineSyncEstimateAbortHandle,
  OfflineSyncEstimateExecution,
  OfflineSyncOpenOrchestrationPorts,
  OfflineSyncPendingEstimate
} from "./orchestrationPorts";
import type { OfflineSyncValueResult } from "./ports";

export interface OfflineSyncOpenInput {
  readonly context: import("../../operations/policy").OperationContextToken;
  readonly currentContext: import("../../operations/policy").OperationContextToken;
  readonly entries: readonly OfflineSyncEntrySnapshot[];
  readonly archiveInput: OfflineSyncArchiveInput;
  readonly selectionCapture?: OfflineSyncDialogSnapshot["selectionCapture"];
  readonly estimateAbort: OfflineSyncEstimateAbortHandle;
  readonly estimateExecution: OfflineSyncEstimateExecution;
}

export interface OfflineSyncConfirmInput {
  readonly dialog: OfflineSyncDialogSnapshot;
  readonly currentContext: import("../../operations/policy").OperationContextToken;
  readonly accountId: string;
  readonly accountName: string;
  readonly cacheNamespace: string;
  readonly pendingEstimate?: OfflineSyncPendingEstimate;
  /** Terminal task being retried: requeued in place so its error clears immediately. */
  readonly resumeTaskId?: string;
}

export async function runOfflineSyncOpenOrchestration(
  input: OfflineSyncOpenInput,
  ports: OfflineSyncOpenOrchestrationPorts
): Promise<void> {
  const { context: capturedContext, entries: selectedEntries } = input;
  const resolvedArchiveInput = snapshotOfflineSyncArchiveInput(input.archiveInput);
  const selectionCapture = input.selectionCapture === undefined
    ? undefined
    : snapshotOfflineSyncSelectionCapture(input.selectionCapture);

  ports.presentation.closeMobileDetails();
  ports.presentation.showMobileActions();
  ports.presentation.setDialog(createEstimatingOfflineSyncDialog({
    context: capturedContext,
    entries: selectedEntries,
    archiveInput: resolvedArchiveInput,
    selectionCapture
  }));

  try {
    const plan = await ports.plan.buildEstimatePlan(resolvedArchiveInput, input.estimateExecution);
    if (!input.estimateExecution.checkStillOwned()) {
      return;
    }
    ports.presentation.updateDialog((previous) => previous
      && ports.context.isCurrentOperationContext(previous.context, capturedContext)
      && ports.context.isCurrentOperationContext(capturedContext, input.currentContext)
      ? {
          context: capturedContext,
          entries: selectedEntries,
          archiveInput: resolvedArchiveInput,
          selectionCapture,
          phase: plan.totalBytes === undefined ? "unknown" : "ready",
          plan
        }
      : previous);
  } catch (error) {
    if (!input.estimateExecution.checkStillOwned()) {
      return;
    }
    ports.presentation.updateDialog((previous) => previous
      && ports.context.isCurrentOperationContext(previous.context, capturedContext)
      && ports.context.isCurrentOperationContext(capturedContext, input.currentContext)
      ? {
          context: capturedContext,
          entries: selectedEntries,
          archiveInput: resolvedArchiveInput,
          selectionCapture,
          phase: "unknown",
          error: error instanceof Error ? error.message : OFFLINE_SYNC_ESTIMATE_ERROR_FALLBACK
        }
      : previous);
  }
}

export async function runOfflineSyncConfirmOrchestration(
  input: OfflineSyncConfirmInput,
  ports: OfflineSyncConfirmOrchestrationPorts
): Promise<void> {
  const { dialog: offlineSyncDialog, accountId, accountName, cacheNamespace } = input;
  const selectedEntries = offlineSyncDialog.entries;
  const { rootKind, rootPath, rootName, offlineFolderRoots, dedupeKey } = deriveOfflineSyncRootLabels(selectedEntries);

  const existingSync = ports.transfers.findActiveSyncByDedupeKey(accountId, dedupeKey);
  if (existingSync) {
    ports.presentation.setDialog(undefined);
    ports.presentation.setBusy(false);
    ports.transfers.openTray();
    ports.presentation.setStatus(buildOfflineSyncAlreadyRunningStatus(rootName));
    return;
  }

  const syncIntent: OperationIntent = { kind: "keepOffline", count: selectedEntries.length };
  const capturedCapabilities = ports.context.getCurrentCapabilities();
  const scope = ports.registry.acquire({
    context: offlineSyncDialog.context,
    isValid: () => capturedCapabilities !== undefined
      && ports.context.capabilitiesMatch(capturedCapabilities)
      && ports.context.isOperationAllowed(syncIntent),
    ownership: { checkAborted: true }
  });
  if (!scope) {
    return;
  }

  // Acquire ownership before publishing a transfer. A context replacement
  // between the dialog click and this point must not leave a stale queued task.
  if (!scope.isOwned()) {
    scope.release();
    return;
  }

  const pendingEstimate = offlineSyncDialog.plan === undefined ? input.pendingEstimate : undefined;
  if (pendingEstimate) {
    pendingEstimate.adopt();
    const abortEstimate = () => pendingEstimate.abort();
    if (scope.signal.aborted) {
      abortEstimate();
    } else {
      scope.signal.addEventListener("abort", abortEstimate, { once: true });
    }
  }

  const transferId = input.resumeTaskId ?? ports.transfers.createId();
  ports.presentation.setBusy(true);
  const transferDraft = {
    id: transferId,
    accountId,
    label: rootName,
    totalBytes: offlineSyncDialog.plan?.totalBytes,
    syncRootEntries: selectedEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      isFolder: entry.isFolder
    })),
    dedupeKey
  };
  if (input.resumeTaskId === undefined) {
    ports.transfers.enqueue(transferDraft);
  } else {
    ports.transfers.requeue(transferDraft);
  }
  ports.presentation.setDialog(undefined);
  ports.presentation.setBusy(false);
  ports.transfers.openTray();
  ports.presentation.setStatus(buildOfflineSyncStartedStatus(rootName, accountName));

  const syncStillOwned = () => scope.isOwned()
    && ports.context.isCurrentOperationContext(offlineSyncDialog.context, input.currentContext);

  let acceptedPlan = offlineSyncDialog.plan;
  if (!acceptedPlan && pendingEstimate) {
    ports.transfers.beginPreparation(transferId, { loadedBytes: 0 });
    const awaited = await pendingEstimate.promise.then(
      (plan) => ({ kind: "resolved" as const, plan }),
      () => ({ kind: "failed" as const })
    );
    if (!syncStillOwned()) {
      ports.transfers.fail(transferId, OFFLINE_SYNC_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    if (awaited.kind === "resolved") {
      acceptedPlan = awaited.plan;
    }
  }

  const syncJob = createOfflineSyncJob({
    id: ports.transfers.createId(),
    accountId,
    cacheNamespace,
    root: { path: rootPath, name: rootName, kind: rootKind, folderRoots: offlineFolderRoots },
    selectedEntries: selectedEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      isFolder: entry.isFolder,
      ...(entry.size === undefined ? {} : { size: entry.size })
    })),
    planSource: acceptedPlan
      ? {
          kind: "acceptedPlan",
          plan: {
            files: acceptedPlan.files.map((file) => ({
              sourcePath: file.sourcePath,
              ...(file.size === undefined ? {} : { size: file.size })
            })),
            ...(acceptedPlan.totalBytes === undefined ? {} : { totalBytes: acceptedPlan.totalBytes })
          }
        }
      : { kind: "resolvePlan", archiveInput: offlineSyncDialog.archiveInput }
  });

  const classifyError = <T,>(
    error: unknown,
    fallback: string
  ): Exclude<OfflineSyncValueResult<T>, { readonly kind: "success" }> => {
    if (!syncStillOwned()) {
      return { kind: "cancelled", reason: scope.signal.aborted ? "aborted" : "superseded" };
    }
    if (ports.errors.isUnauthorized(error)) {
      return { kind: "sessionTerminal", reason: "unauthorized", message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE };
    }
    if (ports.errors.isReconnectRequired(error)) {
      return { kind: "sessionTerminal", reason: "reconnectRequired", message: OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE };
    }
    return { kind: "ordinaryFailure", message: ports.errors.toErrorMessage(error, fallback) };
  };
  try {
    const began = await ports.retention.beginRoot(syncJob, syncStillOwned);
    if (began.kind === "ordinaryFailure") {
      throw new Error(began.message);
    }
    if (began.kind !== "success") {
      return;
    }

    const outcome = await executeOfflineSync(syncJob, {
      signal: scope.signal,
      checkOwnership: () => syncStillOwned()
        ? { kind: "current" }
        : { kind: "cancelled", reason: scope.signal.aborted ? "aborted" : "superseded" },
      resolvePlan: async (archiveInput, signal) => ports.plan.resolvePlan(
        archiveInput,
        signal,
        syncStillOwned
      ),
      download: async (file, onProgress, signal) => {
        try {
          const response = await ports.download.fetchDownloadBlob(file.sourcePath, {
            onProgress: (loadedBytes, totalBytes) => onProgress(loadedBytes, totalBytes),
            signal
          });
          return { kind: "success", value: { value: response, byteSize: response.blob.size } };
        } catch (error) {
          return classifyError(error, "Unable to sync this file.");
        }
      },
      persistOffline: async (job, file, response, signal) => ports.retention.persistRetainedFile(
        job,
        file,
        response,
        signal,
        syncStillOwned
      ),
      readRetainedMembers: async (job, signal) => ports.retention.readRetainedMembers(job, signal, syncStillOwned),
      markRootComplete: async (job, signal) => ports.retention.completeRoot(job, signal, syncStillOwned),
      readSummary: async (namespace, signal) => ports.retention.readSummary(namespace, signal, syncStillOwned),
      publish: (fact) => {
        if (!syncStillOwned()) {
          return false;
        }
        switch (fact.kind) {
          case "preparing":
            ports.transfers.beginPreparation(transferId, { loadedBytes: 0, totalBytes: fact.totalBytes });
            break;
          case "transferring":
            ports.transfers.beginTransfer(transferId, { loadedBytes: 0, totalBytes: fact.totalBytes });
            break;
          case "progress":
            ports.transfers.reportProgress(transferId, "transferring", fact.displayBytes, fact.totalBytes);
            break;
          case "fileFailure":
            ports.transfers.reportFailure(transferId, fact.failure);
            break;
          default:
            assertNever(fact, "offline sync execution fact");
        }
        return syncStillOwned();
      }
    });

    if (!scope.isRegistered()) {
      return;
    }
    if (outcome.kind === "cancelled") {
      ports.transfers.fail(transferId, OFFLINE_SYNC_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    if (outcome.kind === "sessionTerminated") {
      ports.session.resetActiveSession(outcome.message, outcome.reason === "reconnectRequired");
      return;
    }
    if (outcome.kind === "failed") {
      ports.transfers.fail(transferId, outcome.message);
      if (syncStillOwned()) {
        ports.presentation.reportListError(new Error(outcome.message));
      }
      return;
    }
    if (!syncStillOwned()) {
      ports.transfers.fail(transferId, OFFLINE_SYNC_CONTEXT_CHANGED_MESSAGE);
      return;
    }

    if (offlineSyncDialog.selectionCapture) {
      ports.selection.removeCaptured(offlineSyncDialog.selectionCapture);
    }
    if (outcome.kind === "partial") {
      ports.transfers.completePartial(
        transferId,
        outcome.failures,
        buildOfflineSyncPartialTransferMessage(outcome.failures.length),
        { loadedBytes: outcome.persistedBytes, totalBytes: outcome.totalBytes }
      );
      ports.presentation.setStatus(buildOfflineSyncPartialStatus(
        outcome.completedFiles.length,
        outcome.completedFiles.length + outcome.failures.length,
        accountName
      ));
    } else {
      ports.transfers.complete(transferId, { loadedBytes: outcome.persistedBytes, totalBytes: outcome.totalBytes });
      ports.presentation.setStatus(buildOfflineSyncCompletedStatus(rootName, accountName));
    }
    if (outcome.summary.kind === "failed") {
      ports.presentation.reportListError(new Error(outcome.summary.error));
    }
  } finally {
    scope.release();
  }
}

export function buildOfflineSyncSupersededError(): Error {
  return new Error(OFFLINE_SYNC_SUPERSEDED_MESSAGE);
}
