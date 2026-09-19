import type { OfflineSyncJob, OfflineSyncPlan, OfflineSyncPlannedFile } from "./model";
import type {
  OfflineSyncCancellationReason,
  OfflineSyncExecutionFact,
  OfflineSyncExecutionPorts,
  OfflineSyncValueResult
} from "./ports";

export interface OfflineSyncFileFailure {
  readonly sourcePath: string;
  readonly stage: "download" | "persistence";
  readonly error: string;
}

export type OfflineSyncSummaryResult<TSummary> =
  | { readonly kind: "notAttempted" }
  | { readonly kind: "success"; readonly value: TSummary }
  | { readonly kind: "failed"; readonly error: string };

interface OfflineSyncOutcomeFacts<TSummary> {
  readonly completedFiles: readonly OfflineSyncPlannedFile[];
  readonly failures: readonly OfflineSyncFileFailure[];
  readonly persistedBytes: number;
  readonly totalBytes?: number;
  readonly summary: OfflineSyncSummaryResult<TSummary>;
}

export type OfflineSyncExecutionOutcome<TSummary> =
  | (OfflineSyncOutcomeFacts<TSummary> & { readonly kind: "completed" })
  | (OfflineSyncOutcomeFacts<TSummary> & { readonly kind: "partial" })
  | (OfflineSyncOutcomeFacts<TSummary> & {
      readonly kind: "failed";
      readonly phase: "planning" | "rootCompletion";
      readonly message: string;
    })
  | (OfflineSyncOutcomeFacts<TSummary> & {
      readonly kind: "sessionTerminated";
      readonly reason: "unauthorized" | "reconnectRequired";
      readonly message: string;
    })
  | (OfflineSyncOutcomeFacts<TSummary> & { readonly kind: "cancelled"; readonly reason: OfflineSyncCancellationReason });

const notAttempted = { kind: "notAttempted" } as const;

