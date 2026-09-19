import type { RetainedRootInput, RetainedSnapshot, RetentionAccount } from "./model";
import type { RetainedFilePersistence, RetentionPreviewRead, RetentionPreviewWrite, RetentionRepository, RetentionResult } from "./ports";

export type RetentionCommand =
  | { readonly kind: "readSnapshot"; readonly account: RetentionAccount }
  | { readonly kind: "readPreview"; readonly account: RetentionAccount; readonly path: string }
  | { readonly kind: "writePreview"; readonly account: RetentionAccount; readonly input: RetentionPreviewWrite }
  | { readonly kind: "beginRoot"; readonly account: RetentionAccount; readonly root: RetainedRootInput }
  | { readonly kind: "persistRetainedFile"; readonly account: RetentionAccount; readonly input: RetainedFilePersistence }
  | { readonly kind: "completeRoot"; readonly account: RetentionAccount; readonly rootId: string }
  | { readonly kind: "removeRoot"; readonly account: RetentionAccount; readonly rootId: string }
  | { readonly kind: "clearNormalCache"; readonly account: RetentionAccount }
  | { readonly kind: "configureNormalCacheLimit"; readonly account: RetentionAccount; readonly limitBytes: number };

export interface RetentionControllerCallbacks {
  isCurrent(): boolean;
  publish(snapshot: RetainedSnapshot): boolean;
}

export type RetentionCommandOutcome =
  | { readonly kind: "completed"; readonly snapshot?: RetainedSnapshot; readonly preview?: RetentionPreviewRead }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "superseded" };

function completed(result: RetentionResult<RetainedSnapshot>, callbacks: RetentionControllerCallbacks): RetentionCommandOutcome {
  if (result.kind === "failure") {
    return { kind: "failed", message: result.message };
  }
  return callbacks.publish(result.value) && callbacks.isCurrent()
    ? { kind: "completed", snapshot: result.value }
    : { kind: "superseded" };
}

export async function executeRetentionCommand(
  command: RetentionCommand,
  repository: RetentionRepository,
  callbacks: RetentionControllerCallbacks
): Promise<RetentionCommandOutcome> {
  if (!callbacks.isCurrent()) {
    return { kind: "superseded" };
  }

  switch (command.kind) {
    case "readSnapshot":
      return executeSnapshotCommand(repository.readSnapshot(command.account), callbacks);
    case "readPreview":
      return executePreviewCommand(repository.readPreview(command.account, command.path), callbacks);
    case "writePreview":
      return executeSnapshotCommand(repository.writePreview(command.account, command.input), callbacks);
    case "beginRoot":
      return executeSnapshotCommand(repository.beginRoot(command.account, command.root), callbacks);
    case "persistRetainedFile":
      return executeSnapshotCommand(repository.persistRetainedFile(command.account, command.input), callbacks);
    case "completeRoot":
      return executeSnapshotCommand(repository.completeRoot(command.account, command.rootId), callbacks);
    case "removeRoot":
      return executeSnapshotCommand(repository.removeRoot(command.account, command.rootId), callbacks);
    case "clearNormalCache":
      return executeSnapshotCommand(repository.clearNormalCache(command.account), callbacks);
    case "configureNormalCacheLimit":
      return executeSnapshotCommand(repository.configureNormalCacheLimit(command.account, command.limitBytes), callbacks);
  }
}

async function executeSnapshotCommand(
  resultPromise: Promise<RetentionResult<RetainedSnapshot>>,
  callbacks: RetentionControllerCallbacks
): Promise<RetentionCommandOutcome> {
  const result = await resultPromise;
  if (!callbacks.isCurrent()) {
    return { kind: "superseded" };
  }
  return completed(result, callbacks);
}

async function executePreviewCommand(
  resultPromise: Promise<RetentionResult<RetentionPreviewRead | undefined>>,
  callbacks: RetentionControllerCallbacks
): Promise<RetentionCommandOutcome> {
  const result = await resultPromise;
  if (!callbacks.isCurrent()) {
    return { kind: "superseded" };
  }
  return result.kind === "failure"
    ? { kind: "failed", message: result.message }
    : { kind: "completed", ...(result.value ? { preview: result.value } : {}) };
}
