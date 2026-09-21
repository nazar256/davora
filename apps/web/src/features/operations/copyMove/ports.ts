import type { FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { BatchCopyMoveOperation, BatchCopyMoveTarget, CopyMoveSettledItem } from "./model";

export type TargetExecutionResult =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string; readonly retryable?: boolean }
  | { readonly kind: "sessionTerminated" }
  | { readonly kind: "interrupted" };

export interface CopyMoveBatchTargetPort {
  executeCopyMoveTarget(
    operation: BatchCopyMoveOperation,
    sourcePath: string,
    destinationPath: string,
    overwrite: boolean,
    context: OperationContextToken,
    intent: OperationIntent,
    isAttemptCurrent: () => boolean
  ): Promise<TargetExecutionResult>;
  listChildren(path: string, context: OperationContextToken): Promise<FolderListResult>;
  deleteFolder(path: string, confirmName: string, context: OperationContextToken, intent: OperationIntent, isAttemptCurrent: () => boolean): Promise<TargetExecutionResult>;
  refreshFolder(path: string): Promise<FolderRefreshResult>;
}

export type FolderListResult =
  | { readonly kind: "completed"; readonly entries: readonly FileEntry[] }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" }
  | { readonly kind: "interrupted" };

export type FolderRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" }
  | { readonly kind: "interrupted" };

export interface BatchCopyMovePorts {
  isCurrent(): boolean;
  isCancelled?(): boolean;
  executeTarget(operation: BatchCopyMoveOperation, target: BatchCopyMoveTarget): Promise<TargetExecutionResult>;
  listChildren(path: string): Promise<FolderListResult>;
  deleteFolder(path: string, confirmName: string): Promise<TargetExecutionResult>;
  refreshFolder(): Promise<FolderRefreshResult>;
  /** Optional per-leaf progress reporting used by the background task surface. */
  onItemSettled?(item: CopyMoveSettledItem): void;
  onItemsDiscovered?(items: readonly Omit<CopyMoveSettledItem, "status" | "error">[]): void;
}
