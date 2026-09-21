import type { FileEntry } from "@davora/shared";

import type { BatchCopyMoveOperation, BatchCopyMoveTarget, CopyMoveSettledItem } from "./model";

export type TargetExecutionResult =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type FolderListResult =
  | { readonly kind: "completed"; readonly entries: readonly FileEntry[] }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type FolderRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" };

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
