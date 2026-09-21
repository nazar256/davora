export type TransferKind = "upload" | "download" | "sync" | "copy" | "move";
export type ActiveTransferPhase = "queued" | "preparing" | "transferring";
export type TerminalTransferPhase = "done" | "partial" | "error" | "canceled";
export type TransferPhase = ActiveTransferPhase | TerminalTransferPhase;

export interface TransferFailure {
  readonly sourcePath: string;
  readonly error: string;
}

export interface TransferSyncRootEntry {
  readonly path: string;
  readonly name: string;
  readonly isFolder: boolean;
}

interface TransferTaskBase {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
  readonly loadedBytes: number;
  readonly totalBytes?: number;
  /** Item-count progress for copy/move tasks (byte progress is unavailable server-side). */
  readonly settledItems?: number;
  readonly totalItems?: number;
  readonly startedAt: string;
}

type TransferIdentity =
  | { readonly kind: "upload" | "download" | "copy" | "move"; readonly dedupeKey?: never; readonly syncRootEntries?: never }
  | { readonly kind: "sync"; readonly dedupeKey: string; readonly syncRootEntries: readonly TransferSyncRootEntry[] };

type ActiveTransferState = {
  readonly phase: ActiveTransferPhase;
  readonly finishedAt?: never;
  readonly errorMessage?: string;
  readonly failedFiles?: readonly TransferFailure[];
};

type DoneTransferState = {
  readonly phase: "done";
  readonly finishedAt: string;
  readonly errorMessage?: never;
  readonly failedFiles?: never;
};

type PartialTransferState = {
  readonly phase: "partial";
  readonly finishedAt: string;
  readonly errorMessage: string;
  readonly failedFiles: readonly [TransferFailure, ...TransferFailure[]];
};

type ErrorTransferState = {
  readonly phase: "error";
  readonly finishedAt: string;
  readonly errorMessage: string;
  readonly failedFiles?: readonly TransferFailure[];
};

type CanceledTransferState = {
  readonly phase: "canceled";
  readonly finishedAt: string;
  readonly errorMessage?: string;
  readonly failedFiles?: readonly TransferFailure[];
};

export type TransferTask = TransferTaskBase & TransferIdentity & (
  | ActiveTransferState
  | DoneTransferState
  | PartialTransferState
  | ErrorTransferState
  | CanceledTransferState
);

type ActiveTransferTask = TransferTaskBase & TransferIdentity & ActiveTransferState;

interface TransferTaskDraftBase {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly totalItems?: number;
}

export type TransferTaskDraft = TransferTaskDraftBase & (
  | { readonly kind: "upload" | "download" | "copy" | "move"; readonly dedupeKey?: never; readonly syncRootEntries?: never }
  | { readonly kind: "sync"; readonly dedupeKey: string; readonly syncRootEntries: readonly TransferSyncRootEntry[] }
);

export interface TransferLedger {
  readonly tasks: readonly TransferTask[];
  readonly maxTerminal: number;
}

export type TransferFailureMessage = string | Readonly<Record<TransferKind, string>>;

export type TransferEvent =
  | { readonly type: "enqueued"; readonly at: string; readonly task: TransferTaskDraft }
  | { readonly type: "preparationStarted"; readonly id: string; readonly loadedBytes?: number; readonly totalBytes?: number | null }
  | { readonly type: "transferStarted"; readonly id: string; readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number | null }
  | { readonly type: "progressReported"; readonly id: string; readonly stage: "preparing" | "transferring"; readonly loadedBytes: number; readonly totalBytes?: number | null }
  | { readonly type: "itemsProgressed"; readonly id: string; readonly settledItems: number; readonly totalItems?: number | null }
  | { readonly type: "nonterminalFailureReported"; readonly id: string; readonly failure: TransferFailure }
  | { readonly type: "completed"; readonly id: string; readonly at: string; readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number }
  | { readonly type: "partiallyCompleted"; readonly id: string; readonly at: string; readonly failures: readonly TransferFailure[]; readonly message: string; readonly label?: string; readonly loadedBytes?: number; readonly totalBytes?: number }
  | { readonly type: "failed"; readonly id: string; readonly at: string; readonly message: string }
  | { readonly type: "canceled"; readonly id: string; readonly at: string; readonly message?: string }
  | { readonly type: "activeAccountFailed"; readonly accountId: string; readonly at: string; readonly message: TransferFailureMessage }
  | { readonly type: "activeTasksFailed"; readonly ids: ReadonlySet<string>; readonly at: string; readonly message: string }
  | { readonly type: "accountHistoryCleared"; readonly accountId: string };

