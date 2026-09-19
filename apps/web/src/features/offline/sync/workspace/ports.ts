import type { FileEntry } from "@davora/shared";

import type { RetentionCommand, RetentionCommandOutcome, RetentionAccount } from "../../retention";
import type { OperationAuthority } from "../../../operations/workspace";
import type { BatchSelectionCapture } from "../../../operations/selection";
import type { TransferTask, TransfersController } from "../../../transfers";
import type { OfflineSyncWorkspaceContext, OfflineSyncWorkspaceCommands } from "./model";

export type { OfflineSyncWorkspaceContext, OfflineSyncWorkspaceCommands } from "./model";

export interface OfflineSyncRuntimePort {
  createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
  createTransferId(): string;
  listFiles(path: string, token: string, signal?: AbortSignal): Promise<{ readonly items: FileEntry[] }>;
  fetchDownloadBlob(
    path: string,
    token: string,
    options?: { readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void; readonly signal?: AbortSignal }
  ): Promise<{ readonly blob: Blob; readonly filename?: string }>;
  readBlobText(blob: Blob): Promise<string>;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export interface OfflineSyncWorkspaceSelection {
  currentFocused(): FileEntry | undefined;
  removeCaptured(capture: BatchSelectionCapture): void;
}

export interface OfflineSyncWorkspaceRetention {
  getActiveAccount(): { readonly id: string; readonly cacheNamespace: string } | undefined;
  toRetentionAccount(account: { readonly id: string; readonly cacheNamespace: string }): RetentionAccount;
  executeSnapshotCommand(
    command: Exclude<RetentionCommand, { readonly kind: "readPreview" }>,
    operationIsCurrent?: () => boolean
  ): Promise<RetentionCommandOutcome>;
}

export interface OfflineSyncWorkspaceTransfers {
  readonly controller: Pick<TransfersController, "enqueue" | "beginPreparation" | "beginTransfer" | "reportProgress" | "reportFailure" | "complete" | "completePartial" | "fail">;
  readonly tasks: readonly TransferTask[];
}

export interface OfflineSyncWorkspaceCoordination {
  resetActiveSession(message: string, reconnectRequired?: boolean): void;
  openTransferTray(): void;
  closeMobileDetails(): void;
  showMobileActions(): void;
  setStatus(message: string): void;
  reportListError(error: Error): void;
  writeFolderCache(namespace: string, path: string, items: FileEntry[]): void;
  formatStorageBytes(value: number): string;
}

export interface OfflineSyncWorkspaceInput {
  readonly context: OfflineSyncWorkspaceContext;
  readonly authority: Pick<OperationAuthority,
    | "token"
    | "environment"
    | "registry"
    | "isOperationAllowed"
    | "isCurrentOperationHandler"
    | "isCurrentOperationContext"
    | "getCurrentOperationContextToken"
    | "getCurrentCapabilities"
    | "capabilitiesMatch"
  >;
  readonly selection: OfflineSyncWorkspaceSelection;
  readonly retention: OfflineSyncWorkspaceRetention;
  readonly transfers: OfflineSyncWorkspaceTransfers;
  readonly coordination: OfflineSyncWorkspaceCoordination;
  readonly runtime: OfflineSyncRuntimePort;
}

export interface OfflineSyncWorkspaceOutput {
  readonly snapshot: {
    readonly busy: boolean;
    readonly dialog?: import("../dialogModel").OfflineSyncDialogSnapshot;
  };
  readonly commands: OfflineSyncWorkspaceCommands;
  readonly stage: import("../confirm").OfflineSyncConfirmStageProps;
}
