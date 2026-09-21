import type { FileEntry } from "@davora/shared";

import type { DestinationOperation, ResolvedDestinationTarget } from "../destination";
import type { OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import {
  buildCopyMoveQueuedStatus,
  buildCopyMoveTaskLabel,
  mapResolvedTargets,
  type CopyMovePickerSnapshot
} from "./model";
import type { CopyMoveOrchestrationPorts } from "./orchestrationPorts";

export interface CopyMoveSubmitInput {
  readonly operation: DestinationOperation;
  readonly picker: CopyMovePickerSnapshot;
  readonly destinationPath: string;
  readonly targets: readonly ResolvedDestinationTarget[];
  readonly skipped: readonly FileEntry[];
  readonly applySizeRule: boolean;
  readonly accountId: string | undefined;
  readonly accountName: string;
  readonly attempt: MutationAttemptToken;
  readonly completeDestination: (attempt: MutationAttemptToken, context: CopyMovePickerSnapshot["context"]) => boolean;
  readonly failAttempt: (attempt: MutationAttemptToken, error: string) => void;
}

/**
 * Enqueues the resolved copy/move plan as a background transfer task and
 * dismisses the picker. All execution — per-item retries, merge recursion,
 * refresh, and selection reconciliation — belongs to the task runner.
 */
export function runCopyMoveSubmitOrchestration(
  input: CopyMoveSubmitInput,
  ports: CopyMoveOrchestrationPorts
): void {
  const { operation, picker, destinationPath, targets, skipped } = input;
  const intent: OperationIntent = { kind: operation, count: picker.sourceEntries.length };
  if (!ports.context.isContextAllowed(picker.context, intent)) {
    input.failAttempt(input.attempt, "This action is no longer available.");
    return;
  }
  if (!input.accountId) {
    input.failAttempt(input.attempt, "This action needs an active account.");
    return;
  }
  try {
    ports.tasks.enqueue({
      operation,
      targets: mapResolvedTargets(targets),
      skipped,
      applySizeRule: input.applySizeRule,
      destinationPath,
      accountId: input.accountId,
      accountName: input.accountName,
      context: picker.context,
      intent,
      label: buildCopyMoveTaskLabel(picker.sourceEntries)
    });
  } catch (error) {
    input.failAttempt(
      input.attempt,
      error instanceof Error && error.message ? error.message : "The task could not be started."
    );
    return;
  }
  input.completeDestination(input.attempt, picker.context);
  ports.presentation.setStatus(buildCopyMoveQueuedStatus(
    operation,
    targets.length + skipped.length,
    destinationPath,
    input.accountName,
    ports.labels.toDisplayPath
  ));
}
