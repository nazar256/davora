import type { FileEntry } from "@davora/shared";

import { evaluateOperationAvailability, type OperationEnvironment } from "../../../operations/policy";
import type { BatchArchiveInput, BatchSelectionCapture } from "../../../operations/selection";
import type { OfflineSyncDialogSnapshot } from "../dialogModel";
import type { OfflineSyncArchiveInput } from "../model";
import type { OfflineSyncConfirmStageProps } from "../confirm";

export interface OfflineSyncWorkspaceContext {
  readonly accountId?: string;
  readonly accountName: string;
  readonly cacheNamespace?: string;
  readonly token?: string;
  readonly sessionRevision: number;
  readonly currentPath: string;
  readonly folderLabel: string;
  readonly searchActive: boolean;
  readonly cacheOnlyMode: boolean;
  readonly browserOffline: boolean;
}

export function normalizeOfflineSyncWorkspaceContext(
  context: OfflineSyncWorkspaceContext
): OfflineSyncWorkspaceContext {
  return Object.freeze({
    accountId: context.accountId,
    accountName: context.accountName,
    cacheNamespace: context.cacheNamespace,
    token: context.token,
    sessionRevision: context.sessionRevision,
    currentPath: context.currentPath,
    folderLabel: context.folderLabel,
    searchActive: context.searchActive,
    cacheOnlyMode: context.cacheOnlyMode,
    browserOffline: context.browserOffline
  });
}

export interface OfflineSyncArchiveResolverInput {
  readonly entries: readonly FileEntry[];
  readonly archive?: BatchArchiveInput;
  readonly context: Pick<OfflineSyncWorkspaceContext, "currentPath" | "folderLabel" | "searchActive">;
}

export function resolveOfflineSyncArchiveInput(input: OfflineSyncArchiveResolverInput): OfflineSyncArchiveInput {
  if (input.archive) {
    return input.archive;
  }
  return {
    roots: input.entries.map((entry) => ({
      entry,
      archiveRoot: input.context.searchActive
        ? entry.path
        : input.context.currentPath && entry.path.startsWith(`${input.context.currentPath}/`)
          ? entry.path.slice(input.context.currentPath.length + 1)
          : entry.path
    })),
    archiveLabel: input.context.searchActive ? "search-results" : input.context.folderLabel.toLowerCase()
  };
}

export function buildOfflineSyncLifecycleKey(context: OfflineSyncWorkspaceContext): string {
  return [
    context.currentPath,
    context.accountId ?? "",
    context.cacheNamespace ?? "",
    context.sessionRevision,
    context.browserOffline ? "offline" : "online"
  ].join("|");
}

export function projectOfflineSyncCanStart(
  environment: OperationEnvironment,
  entryCount: number,
  isCurrentOperationHandler: boolean
): boolean {
  if (!isCurrentOperationHandler) {
    return false;
  }
  return evaluateOperationAvailability(environment, { kind: "keepOffline", count: entryCount }).kind === "allowed";
}

export interface OfflineSyncStageProjectionInput {
  readonly busy: boolean;
  readonly dialog?: OfflineSyncDialogSnapshot;
  readonly canStart: boolean;
  readonly formatStorageBytes: (value: number) => string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function projectOfflineSyncConfirmStage(
  input: OfflineSyncStageProjectionInput
): OfflineSyncConfirmStageProps {
  const dialog = input.dialog;
  return {
    busy: input.busy,
    canStart: input.canStart,
    estimateError: dialog?.error,
    estimating: dialog?.phase === "estimating",
    filesLabel: dialog?.plan
      ? String(dialog.plan.files.length)
      : dialog?.phase === "estimating" ? "Calculating…" : "Unknown",
    includesFolders: dialog?.entries.some((entry) => entry.isFolder) ?? false,
    onClose: input.onClose,
    onConfirm: input.onConfirm,
    open: Boolean(dialog),
    selectionLabel: dialog
      ? dialog.entries.length === 1
        ? dialog.entries[0]?.name ?? ""
        : `${dialog.entries.length} ${dialog.entries.length === 1 ? "item" : "items"}`
      : "",
    storageLabel: dialog?.plan?.totalBytes !== undefined
      ? input.formatStorageBytes(dialog.plan.totalBytes)
      : dialog?.phase === "estimating" ? "Calculating…" : "Unknown"
  };
}

export interface OfflineSyncWorkspaceCommands {
  cancel(taskId: string): void;
  retryRetainedSelection(selection: import("../useOfflineSync").RetainedSelectionRetry): Promise<void>;
  open(entries: readonly FileEntry[], archive?: BatchArchiveInput, capture?: BatchSelectionCapture): Promise<void>;
  confirm(): Promise<void>;
  dismiss(): void;
  retry(task: import("../../../transfers").TransferTask): Promise<void>;
}
