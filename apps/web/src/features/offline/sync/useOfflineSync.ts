import type { FileEntry } from "@davora/shared";
import { basename } from "@davora/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { OperationContextToken, OperationIntent } from "../../operations/policy";
import type { BatchArchiveInput, BatchSelectionCapture } from "../../operations/selection";
import type { TransferTask } from "../../transfers";
import type { OfflineSyncDialogSnapshot } from "./dialogModel";
import { snapshotOfflineSyncEntry } from "./dialogModel";
import type { OfflineSyncArchiveInput, OfflineSyncPlan } from "./model";
import {
  runOfflineSyncConfirmOrchestration,
  runOfflineSyncOpenOrchestration
} from "./orchestration";
import type {
  OfflineSyncEstimateAbortHandle,
  OfflineSyncEstimateExecution,
  OfflineSyncPendingEstimate,
  OfflineSyncPorts
} from "./orchestrationPorts";
import { toOfflineSyncRetryTask } from "./orchestrationPorts";
import {
  buildOfflineSyncBlockedMessage,
  OFFLINE_SYNC_NO_SESSION_MESSAGE
} from "./presentation";

export interface UseOfflineSyncInput {
  isCurrentOperationHandler(): boolean;
  hasSession(): boolean;
  isCacheOnlyBlocked(): boolean;
  isOffline(): boolean;
  isOperationAllowed(intent: OperationIntent): boolean;
  getOperationContextToken(): OperationContextToken;
  getCurrentOperationContextToken(): OperationContextToken;
  isCurrentOperationContext(context: OperationContextToken): boolean;
  currentFocusedSelection(): FileEntry | undefined;
  getAccountId(): string | undefined;
  getAccountName(): string;
  getCacheNamespace(): string | undefined;
  /** Token observed by the owner. Changes invalidate the current attempt. */
  operationContextToken?: OperationContextToken;
  /** Additional account/path/mode identity that must invalidate an attempt. */
  lifecycleKey?: string;
  currentPath?: string;
  resolveArchiveInput(
    entries: readonly FileEntry[],
    archiveInput?: BatchArchiveInput
  ): OfflineSyncArchiveInput;
  ports: OfflineSyncPorts;
}

interface PendingEstimateCell {
  readonly attempt: number;
  readonly abort: OfflineSyncEstimateAbortHandle;
  adopted: boolean;
  promise?: Promise<OfflineSyncPlan>;
}

function toEntrySnapshots(entries: readonly FileEntry[]) {
  return entries.map((entry) => snapshotOfflineSyncEntry({
    path: entry.path,
    name: entry.name,
    isFolder: entry.isFolder,
    ...(entry.size === undefined ? {} : { size: entry.size })
  }));
}