export async function executeOfflineSync<TDownloaded, TSummary>(
  job: OfflineSyncJob,
  ports: OfflineSyncExecutionPorts<TDownloaded, TSummary>
): Promise<OfflineSyncExecutionOutcome<TSummary>> {
  const completedFiles: OfflineSyncPlannedFile[] = [];
  const failures: OfflineSyncFileFailure[] = [];
  let persistedBytes = 0;
  let displayBytes = 0;
  let totalBytes: number | undefined = job.planSource.kind === "acceptedPlan" ? job.planSource.plan.totalBytes : undefined;

  const facts = (summary: OfflineSyncSummaryResult<TSummary> = notAttempted): OfflineSyncOutcomeFacts<TSummary> => Object.freeze({
    completedFiles: Object.freeze([...completedFiles]),
    failures: Object.freeze(failures.map((failure) => Object.freeze({ ...failure }))),
    persistedBytes,
    ...(totalBytes === undefined ? {} : { totalBytes }),
    summary
  });
  const ownership = () => ports.signal.aborted
    ? ({ kind: "cancelled", reason: "aborted" } as const)
    : ports.checkOwnership(job);
  const cancelled = (reason: OfflineSyncCancellationReason) => ({ kind: "cancelled" as const, reason, ...facts() });
  const checkCurrent = (): OfflineSyncExecutionOutcome<TSummary> | undefined => {
    const result = ownership();
    return result.kind === "cancelled" ? cancelled(result.reason) : undefined;
  };
  const publish = (fact: OfflineSyncExecutionFact): OfflineSyncExecutionOutcome<TSummary> | undefined => {
    const before = checkCurrent();
    if (before) {
      return before;
    }
    if (!ports.publish(fact)) {
      return cancelled("superseded");
    }
    return checkCurrent();
  };
  const terminalFromPort = <T>(result: OfflineSyncValueResult<T> | { readonly kind: "success" }) => {
    if (result.kind === "sessionTerminal") {
      return { kind: "sessionTerminated" as const, reason: result.reason, message: result.message, ...facts() };
    }
    if (result.kind === "cancelled") {
      return cancelled(result.reason);
    }
    return undefined;
  };

  const initial = checkCurrent() ?? publish({ kind: "preparing", ...(totalBytes === undefined ? {} : { totalBytes }) });
  if (initial) {
    return initial;
  }

  let plan: OfflineSyncPlan;
  if (job.planSource.kind === "acceptedPlan") {
    plan = job.planSource.plan;
  } else {
    const resolved = await ports.resolvePlan(job.planSource.archiveInput, ports.signal);
    const replaced = checkCurrent();
    if (replaced) {
      return replaced;
    }
    if (resolved.kind === "ordinaryFailure") {
      return { kind: "failed", phase: "planning", message: resolved.message, ...facts() };
    }
    if (resolved.kind !== "success") {
      return terminalFromPort(resolved)!;
    }
    plan = resolved.value;
    totalBytes = plan.totalBytes;
  }

  const transferring = publish({ kind: "transferring", ...(totalBytes === undefined ? {} : { totalBytes }) });
  if (transferring) {
    return transferring;
  }

  const recordFailure = (file: OfflineSyncPlannedFile, stage: OfflineSyncFileFailure["stage"], error: string) => {
    const failure = Object.freeze({ sourcePath: file.sourcePath, stage, error });
    failures.push(failure);
    return publish({ kind: "fileFailure", failure });
  };

  for (const file of plan.files) {
    const beforeDownload = checkCurrent();
    if (beforeDownload) {
      return beforeDownload;
    }
    const downloaded = await ports.download(file, (loadedBytes) => {
      const current = checkCurrent();
      if (current) {
        return false;
      }
      const inFlightBytes = Math.max(0, loadedBytes);
      displayBytes = Math.max(displayBytes, persistedBytes + inFlightBytes);
      return publish({
        kind: "progress",
        sourcePath: file.sourcePath,
        persistedBytes,
        inFlightBytes,
        displayBytes,
        ...(totalBytes === undefined ? {} : { totalBytes })
      }) === undefined;
    }, ports.signal);
    const afterDownload = checkCurrent();
    if (afterDownload) {
      return afterDownload;
    }
    if (downloaded.kind === "ordinaryFailure") {
      const publication = recordFailure(file, "download", downloaded.message);
      if (publication) {
        return publication;
      }
      continue;
    }
    if (downloaded.kind !== "success") {
      return terminalFromPort(downloaded)!;
    }

    const beforePersist = checkCurrent();
    if (beforePersist) {
      return beforePersist;
    }
    const persisted = await ports.persistOffline(job, file, downloaded.value.value, ports.signal);
    const afterPersist = checkCurrent();
    if (afterPersist) {
      return afterPersist;
    }
    if (persisted.kind === "ordinaryFailure") {
      const publication = recordFailure(file, "persistence", persisted.message);
      if (publication) {
        return publication;
      }
      continue;
    }
    if (persisted.kind !== "success") {
      return terminalFromPort(persisted)!;
    }

    completedFiles.push(file);
    persistedBytes += file.size ?? downloaded.value.byteSize;
    displayBytes = Math.max(displayBytes, persistedBytes);
    const progress = publish({
      kind: "progress",
      sourcePath: file.sourcePath,
      persistedBytes,
      inFlightBytes: 0,
      displayBytes,
      ...(totalBytes === undefined ? {} : { totalBytes })
    });
    if (progress) {
      return progress;
    }
  }

  let rootFailure: string | undefined;
  if (failures.length === 0) {
    const beforeRoot = checkCurrent();
    if (beforeRoot) {
      return beforeRoot;
    }
    const marked = await ports.markRootComplete(job, ports.signal);
    const afterRoot = checkCurrent();
    if (afterRoot) {
      return afterRoot;
    }
    if (marked.kind === "ordinaryFailure") {
      rootFailure = marked.message;
    } else if (marked.kind !== "success") {
      return terminalFromPort(marked)!;
    }
  }

  let summary: OfflineSyncSummaryResult<TSummary> = notAttempted;
  if (!rootFailure || completedFiles.length > 0) {
    const beforeSummary = checkCurrent();
    if (beforeSummary) {
      return beforeSummary;
    }
    const refreshed = await ports.readSummary(job.cacheNamespace, ports.signal);
    const afterSummary = checkCurrent();
    if (afterSummary) {
      return afterSummary;
    }
    if (refreshed.kind === "ordinaryFailure") {
      summary = Object.freeze({ kind: "failed", error: refreshed.message });
    } else if (refreshed.kind !== "success") {
      return terminalFromPort(refreshed)!;
    } else {
      summary = Object.freeze({ kind: "success", value: refreshed.value });
    }
  }

  if (rootFailure) {
    return { kind: "failed", phase: "rootCompletion", message: rootFailure, ...facts(summary) };
  }
  return failures.length > 0
    ? { kind: "partial", ...facts(summary) }
    : { kind: "completed", ...facts(summary) };
}
