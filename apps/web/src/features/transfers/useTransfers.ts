import { useCallback, useReducer } from "react";

import {
  createTransferLedger,
  reduceTransferLedger,
  type TransferFailure,
  type TransferFailureMessage,
  type TransferTaskDraft
} from "./model";
import type { TransferClock } from "./ports";

export function useTransfers(clock: TransferClock) {
  const [ledger, dispatch] = useReducer(reduceTransferLedger, undefined, () => createTransferLedger());

  const enqueue = useCallback((task: TransferTaskDraft) => {
    dispatch({ type: "enqueued", task, at: clock.nowIso() });
  }, [clock]);
  const beginPreparation = useCallback((id: string, progress: { readonly loadedBytes?: number; readonly totalBytes?: number | null } = {}) => {
    dispatch({ type: "preparationStarted", id, ...progress });
  }, []);
  const beginTransfer = useCallback((id: string, details: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number | null } = {}) => {
    dispatch({ type: "transferStarted", id, ...details });
  }, []);
  const reportProgress = useCallback((id: string, stage: "preparing" | "transferring", loadedBytes: number, totalBytes?: number | null) => {
    dispatch({ type: "progressReported", id, stage, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
  }, []);
  const reportItemProgress = useCallback((id: string, settledItems: number, totalItems?: number | null) => {
    dispatch({ type: "itemsProgressed", id, settledItems, ...(totalItems === undefined ? {} : { totalItems }) });
  }, []);
  const reportFailure = useCallback((id: string, failure: TransferFailure) => {
    dispatch({ type: "nonterminalFailureReported", id, failure });
  }, []);
  const complete = useCallback((id: string, details: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number } = {}) => {
    dispatch({ type: "completed", id, at: clock.nowIso(), ...details });
  }, [clock]);
  const completePartial = useCallback((id: string, failures: readonly TransferFailure[], message: string, details: { readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number } = {}) => {
    dispatch({ type: "partiallyCompleted", id, at: clock.nowIso(), failures, message, ...details });
  }, [clock]);
  const fail = useCallback((id: string, message: string) => {
    dispatch({ type: "failed", id, at: clock.nowIso(), message });
  }, [clock]);
  const markCanceled = useCallback((id: string, message?: string) => {
    dispatch({ type: "canceled", id, at: clock.nowIso(), ...(message ? { message } : {}) });
  }, [clock]);
  const failActiveForAccount = useCallback((accountId: string, message: TransferFailureMessage) => {
    dispatch({ type: "activeAccountFailed", accountId, at: clock.nowIso(), message });
  }, [clock]);
  const failActiveTasks = useCallback((ids: ReadonlySet<string>, message: string) => {
    dispatch({ type: "activeTasksFailed", ids, at: clock.nowIso(), message });
  }, [clock]);
  const clearAccountHistory = useCallback((accountId: string) => {
    dispatch({ type: "accountHistoryCleared", accountId });
  }, []);

  return {
    tasks: ledger.tasks,
    enqueue,
    beginPreparation,
    beginTransfer,
    reportProgress,
    reportItemProgress,
    reportFailure,
    complete,
    completePartial,
    fail,
    markCanceled,
    failActiveForAccount,
    failActiveTasks,
    clearAccountHistory
  } as const;
}

export type TransfersController = ReturnType<typeof useTransfers>;