export function useOfflineSync(input: UseOfflineSyncInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const [dialog, setDialogState] = useState<OfflineSyncDialogSnapshot>();
  const [busy, setBusyState] = useState(false);
  const aliveRef = useRef(true);
  const attemptRef = useRef(0);
  const estimateRef = useRef<PendingEstimateCell | undefined>();
  const confirmInFlightRef = useRef<number | undefined>();

  const invalidate = useCallback(() => {
    const estimate = estimateRef.current;
    estimateRef.current = undefined;
    if (estimate && !estimate.adopted) {
      estimate.abort.abort();
    }
    attemptRef.current += 1;
    confirmInFlightRef.current = undefined;
    setDialogState(undefined);
    setBusyState(false);
  }, []);

  const currentContext = input.operationContextToken ?? input.getCurrentOperationContextToken();
  const observedLifecycleKey = input.lifecycleKey ?? [
    input.currentPath ?? "",
    input.getAccountId() ?? "",
    input.getCacheNamespace() ?? "",
    input.isOffline() ? "offline" : "online"
  ].join("|");
  useLayoutEffect(() => {
    invalidate();
    return () => undefined;
  }, [currentContext, observedLifecycleKey, invalidate]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const estimate = estimateRef.current;
      estimateRef.current = undefined;
      if (estimate && !estimate.adopted) {
        estimate.abort.abort();
      }
      attemptRef.current += 1;
      confirmInFlightRef.current = undefined;
    };
  }, []);

  const isAttemptCurrent = useCallback((attempt: number, context: OperationContextToken) => {
    const current = inputRef.current;
    return aliveRef.current
      && attemptRef.current === attempt
      && current.isCurrentOperationHandler()
      && current.isCurrentOperationContext(context);
  }, []);

  const setAttemptDialog = useCallback((attempt: number, context: OperationContextToken, next: OfflineSyncDialogSnapshot | undefined) => {
    if (!isAttemptCurrent(attempt, context)) {
      return;
    }
    setDialogState(next);
    inputRef.current.ports.open.presentation.setDialog(next);
  }, [isAttemptCurrent]);

  const updateAttemptDialog = useCallback((attempt: number, context: OperationContextToken, updater: (previous: OfflineSyncDialogSnapshot | undefined) => OfflineSyncDialogSnapshot | undefined) => {
    if (!isAttemptCurrent(attempt, context)) {
      return;
    }
    setDialogState((previous) => {
      if (!isAttemptCurrent(attempt, context)) {
        return previous;
      }
      return updater(previous);
    });
  }, [isAttemptCurrent]);

  const openOfflineSyncDialog = useCallback(async (
    entries: FileEntry[],
    archiveInput?: BatchArchiveInput,
    selectionCapture?: BatchSelectionCapture
  ) => {
    const current = inputRef.current;
    if (!current.isCurrentOperationHandler()) {
      return;
    }
    const selectedEntry = current.currentFocusedSelection();
    const selectedEntries = entries.length > 0 ? entries : selectedEntry ? [selectedEntry] : [];
    if (!current.hasSession()) {
      current.ports.open.presentation.reportListError(new Error(OFFLINE_SYNC_NO_SESSION_MESSAGE));
      return;
    }
    if (current.isCacheOnlyBlocked()) {
      current.ports.open.presentation.reportListError(new Error(buildOfflineSyncBlockedMessage(current.isOffline())));
      return;
    }
    if (selectedEntries.length === 0) {
      return;
    }
    if (!current.isOperationAllowed({ kind: "keepOffline", count: selectedEntries.length })) {
      return;
    }

    const capturedContext = current.getOperationContextToken();
    const resolvedArchiveInput = current.resolveArchiveInput(selectedEntries, archiveInput);

    const previousEstimate = estimateRef.current;
    estimateRef.current = undefined;
    if (previousEstimate && !previousEstimate.adopted) {
      previousEstimate.abort.abort();
    }
    const attempt = ++attemptRef.current;
    const estimateAbort = current.ports.createAbortHandle();
    const estimate: PendingEstimateCell = { attempt, abort: estimateAbort, adopted: false };
    estimateRef.current = estimate;
    confirmInFlightRef.current = undefined;
    const estimateExecution = {
      signal: estimateAbort.signal,
      checkStillOwned: () => estimate.adopted
        ? aliveRef.current && !estimateAbort.signal.aborted
        : aliveRef.current
          && attemptRef.current === attempt
          && !estimateAbort.signal.aborted
          && current.isCurrentOperationHandler()
          && current.isCurrentOperationContext(capturedContext)
    };
    const orchestrationPorts = {
      ...current.ports.open,
      plan: {
        buildEstimatePlan: (archiveInput: OfflineSyncArchiveInput, execution: OfflineSyncEstimateExecution) => {
          const promise = current.ports.open.plan.buildEstimatePlan(archiveInput, execution);
          estimate.promise = promise;
          return promise;
        }
      },
      presentation: {
        ...current.ports.open.presentation,
        setDialog: (next: OfflineSyncDialogSnapshot | undefined) => setAttemptDialog(attempt, capturedContext, next),
        updateDialog: (updater: (previous: OfflineSyncDialogSnapshot | undefined) => OfflineSyncDialogSnapshot | undefined) => updateAttemptDialog(attempt, capturedContext, updater)
      }
    };

    await runOfflineSyncOpenOrchestration({
      context: capturedContext,
      currentContext: current.getCurrentOperationContextToken(),
      entries: toEntrySnapshots(selectedEntries),
      archiveInput: resolvedArchiveInput,
      selectionCapture,
      estimateAbort: estimateAbort,
      estimateExecution
    }, orchestrationPorts);
  }, [setAttemptDialog, updateAttemptDialog]);

  const confirmOfflineSync = useCallback(async () => {
    const current = inputRef.current;
    const dialog = inputRef.current ? dialogStateRef.current : undefined;
    if (!dialog || !current.isCurrentOperationHandler()
      || !current.isCurrentOperationContext(dialog.context)
      || !current.hasSession()
      || !current.getCacheNamespace()
      || !current.isOperationAllowed({ kind: "keepOffline", count: dialog.entries.length })) {
      return;
    }
    const accountId = current.getAccountId();
    if (!accountId) {
      return;
    }

    const attempt = attemptRef.current;
    if (confirmInFlightRef.current === attempt) {
      return;
    }
    confirmInFlightRef.current = attempt;
    const pendingCell = estimateRef.current;
    const pendingEstimate: OfflineSyncPendingEstimate | undefined = pendingCell?.attempt === attempt && pendingCell.promise
      ? {
          promise: pendingCell.promise,
          adopt: () => { pendingCell.adopted = true; },
          abort: () => pendingCell.abort.abort()
        }
      : undefined;
    const orchestrationPorts = {
      ...current.ports.confirm,
      presentation: {
        ...current.ports.confirm.presentation,
        setDialog: (next: OfflineSyncDialogSnapshot | undefined) => {
          if (isAttemptCurrent(attempt, dialog.context)) {
            setDialogState(next);
            current.ports.confirm.presentation.setDialog(next);
          }
        },
        setBusy: (next: boolean) => {
          if (isAttemptCurrent(attempt, dialog.context)) {
            setBusyState(next);
            current.ports.confirm.presentation.setBusy(next);
          }
        }
      }
    };

    try {
      await runOfflineSyncConfirmOrchestration({
        dialog,
        currentContext: current.getCurrentOperationContextToken(),
        accountId,
        accountName: current.getAccountName(),
        cacheNamespace: current.getCacheNamespace()!,
        ...(pendingEstimate === undefined ? {} : { pendingEstimate })
      }, orchestrationPorts);
    } finally {
      if (confirmInFlightRef.current === attempt) {
        confirmInFlightRef.current = undefined;
      }
    }
  }, [isAttemptCurrent]);

  const retryFailedOfflineSync = useCallback((task: TransferTask) => {
    const current = inputRef.current;
    if (!current.isCurrentOperationHandler()) {
      return;
    }
    const retryTask = toOfflineSyncRetryTask(task);
    const retryEntries = retryTask.syncRootEntries?.length
      ? retryTask.syncRootEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        isFolder: entry.isFolder
      } satisfies FileEntry))
      : retryTask.failedFiles?.map((failure) => ({
      path: failure.sourcePath,
      name: basename(failure.sourcePath),
      isFolder: false
    } satisfies FileEntry)) ?? [];
    const accountId = current.getAccountId();
    if (retryEntries.length > 0
      && accountId
      && retryTask.accountId === accountId
      && current.isOperationAllowed({ kind: "keepOffline", count: retryEntries.length })) {
      void openOfflineSyncDialog(retryEntries);
    }
  }, [openOfflineSyncDialog]);

  const dismiss = useCallback(() => {
    invalidate();
    inputRef.current.ports.open.presentation.setDialog(undefined);
    inputRef.current.ports.confirm.presentation.setDialog(undefined);
    inputRef.current.ports.confirm.presentation.setBusy(false);
  }, [invalidate]);

  const dialogStateRef = useRef<OfflineSyncDialogSnapshot | undefined>(undefined);
  dialogStateRef.current = dialog;

  return {
    dialog,
    busy,
    open: openOfflineSyncDialog,
    confirm: confirmOfflineSync,
    retry: retryFailedOfflineSync,
    dismiss,
    openOfflineSyncDialog,
    confirmOfflineSync,
    retryFailedOfflineSync
  };
}
