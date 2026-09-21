import { useCallback, useMemo, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { TransferFailure } from "../../transfers";
import { executeBatchCopyMove } from "./controller";
import {
  buildBatchCopyMoveCanceledStatus,
  buildBatchCopyMovePartialStatus,
  buildBatchCopyMoveSuccessStatus,
  buildCopyMoveOperationLabel,
  buildCopyMoveSkippedStatus
} from "./model";
import type {
  BatchCopyMoveOperation,
  BatchCopyMoveOutcome,
  BatchCopyMoveTarget,
  CopyMoveItemStatus
} from "./model";
import type { CopyMoveBatchTargetPort, TargetExecutionResult } from "./ports";

export const DEFAULT_COPY_MOVE_MAX_RETRIES = 3;
export const DEFAULT_COPY_MOVE_RETRY_DELAY_MS = 250;

export interface CopyMoveTaskSpec {
  readonly operation: BatchCopyMoveOperation;
  readonly targets: readonly BatchCopyMoveTarget[];
  readonly skipped: readonly FileEntry[];
  readonly applySizeRule: boolean;
  readonly destinationPath: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly context: OperationContextToken;
  readonly intent: OperationIntent;
  readonly label: string;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

export interface CopyMoveTaskScope {
  readonly signal?: AbortSignal;
  isCurrent(): boolean;
  release(): void;
}

export interface CopyMoveTaskRegistryPort {
  acquire(input: { context: OperationContextToken; intent: OperationIntent }): CopyMoveTaskScope | undefined;
}

export interface CopyMoveTaskTransferPort {
  createId(): string;
  enqueueCopyMove(input: {
    id: string;
    accountId: string;
    kind: "copy" | "move";
    label: string;
    totalItems: number;
  }): void;
  beginTransfer(id: string): void;
  reportItemProgress(id: string, settledItems: number, totalItems: number): void;
  reportItemFailure(id: string, failure: TransferFailure): void;
  complete(id: string): void;
  completePartial(id: string, failures: readonly TransferFailure[], message: string): void;
  fail(id: string, message: string): void;
  markCanceled(id: string, message?: string): void;
}

export interface CopyMoveTaskSelectionPort {
  removeDeletedPath(path: string): void;
  removeDeletedFocusedPath(path: string): void;
}

export interface CopyMoveTaskPorts {
  readonly registry: CopyMoveTaskRegistryPort;
  readonly transfers: CopyMoveTaskTransferPort;
  readonly batch: CopyMoveBatchTargetPort;
  readonly folder: { getCurrentPath(): string };
  readonly selection: CopyMoveTaskSelectionPort;
  readonly presentation: { setStatus(message: string): void };
  readonly labels: { toDisplayPath(path: string): string };
  readonly context: {
    getOperationContextToken(): OperationContextToken;
    getAccountId(): string | undefined;
  };
  readonly wait: (delayMs: number) => Promise<void>;
  readonly createAbortHandle: () => { readonly signal: AbortSignal; abort(): void };
}

const taskTargetKey = (sourcePath: string, destinationPath: string) => JSON.stringify([sourcePath, destinationPath]);

export interface TaskItemLedger {
  readonly addDiscovered: (count: number) => void;
  readonly recordSettle: (item: { sourcePath: string; destinationPath: string; status: CopyMoveItemStatus }) => void;
  readonly settledCount: () => number;
  readonly totalCount: () => number;
  readonly topLevelStatus: (sourcePath: string, destinationPath: string) => CopyMoveItemStatus | undefined;
}

function createTaskItemLedger(spec: CopyMoveTaskSpec): TaskItemLedger {
  let total = spec.targets.length + spec.skipped.length;
  let settled = 0;
  const topLevelStatuses = new Map<string, CopyMoveItemStatus>();
  const topLevelKeys = new Set(
    spec.targets.map((target) => taskTargetKey(target.source.path, target.destinationPath))
  );

  return {
    addDiscovered: (count) => {
      total += count;
    },
    recordSettle: (item) => {
      settled += 1;
      const key = taskTargetKey(item.sourcePath, item.destinationPath);
      if (topLevelKeys.has(key)) {
        topLevelStatuses.set(key, item.status);
      }
    },
    settledCount: () => settled,
    totalCount: () => total,
    topLevelStatus: (sourcePath, destinationPath) => topLevelStatuses.get(taskTargetKey(sourcePath, destinationPath))
  };
}

const TASK_INTERRUPTED = Symbol("copy-move-task-interrupted");

/**
 * Runs one copy/move task in the background on a path-independent operation
 * scope. Survives folder navigation; ends when the session/account is
 * replaced, the operation is superseded, or the user cancels. In-flight port
 * awaits are raced against interruption so a hung request cannot leave the
 * task non-terminal.
 */
export async function runCopyMoveTask(
  spec: CopyMoveTaskSpec,
  taskId: string,
  isCancelled: () => boolean,
  ports: CopyMoveTaskPorts,
  ledger: TaskItemLedger = createTaskItemLedger(spec),
  cancelSignal?: AbortSignal
): Promise<void> {
  let scope: CopyMoveTaskScope | undefined;
  try {
    scope = ports.registry.acquire({ context: spec.context, intent: spec.intent });
  } catch (error) {
    ports.transfers.fail(
      taskId,
      error instanceof Error && error.message ? error.message : "The task failed unexpectedly."
    );
    return;
  }
  if (!scope) {
    ports.transfers.fail(taskId, "The session changed before the task could start.");
    return;
  }

  const interruption = new Promise<typeof TASK_INTERRUPTED>((resolve) => {
    const interrupted = () => resolve(TASK_INTERRUPTED);
    if (!scope.isCurrent() || isCancelled()) {
      interrupted();
      return;
    }
    scope.signal?.addEventListener("abort", interrupted, { once: true });
    cancelSignal?.addEventListener("abort", interrupted, { once: true });
  });
  /** Awaits port work but settles as "interrupted" if the task is superseded or cancelled mid-request. */
  const interruptible = async <T extends { readonly kind: string }>(work: Promise<T>): Promise<T | { readonly kind: "interrupted" }> => {
    const settled = await Promise.race([work, interruption]);
    return settled === TASK_INTERRUPTED ? { kind: "interrupted" } : settled;
  };

  const wait = ports.wait;
  const maxRetries = spec.maxRetries ?? DEFAULT_COPY_MOVE_MAX_RETRIES;
  const retryDelayMs = spec.retryDelayMs ?? DEFAULT_COPY_MOVE_RETRY_DELAY_MS;
  const operationLabel = buildCopyMoveOperationLabel(spec.operation);

  const publishProgress = () => {
    if (scope.isCurrent()) {
      ports.transfers.reportItemProgress(taskId, ledger.settledCount(), ledger.totalCount());
    }
  };

  const stillRunning = () => scope.isCurrent() && !isCancelled();

  const executeTargetWithRetry = async (
    operation: BatchCopyMoveOperation,
    target: BatchCopyMoveTarget
  ): Promise<TargetExecutionResult> => {
    const execute = () => interruptible(ports.batch.executeCopyMoveTarget(
      operation,
      target.source.path,
      target.destinationPath,
      target.mode === "overwrite",
      spec.context,
      spec.intent,
      stillRunning
    ));
    let result = await execute();
    let attempt = 0;
    while (
      result.kind === "failed"
      && result.retryable !== false
      && attempt < maxRetries
      && stillRunning()
    ) {
      attempt += 1;
      await wait(retryDelayMs * attempt);
      if (!stillRunning()) {
        break;
      }
      result = await execute();
    }
    return result;
  };

  /** Unselect completed sources; failed/skipped/pending sources keep their selection. */
  const reconcileSelection = () => {
    for (const target of spec.targets) {
      if (ledger.topLevelStatus(target.source.path, target.destinationPath) !== "done") {
        continue;
      }
      ports.selection.removeDeletedPath(target.source.path);
      if (spec.operation === "move") {
        ports.selection.removeDeletedFocusedPath(target.source.path);
      }
    }
  };

  try {
    ports.transfers.beginTransfer(taskId);

    const outcome: BatchCopyMoveOutcome = await executeBatchCopyMove({
      operation: spec.operation,
      targets: spec.targets,
      skipped: spec.skipped,
      applySizeRule: spec.applySizeRule
    }, {
      isCurrent: scope.isCurrent,
      isCancelled,
      executeTarget: executeTargetWithRetry,
      listChildren: (path) => interruptible(ports.batch.listChildren(path, spec.context)),
      deleteFolder: (path, confirmName) => interruptible(ports.batch.deleteFolder(
        path,
        confirmName,
        spec.context,
        spec.intent,
        stillRunning
      )),
      refreshFolder: () => interruptible(ports.batch.refreshFolder(ports.folder.getCurrentPath())),
      onItemsDiscovered: (items) => {
        ledger.addDiscovered(items.length);
        publishProgress();
      },
      onItemSettled: (item) => {
        ledger.recordSettle(item);
        publishProgress();
        if (item.status === "failed" && scope.isCurrent()) {
          ports.transfers.reportItemFailure(taskId, {
            sourcePath: item.sourcePath,
            error: item.error ?? "Failed."
          });
        }
      }
    });

    if (outcome.kind === "superseded") {
      ports.transfers.fail(taskId, "The task stopped because the session changed.");
      return;
    }
    if (outcome.kind === "sessionTerminated") {
      ports.transfers.fail(taskId, "Session expired before the task finished.");
      return;
    }
    if (!scope.isCurrent()) {
      ports.transfers.fail(taskId, "The task stopped because the session changed.");
      return;
    }

    reconcileSelection();

    if (outcome.kind === "canceled") {
      const message = buildBatchCopyMoveCanceledStatus(
        spec.operation,
        outcome.completedCount,
        spec.targets.length + spec.skipped.length,
        spec.accountName
      );
      ports.transfers.markCanceled(taskId, message);
      ports.presentation.setStatus(message);
      return;
    }

    if (outcome.kind === "partial") {
      const message = buildBatchCopyMovePartialStatus(
        operationLabel,
        outcome.completedCount,
        spec.targets.length + spec.skipped.length,
        outcome.failures.length,
        spec.accountName
      );
      const transferFailures: TransferFailure[] = outcome.failures.map((failure) => ({
        sourcePath: failure.sourcePath,
        error: failure.message
      }));
      if (transferFailures.length > 0) {
        ports.transfers.completePartial(taskId, transferFailures, message);
      } else {
        ports.transfers.complete(taskId);
      }
      ports.presentation.setStatus(message);
      return;
    }

    const message = outcome.completedCount === 0 && outcome.skippedCount > 0
      ? buildCopyMoveSkippedStatus(operationLabel, outcome.skippedCount, spec.accountName)
      : buildBatchCopyMoveSuccessStatus(
          operationLabel,
          outcome.completedCount,
          spec.destinationPath,
          spec.accountName,
          ports.labels.toDisplayPath,
          outcome.skippedCount
        );
    ports.transfers.complete(taskId);
    ports.presentation.setStatus(message);
  } catch (error) {
    ports.transfers.fail(
      taskId,
      error instanceof Error && error.message ? error.message : "The task failed unexpectedly."
    );
  } finally {
    scope?.release();
  }
}

const MAX_RETAINED_TASK_SPECS = 24;

interface RetainedTaskSpec {
  readonly spec: CopyMoveTaskSpec;
  readonly ledger: TaskItemLedger;
}

export interface CopyMoveTaskRunner {
  enqueue(spec: CopyMoveTaskSpec): string;
  cancelTask(taskId: string): void;
  /** Re-runs the unfinished targets of a failed/partial/canceled task under the current context. */
  retryTask(taskId: string): void;
}

/**
 * Owns in-flight copy/move task cancellation flags and retained specs for
 * tray retry. The proxy over `portsRef` keeps every running task reading the
 * latest port implementations (session, context token, presentation).
 */
export function useCopyMoveTaskRunner(ports: CopyMoveTaskPorts): CopyMoveTaskRunner {
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const cancelFlagsRef = useRef(new Map<string, { canceled: boolean; controller: ReturnType<CopyMoveTaskPorts["createAbortHandle"]> }>());
  const retainedRef = useRef(new Map<string, RetainedTaskSpec>());

  const livePorts = useMemo<CopyMoveTaskPorts>(() => ({
    get registry() { return portsRef.current.registry; },
    get transfers() { return portsRef.current.transfers; },
    get batch() { return portsRef.current.batch; },
    get folder() { return portsRef.current.folder; },
    get selection() { return portsRef.current.selection; },
    get presentation() { return portsRef.current.presentation; },
    get labels() { return portsRef.current.labels; },
    get context() { return portsRef.current.context; },
    get wait() { return portsRef.current.wait; },
    get createAbortHandle() { return portsRef.current.createAbortHandle; }
  }), []);

  const enqueue = useCallback((spec: CopyMoveTaskSpec): string => {
    const current = portsRef.current;
    const id = current.transfers.createId();
    current.transfers.enqueueCopyMove({
      id,
      accountId: spec.accountId,
      kind: spec.operation,
      label: spec.label,
      totalItems: spec.targets.length + spec.skipped.length
    });
    const ledger = createTaskItemLedger(spec);
    const flag = { canceled: false, controller: portsRef.current.createAbortHandle() };
    cancelFlagsRef.current.set(id, flag);
    retainedRef.current.set(id, { spec, ledger });
    while (retainedRef.current.size > MAX_RETAINED_TASK_SPECS) {
      const oldest = [...retainedRef.current.keys()].find((key) => !cancelFlagsRef.current.has(key));
      if (oldest === undefined) {
        break;
      }
      retainedRef.current.delete(oldest);
    }
    void runCopyMoveTask(spec, id, () => flag.canceled, livePorts, ledger, flag.controller.signal)
      .finally(() => {
        cancelFlagsRef.current.delete(id);
      });
    return id;
  }, [livePorts]);

  const cancelTask = useCallback((taskId: string) => {
    const flag = cancelFlagsRef.current.get(taskId);
    if (flag) {
      flag.canceled = true;
      flag.controller.abort();
    }
  }, []);

  const retryTask = useCallback((taskId: string) => {
    if (cancelFlagsRef.current.has(taskId)) {
      return;
    }
    const retained = retainedRef.current.get(taskId);
    if (!retained) {
      portsRef.current.presentation.setStatus("That task can no longer be retried.");
      return;
    }
    const pendingTargets = retained.spec.targets.filter(
      (target) => retained.ledger.topLevelStatus(target.source.path, target.destinationPath) !== "done"
    );
    if (pendingTargets.length === 0) {
      portsRef.current.presentation.setStatus("Nothing left to retry.");
      return;
    }
    const current = portsRef.current;
    if (!current.context.getAccountId() || current.context.getAccountId() !== retained.spec.accountId) {
      current.presentation.setStatus("Reconnect to the original account to retry this task.");
      return;
    }
    retainedRef.current.delete(taskId);
    enqueue({
      ...retained.spec,
      targets: pendingTargets,
      skipped: [],
      context: current.context.getOperationContextToken()
    });
  }, [enqueue]);

  return { enqueue, cancelTask, retryTask };
}