export function isActiveTransferTask(task: TransferTask): task is ActiveTransferTask {
  return task.phase === "queued" || task.phase === "preparing" || task.phase === "transferring";
}

export function createTransferLedger(options: { readonly maxTerminal?: number } = {}): TransferLedger {
  return { tasks: [], maxTerminal: options.maxTerminal ?? 12 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSyncRootEntry(value: unknown): value is TransferSyncRootEntry {
  return isRecord(value)
    && typeof value.path === "string"
    && typeof value.name === "string"
    && typeof value.isFolder === "boolean";
}

export function isValidTransferTaskDraft(task: unknown): task is TransferTaskDraft {
  if (!isRecord(task)
    || typeof task.id !== "string" || !task.id
    || typeof task.accountId !== "string" || !task.accountId
    || typeof task.label !== "string" || !task.label) {
    return false;
  }
  if (task.kind === "sync") {
    return typeof task.dedupeKey === "string"
      && Boolean(task.dedupeKey)
      && Array.isArray(task.syncRootEntries)
      && task.syncRootEntries.every(isSyncRootEntry);
  }
  return (task.kind === "upload" || task.kind === "download" || task.kind === "copy" || task.kind === "move")
    && task.dedupeKey === undefined
    && task.syncRootEntries === undefined
    && (task.totalItems === undefined
      || (typeof task.totalItems === "number" && Number.isFinite(task.totalItems) && task.totalItems >= 0));
}

function retainHistory(tasks: readonly TransferTask[], maxTerminal: number): readonly TransferTask[] {
  let terminalCount = 0;
  return tasks.filter((task) => {
    if (isActiveTransferTask(task)) {
      return true;
    }
    terminalCount += 1;
    return terminalCount <= maxTerminal;
  });
}

function replaceActive(
  ledger: TransferLedger,
  id: string,
  replace: (task: ActiveTransferTask) => TransferTask
): TransferLedger {
  const index = ledger.tasks.findIndex((task) => task.id === id);
  const current = ledger.tasks[index];
  if (!current || !isActiveTransferTask(current)) {
    return ledger;
  }
  const tasks = [...ledger.tasks];
  tasks[index] = replace(current);
  return { ...ledger, tasks: retainHistory(tasks, ledger.maxTerminal) };
}

function failTask(task: ActiveTransferTask, at: string, message: string): TransferTask {
  return {
    ...task,
    phase: "error",
    finishedAt: at,
    errorMessage: message,
    ...(task.failedFiles ? { failedFiles: task.failedFiles } : {})
  };
}

function withTotalBytes(task: TransferTask, totalBytes: number | null | undefined): TransferTask {
  if (totalBytes === undefined) {
    return task;
  }
  if (totalBytes === null) {
    const { totalBytes: _totalBytes, ...withoutTotalBytes } = task;
    return withoutTotalBytes;
  }
  return { ...task, totalBytes };
}

export function reduceTransferLedger(ledger: TransferLedger, event: TransferEvent): TransferLedger {
  if (event.type === "enqueued") {
    if (!isValidTransferTaskDraft(event.task) || ledger.tasks.some((task) => task.id === event.task.id)) {
      return ledger;
    }
    const task: TransferTask = event.task.kind === "sync"
      ? {
          ...event.task,
          syncRootEntries: event.task.syncRootEntries.map((entry) => ({ ...entry })),
          loadedBytes: event.task.loadedBytes ?? 0,
          phase: "queued",
          startedAt: event.at
        }
      : {
          ...event.task,
          loadedBytes: event.task.loadedBytes ?? 0,
          phase: "queued",
          startedAt: event.at
        };
    return { ...ledger, tasks: retainHistory([task, ...ledger.tasks], ledger.maxTerminal) };
  }
  if (event.type === "accountHistoryCleared") {
    const tasks = ledger.tasks.filter((task) => task.accountId !== event.accountId || isActiveTransferTask(task));
    return tasks.length === ledger.tasks.length ? ledger : { ...ledger, tasks };
  }
  if (event.type === "activeAccountFailed" || event.type === "activeTasksFailed") {
    let changed = false;
    const tasks = ledger.tasks.map((task) => {
      const selected = event.type === "activeAccountFailed"
        ? task.accountId === event.accountId
        : event.ids.has(task.id);
      if (!selected || !isActiveTransferTask(task)) {
        return task;
      }
      changed = true;
      const message = typeof event.message === "string" ? event.message : event.message[task.kind];
      return failTask(task, event.at, message);
    });
    return changed ? { ...ledger, tasks: retainHistory(tasks, ledger.maxTerminal) } : ledger;
  }
  if (event.type === "preparationStarted") {
    return replaceActive(ledger, event.id, (task) => withTotalBytes({
      ...task,
      phase: "preparing",
      loadedBytes: event.loadedBytes ?? task.loadedBytes
    }, event.totalBytes));
  }
  if (event.type === "transferStarted") {
    return replaceActive(ledger, event.id, (task) => withTotalBytes({
      ...task,
      phase: "transferring",
      label: event.label ?? task.label,
      loadedBytes: event.loadedBytes ?? task.loadedBytes
    }, event.totalBytes));
  }
  if (event.type === "progressReported") {
    return replaceActive(ledger, event.id, (task) => withTotalBytes({
      ...task,
      phase: event.stage,
      loadedBytes: event.loadedBytes
    }, event.totalBytes));
  }
  if (event.type === "itemsProgressed") {
    return replaceActive(ledger, event.id, (task) => ({
      ...task,
      phase: task.phase === "queued" ? "transferring" : task.phase,
      settledItems: event.settledItems,
      ...(event.totalItems === undefined ? {} : { totalItems: event.totalItems ?? undefined })
    }));
  }
  if (event.type === "canceled") {
    return replaceActive(ledger, event.id, (task) => ({
      ...task,
      phase: "canceled",
      finishedAt: event.at,
      ...(event.message ? { errorMessage: event.message } : {})
    }));
  }
  if (event.type === "nonterminalFailureReported") {
    return replaceActive(ledger, event.id, (task) => ({
      ...task,
      errorMessage: `${event.failure.sourcePath}: ${event.failure.error}`,
      failedFiles: [...(task.failedFiles ?? []), { ...event.failure }]
    }));
  }
  if (event.type === "completed") {
    return replaceActive(ledger, event.id, (task) => {
      if (task.failedFiles?.length) {
        return task;
      }
      const { failedFiles: _failedFiles, errorMessage: _errorMessage, ...base } = task;
      return {
        ...base,
        phase: "done",
        finishedAt: event.at,
        label: event.label ?? task.label,
        loadedBytes: event.loadedBytes ?? task.loadedBytes,
        ...(event.totalBytes === undefined ? {} : { totalBytes: event.totalBytes })
      };
    });
  }
  if (event.type === "partiallyCompleted") {
    if (event.failures.length === 0 || !event.message) {
      return ledger;
    }
    const [firstFailure, ...remainingFailures] = event.failures;
    if (!firstFailure) {
      return ledger;
    }
    const failedFiles: [TransferFailure, ...TransferFailure[]] = [
      { ...firstFailure },
      ...remainingFailures.map((failure) => ({ ...failure }))
    ];
    return replaceActive(ledger, event.id, (task) => ({
      ...task,
      phase: "partial",
      finishedAt: event.at,
      errorMessage: event.message,
      failedFiles,
      label: event.label ?? task.label,
      loadedBytes: event.loadedBytes ?? task.loadedBytes,
      ...(event.totalBytes === undefined ? {} : { totalBytes: event.totalBytes })
    }));
  }
  if (!event.message) {
    return ledger;
  }
  return replaceActive(ledger, event.id, (task) => failTask(task, event.at, event.message));
}
