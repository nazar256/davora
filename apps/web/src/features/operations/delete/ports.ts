import type { BatchDeleteWorkflow, DeleteTarget } from "./model";

export type DeleteExecutionResult =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type DeleteRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" };

export interface DeleteProgress {
  readonly completedTarget: DeleteTarget;
  readonly workflow: BatchDeleteWorkflow;
}

export interface BatchDeletePorts {
  isCurrent(): boolean;
  executeTarget(target: DeleteTarget): Promise<DeleteExecutionResult>;
  acceptProgress(progress: DeleteProgress): boolean;
  refreshFolder(): Promise<DeleteRefreshResult>;
}
