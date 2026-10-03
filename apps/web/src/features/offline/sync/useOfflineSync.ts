import type { FileEntry } from "@davora/shared";
import { basename } from "@davora/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { OperationContextToken, OperationIntent } from "../../operations/policy";
import type { BatchArchiveInput, BatchSelectionCapture } from "../../operations/selection";
import type { TransferTask } from "../../transfers";
import type { RetentionAccount } from "../retention";
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
  OfflineSyncPorts,
  OfflineSyncRequestScope
} from "./orchestrationPorts";
import { toOfflineSyncRetryTask } from "./orchestrationPorts";
import {
  buildOfflineSyncBlockedMessage,
  deriveOfflineSyncRootLabels,
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

export interface RetainedSelectionRetry {
  readonly account: RetentionAccount;
  readonly entries: readonly FileEntry[];
}

interface PendingEstimateCell {
  readonly attempt: number;
  readonly abort: OfflineSyncEstimateAbortHandle;
  adopted: boolean;
  promise?: Promise<OfflineSyncPlan>;
}

interface ActiveSyncExecution {
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly context: OperationContextToken;
  readonly scope: OfflineSyncRequestScope;
  readonly cleanup: () => void;
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
  const confirmInFlightRef = useRef<{ readonly attempt: number }>();
  const executionsRef = useRef(new Map<string, ActiveSyncExecution>());

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
    const executions = executionsRef.current;
    return () => {
      aliveRef.current = false;
      const estimate = estimateRef.current;
      estimateRef.current = undefined;
      if (estimate && !estimate.adopted) {
        estimate.abort.abort();
      }
      attemptRef.current += 1;
      confirmInFlightRef.current = undefined;
      for (const execution of executions.values()) {
        execution.scope.abort();
        execution.cleanup();
      }
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

  const startConfirmedSync = useCallback(async (dialog: OfflineSyncDialogSnapshot, resumeTaskId?: string) => {
    const current = inputRef.current;
    if (!aliveRef.current || !current.isCurrentOperationHandler()
      || !current.isCurrentOperationContext(dialog.context)
      || !current.hasSession()
      || current.isCacheOnlyBlocked()
      || !current.getCacheNamespace()
      || !current.isOperationAllowed({ kind: "keepOffline", count: dialog.entries.length })) {
      return;
    }
    const accountId = current.getAccountId();
    if (!accountId) {
      return;
    }

    const attempt = attemptRef.current;
    if (confirmInFlightRef.current?.attempt === attempt) {
      const { dedupeKey } = deriveOfflineSyncRootLabels(dialog.entries);
      if (current.ports.confirm.transfers.findActiveSyncByDedupeKey(accountId, dedupeKey)) {
        current.ports.confirm.transfers.openTray();
      }
      return;
    }
    const confirmedAttempt = { attempt };
    confirmInFlightRef.current = confirmedAttempt;
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
        registerExecution: (taskId, scope) => {
          let released = false;
          const cleanup = () => {
            if (released) return;
            released = true;
            scope.signal.removeEventListener("abort", cleanup);
            if (executionsRef.current.get(taskId) === execution) executionsRef.current.delete(taskId);
            if (confirmInFlightRef.current === confirmedAttempt) confirmInFlightRef.current = undefined;
            scope.release();
          };
          const execution: ActiveSyncExecution = {
            accountId, cacheNamespace: current.getCacheNamespace()!, context: dialog.context, scope, cleanup
          };
          executionsRef.current.set(taskId, execution);
          scope.signal.addEventListener("abort", cleanup, { once: true });
          return cleanup;
        },
        ...(pendingEstimate === undefined ? {} : { pendingEstimate }),
        ...(resumeTaskId === undefined ? {} : { resumeTaskId })
      }, orchestrationPorts);
    } finally {
      if (confirmInFlightRef.current === confirmedAttempt) {
        confirmInFlightRef.current = undefined;
      }
    }
  }, [isAttemptCurrent]);

  const confirmOfflineSync = useCallback(async () => {
    const dialog = dialogStateRef.current;
    if (!dialog) {
      return;
    }
    await startConfirmedSync(dialog);
  }, [startConfirmedSync]);

  const cancel = useCallback((taskId: string) => {
    const current = inputRef.current;
    const execution = executionsRef.current.get(taskId);
    if (!execution || execution.accountId !== current.getAccountId()
      || execution.cacheNamespace !== current.getCacheNamespace()
      || !current.isCurrentOperationContext(execution.context) || !execution.scope.isOwned()) return;
    execution.scope.abort();
    execution.cleanup();
    current.ports.confirm.transfers.markCanceled(taskId);
  }, []);

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
    if (retryEntries.length === 0 || !accountId || retryTask.accountId !== accountId) {
      return;
    }
    if (!current.hasSession()) {
      current.ports.confirm.presentation.reportListError(new Error(OFFLINE_SYNC_NO_SESSION_MESSAGE));
      return;
    }
    if (current.isCacheOnlyBlocked()) {
      current.ports.confirm.presentation.reportListError(new Error(buildOfflineSyncBlockedMessage(current.isOffline())));
      return;
    }
    if (!current.isOperationAllowed({ kind: "keepOffline", count: retryEntries.length })) {
      return;
    }
    const resumeDialog: OfflineSyncDialogSnapshot = {
      context: current.getOperationContextToken(),
      entries: toEntrySnapshots(retryEntries),
      archiveInput: current.resolveArchiveInput(retryEntries),
      phase: "unknown"
    };
    void startConfirmedSync(resumeDialog, task.id);
  }, [startConfirmedSync]);

  const retryRetainedSelection = useCallback(async (selection: RetainedSelectionRetry) => {
    const current = inputRef.current;
    if (!aliveRef.current || selection.entries.length === 0
      || selection.account.accountId !== current.getAccountId()
      || selection.account.cacheNamespace !== current.getCacheNamespace()
      || !current.isCurrentOperationHandler() || !current.hasSession() || current.isCacheOnlyBlocked()
      || !current.isOperationAllowed({ kind: "keepOffline", count: selection.entries.length })) return;
    await startConfirmedSync({
      context: current.getOperationContextToken(),
      entries: toEntrySnapshots([...selection.entries]),
      archiveInput: current.resolveArchiveInput(selection.entries),
      phase: "unknown"
    });
  }, [startConfirmedSync]);

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
    retryRetainedSelection,
    cancel,
    dismiss,
    openOfflineSyncDialog,
    confirmOfflineSync,
    retryFailedOfflineSync
  };
}
