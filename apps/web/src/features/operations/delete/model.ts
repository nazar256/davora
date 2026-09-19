import { parseNormalizedPath } from "@davora/shared";

import type { OperationContextToken } from "../policy";

declare const deleteWorkflowIdBrand: unique symbol;

export type DeleteWorkflowId = number & { readonly [deleteWorkflowIdBrand]: true };

export interface DeleteTarget {
  readonly path: string;
  readonly confirmName: string;
}

export interface BatchDeleteWorkflow {
  readonly id: DeleteWorkflowId;
  readonly submittedTargets: readonly DeleteTarget[];
  readonly unresolvedTargets: readonly DeleteTarget[];
}

function copyTarget(target: DeleteTarget): DeleteTarget {
  const path = parseNormalizedPath(target.path);
  if (!path || path !== target.path || !target.confirmName) {
    throw new Error("Delete targets require a non-root path and confirmation name.");
  }
  return { path, confirmName: target.confirmName };
}

export function createBatchDeleteWorkflow(identity: number, targets: readonly DeleteTarget[]): BatchDeleteWorkflow {
  if (!Number.isSafeInteger(identity) || identity <= 0 || targets.length === 0) {
    throw new Error("Batch delete requires a positive workflow identity and at least one target.");
  }
  const submittedTargets = targets.map(copyTarget);
  if (new Set(submittedTargets.map((target) => target.path)).size !== submittedTargets.length) {
    throw new Error("Batch delete targets must have unique paths.");
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated positive safe integers are the sole workflow-id constructor
    id: identity as DeleteWorkflowId,
    submittedTargets,
    unresolvedTargets: [...submittedTargets]
  };
}

export function planDeleteExecution(workflow: BatchDeleteWorkflow): readonly DeleteTarget[] {
  const originalIndex = new Map(workflow.submittedTargets.map((target, index) => [target.path, index]));
  return [...workflow.unresolvedTargets].sort((left, right) => {
    const depthDelta = right.path.split("/").length - left.path.split("/").length;
    return depthDelta || (originalIndex.get(left.path) ?? 0) - (originalIndex.get(right.path) ?? 0);
  });
}

export function acceptDeleteProgress(workflow: BatchDeleteWorkflow, completedTarget: DeleteTarget): BatchDeleteWorkflow {
  if (!workflow.unresolvedTargets.some((target) => target.path === completedTarget.path)) {
    throw new Error("Delete progress must reference an unresolved workflow target.");
  }
  return {
    ...workflow,
    unresolvedTargets: workflow.unresolvedTargets.filter((target) => target.path !== completedTarget.path)
  };
}

export type ActionDialogSnapshot =
  | { readonly kind: "createFolder"; readonly value: string; readonly context: OperationContextToken }
  | { readonly kind: "delete"; readonly workflow: BatchDeleteWorkflow; readonly context: OperationContextToken };

export const CREATE_FOLDER_EMPTY_VALUE_ERROR = "Provide a value before continuing.";

export const DELETE_CONFIRM_MISMATCH_ERROR = "Name to confirm does not match the selected item.";

const DELETE_CONFIRM_MISMATCH_PATTERN = /Delete confirmation does not match/i;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildCreateFolderActionDialogState(
  context: OperationContextToken,
  value = "New folder"
): Extract<ActionDialogSnapshot, { kind: "createFolder" }> {
  return { kind: "createFolder", value, context };
}

export function buildDeleteActionDialogState(
  context: OperationContextToken,
  workflow: BatchDeleteWorkflow
): Extract<ActionDialogSnapshot, { kind: "delete" }> {
  return { kind: "delete", workflow, context };
}

export function validateCreateFolderSubmitValue(value: string):
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly message: string } {
  if (!value.trim()) {
    return { kind: "invalid", message: CREATE_FOLDER_EMPTY_VALUE_ERROR };
  }
  return { kind: "valid" };
}

export function isDeleteConfirmationMismatch(message: string): boolean {
  return DELETE_CONFIRM_MISMATCH_PATTERN.test(message);
}

export function mapDeleteActionError(message: string): string {
  return isDeleteConfirmationMismatch(message) ? DELETE_CONFIRM_MISMATCH_ERROR : message;
}

export function mapActionDialogSubmitError(dialog: ActionDialogSnapshot, error: unknown): string {
  if (dialog.kind === "delete" && error instanceof Error && isDeleteConfirmationMismatch(error.message)) {
    return DELETE_CONFIRM_MISMATCH_ERROR;
  }
  return error instanceof Error ? error.message : "Unable to complete this action.";
}

export function shouldReportActionDialogSubmitError(
  workflowStillCurrent: boolean,
  actionStillCurrent: boolean,
  isUnauthorized: boolean
): boolean {
  return workflowStillCurrent && actionStillCurrent && !isUnauthorized;
}

export function buildBatchDeleteSuccessStatus(
  attemptCount: number,
  accountName: string,
  singleTargetPath: string | undefined,
  toDisplayPath: (path: string) => string
): string {
  if (attemptCount === 1 && singleTargetPath !== undefined) {
    return `delete completed for ${toDisplayPath(singleTargetPath)} in ${accountName}`;
  }
  return `Deleted ${pluralize(attemptCount, "selected item")} from ${accountName}.`;
}
