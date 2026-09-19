import type { BatchCopyMoveOperation, BatchCopyMoveTarget } from "./model";

export type TargetExecutionResult =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type FolderRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" };

export interface BatchCopyMovePorts {
  isCurrent(): boolean;
  executeTarget(operation: BatchCopyMoveOperation, target: BatchCopyMoveTarget): Promise<TargetExecutionResult>;
  refreshFolder(): Promise<FolderRefreshResult>;
}
