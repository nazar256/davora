import { acceptDeleteProgress, planDeleteExecution, type BatchDeleteWorkflow, type DeleteTarget } from "./model";
import type { BatchDeletePorts } from "./ports";

interface DeleteOutcomeBase {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly workflow: BatchDeleteWorkflow;
}

export type BatchDeleteOutcome =
  | (DeleteOutcomeBase & { readonly kind: "completed" })
  | (DeleteOutcomeBase & { readonly kind: "failed"; readonly failedTarget: DeleteTarget; readonly message: string })
  | (DeleteOutcomeBase & { readonly kind: "sessionTerminated" })
  | (DeleteOutcomeBase & { readonly kind: "superseded" });

function outcome(
  kind: "completed" | "sessionTerminated" | "superseded",
  workflow: BatchDeleteWorkflow
): BatchDeleteOutcome {
  return {
    kind,
    workflow,
    completedCount: workflow.submittedTargets.length - workflow.unresolvedTargets.length,
    totalCount: workflow.submittedTargets.length
  };
}

export async function executeBatchDelete(
  initialWorkflow: BatchDeleteWorkflow,
  ports: BatchDeletePorts
): Promise<BatchDeleteOutcome> {
  let workflow = initialWorkflow;
  for (const target of planDeleteExecution(initialWorkflow)) {
    if (!ports.isCurrent()) {
      return outcome("superseded", workflow);
    }
    const result = await ports.executeTarget(target);
    if (!ports.isCurrent()) {
      return outcome("superseded", workflow);
    }
    if (result.kind === "sessionTerminated") {
      return outcome("sessionTerminated", workflow);
    }
    if (result.kind === "failed") {
      return {
        kind: "failed",
        failedTarget: target,
        message: result.message,
        workflow,
        completedCount: workflow.submittedTargets.length - workflow.unresolvedTargets.length,
        totalCount: workflow.submittedTargets.length
      };
    }

    const nextWorkflow = acceptDeleteProgress(workflow, target);
    if (!ports.acceptProgress({ completedTarget: target, workflow: nextWorkflow })) {
      return outcome("superseded", workflow);
    }
    workflow = nextWorkflow;
    if (!ports.isCurrent()) {
      return outcome("superseded", workflow);
    }
  }

  if (!ports.isCurrent()) {
    return outcome("superseded", workflow);
  }
  const refreshResult = await ports.refreshFolder();
  if (!ports.isCurrent()) {
    return outcome("superseded", workflow);
  }
  return refreshResult.kind === "sessionTerminated"
    ? outcome("sessionTerminated", workflow)
    : outcome("completed", workflow);
}
