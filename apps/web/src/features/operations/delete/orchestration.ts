import { assertNever } from "@davora/shared";

import type { OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import { executeBatchDelete } from "./controller";
import {
  buildBatchDeleteSuccessStatus,
  mapActionDialogSubmitError,
  mapDeleteActionError,
  shouldReportActionDialogSubmitError,
  validateCreateFolderSubmitValue,
  type ActionDialogSnapshot
} from "./model";
import type { ActionDialogOrchestrationPorts } from "./orchestrationPorts";

export interface ActionDialogSubmitInput {
  readonly dialog: ActionDialogSnapshot;
  readonly currentPath: string;
  readonly accountName: string;
  readonly attempt: MutationAttemptToken;
  readonly isAttemptCurrent: (attempt: MutationAttemptToken) => boolean;
  readonly failAttempt: (attempt: MutationAttemptToken, error: string) => void;
  readonly reportDeletePartial: (attempt: MutationAttemptToken, input: {
    readonly workflow: Extract<ActionDialogSnapshot, { kind: "delete" }>["workflow"];
    readonly failedTarget: Extract<ActionDialogSnapshot, { kind: "delete" }>["workflow"]["submittedTargets"][number];
    readonly completedCount: number;
    readonly totalCount: number;
    readonly error: string;
  }) => void;
  readonly completeActionDialog: (attempt: MutationAttemptToken, dialog: ActionDialogSnapshot) => boolean;
}

export async function runActionDialogSubmitOrchestration(
  input: ActionDialogSubmitInput,
  ports: ActionDialogOrchestrationPorts
): Promise<void> {
  const { dialog } = input;
  const actionIntent: OperationIntent = dialog.kind === "createFolder"
    ? { kind: "createFolder" }
    : { kind: "delete", count: dialog.workflow.unresolvedTargets.length };
  const actionStillCurrent = () => input.isAttemptCurrent(input.attempt)
    && ports.context.isContextAllowed(dialog.context, actionIntent);

  const trimmedValue = dialog.kind === "createFolder" ? dialog.value.trim() : "";
  if (dialog.kind === "createFolder") {
    const validation = validateCreateFolderSubmitValue(dialog.value);
    if (validation.kind === "invalid") {
      ports.presentation.setActionError(validation.message);
      return;
    }
  }

  try {
    switch (dialog.kind) {
      case "createFolder":
        await ports.mutation.execute(
          () => ports.api.createFolder(input.currentPath, trimmedValue),
          { context: dialog.context, intent: actionIntent, isAttemptCurrent: actionStillCurrent, busyOwner: input.attempt }
        );
        break;
      case "delete": {
        const deleteOutcome = await runDeleteSubmit(dialog, actionIntent, actionStillCurrent, input, ports);
        if (deleteOutcome === "retained" || deleteOutcome === "terminal") {
          return;
        }
        break;
      }
      default:
        assertNever(dialog, "action dialog submission");
    }
    if (actionStillCurrent()) {
      input.completeActionDialog(input.attempt, dialog);
    }
  } catch (error) {
    const workflowStillCurrent = dialog.kind !== "delete" || ports.batch.isDeleteWorkflowCurrent(dialog.workflow.id);
    if (shouldReportActionDialogSubmitError(
      workflowStillCurrent,
      actionStillCurrent(),
      ports.session.isUnauthorized(error)
    )) {
      input.failAttempt(input.attempt, mapActionDialogSubmitError(dialog, error));
    }
  }
}

type DeleteSubmitOutcome = "completed" | "retained" | "terminal";

async function runDeleteSubmit(
  dialog: Extract<ActionDialogSnapshot, { kind: "delete" }>,
  actionIntent: OperationIntent,
  actionStillCurrent: () => boolean,
  input: ActionDialogSubmitInput,
  ports: ActionDialogOrchestrationPorts
): Promise<DeleteSubmitOutcome> {
  if (dialog.workflow.unresolvedTargets.length === 0) {
    return "retained";
  }

  if (dialog.workflow.submittedTargets.length === 1) {
    const [target] = dialog.workflow.unresolvedTargets;
    if (!target) {
      return "retained";
    }
    await ports.mutation.execute(
      () => ports.api.deleteFile(target.path, target.confirmName),
      { context: dialog.context, intent: actionIntent, isAttemptCurrent: actionStillCurrent, busyOwner: input.attempt }
    );
    return "completed";
  }

  const attemptTargets = dialog.workflow.unresolvedTargets;
  ports.mutations.begin(dialog.context, input.attempt);
  try {
    const outcome = await executeBatchDelete(dialog.workflow, {
      isCurrent: actionStillCurrent,
      executeTarget: (target) => ports.batch.executeDeleteTarget(
        target.path,
        target.confirmName,
        dialog.context,
        actionIntent,
        actionStillCurrent
      ),
      acceptProgress: (progress) => ports.batch.acceptDeleteProgress(progress, dialog, actionStillCurrent, input.attempt),
      refreshFolder: () => ports.batch.refreshFolder(input.currentPath)
    });
    if (outcome.kind === "superseded" || outcome.kind === "sessionTerminated") {
      return "terminal";
    }
    if (outcome.kind === "failed") {
      const error = mapDeleteActionError(outcome.message);
      if (outcome.completedCount > 0) {
        input.reportDeletePartial(input.attempt, {
          workflow: outcome.workflow,
          failedTarget: outcome.failedTarget,
          completedCount: outcome.completedCount,
          totalCount: outcome.totalCount,
          error
        });
      } else {
        input.failAttempt(input.attempt, error);
      }
      return "retained";
    }
    if (!actionStillCurrent()) return "terminal";
    ports.selection.clear();
    ports.presentation.clearFocused();
    ports.presentation.closeMobileDetails();
    ports.presentation.setStatus(buildBatchDeleteSuccessStatus(
      attemptTargets.length,
      input.accountName,
      attemptTargets.length === 1 ? attemptTargets[0]?.path : undefined,
      ports.labels.toDisplayPath
    ));
    return "completed";
  } finally {
    ports.mutations.finish(dialog.context, input.attempt);
  }
}
