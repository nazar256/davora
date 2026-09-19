import type { FileEntry } from "@davora/shared";

import type { DestinationOperation } from "../destination";
import type { OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import { executeBatchCopyMove } from "./controller";
import {
  buildBatchCopyMovePartialActionError,
  buildBatchCopyMovePartialStatus,
  buildBatchCopyMoveSuccessStatus,
  buildCopyMoveOperationLabel,
  deriveRetainedFailedEntries,
  mapBatchTargets,
  shouldCloseDestinationPickerAfterSubmit,
  shouldRetainDestinationPickerAfterPartialBatch,
  type CopyMovePickerSnapshot
} from "./model";
import type { CopyMoveOrchestrationPorts } from "./orchestrationPorts";

export interface CopyMoveSubmitInput {
  readonly operation: DestinationOperation;
  readonly picker: CopyMovePickerSnapshot;
  readonly destinationPath: string;
  readonly targets: readonly { readonly source: FileEntry; readonly destinationPath: string }[];
  readonly accountName: string;
  readonly ownerPath: string;
  readonly attempt: MutationAttemptToken;
  readonly isAttemptCurrent: (attempt: MutationAttemptToken) => boolean;
  readonly failAttempt: (attempt: MutationAttemptToken, error: string) => void;
  readonly reportPartial: (attempt: MutationAttemptToken, error: string, failedEntries: readonly FileEntry[]) => void;
  readonly completeDestination: (attempt: MutationAttemptToken, context: CopyMovePickerSnapshot["context"]) => boolean;
}

export async function runCopyMoveSubmitOrchestration(
  input: CopyMoveSubmitInput,
  ports: CopyMoveOrchestrationPorts
): Promise<void> {
  const { operation, picker, destinationPath, targets, accountName } = input;
  const intent: OperationIntent = { kind: operation, count: picker.sourceEntries.length };
  const pickerStillCurrent = () => input.isAttemptCurrent(input.attempt)
    && ports.context.isContextAllowed(picker.context, intent);

  try {
    if (picker.batch) {
      const batchTargets = targets;
      const sourceEntriesByPath = new Map(batchTargets.map((target) => [target.source.path, target.source]));
      ports.mutations.begin(picker.context, input.attempt);
      let outcome: Awaited<ReturnType<typeof executeBatchCopyMove>>;
      try {
        outcome = await executeBatchCopyMove({
          operation,
          targets: mapBatchTargets(batchTargets)
        }, {
          isCurrent: pickerStillCurrent,
          executeTarget: async (targetOperation, target) => ports.batch.executeCopyMoveTarget(
            targetOperation,
            target.sourcePath,
            target.destinationPath,
            picker.context,
            intent,
            pickerStillCurrent
          ),
          refreshFolder: () => ports.batch.refreshFolder(input.ownerPath)
        });
      } finally {
        ports.mutations.finish(picker.context, input.attempt);
      }

      if (outcome.kind === "superseded") {
        return;
      }
      if (outcome.kind === "sessionTerminated") {
        if (shouldCloseDestinationPickerAfterSubmit(pickerStillCurrent())) {
          ports.destinationPicker.closeIfCurrent(picker.context);
        }
        return;
      }

      const operationLabel = buildCopyMoveOperationLabel(operation);
      if (outcome.kind === "partial") {
        if (!pickerStillCurrent()) return;
        const failures = deriveRetainedFailedEntries(sourceEntriesByPath, outcome.failures);
        const failedEntries = failures.map((failure) => failure.entry);
        const partialError = buildBatchCopyMovePartialActionError(
          operationLabel,
          outcome.completedCount,
          outcome.totalCount,
          failures
        );
        ports.selection.retainFailedPaths(failedEntries.map((entry) => entry.path));
        if (shouldRetainDestinationPickerAfterPartialBatch()) {
          input.reportPartial(input.attempt, partialError, failedEntries);
        }
        if (!pickerStillCurrent()) return;
        ports.presentation.setStatus(buildBatchCopyMovePartialStatus(
          operationLabel,
          outcome.completedCount,
          outcome.totalCount,
          failures.length,
          accountName
        ));
        return;
      }

      if (!pickerStillCurrent()) return;
      ports.selection.clear();
      ports.presentation.clearFocused();
      ports.presentation.closeMobileDetails();
      ports.presentation.setStatus(buildBatchCopyMoveSuccessStatus(
        operationLabel,
        batchTargets.length,
        destinationPath,
        accountName,
        ports.labels.toDisplayPath
      ));
      input.completeDestination(input.attempt, picker.context);
      return;
    }

    const [selectedEntry] = picker.sourceEntries;
    if (!selectedEntry) {
      return;
    }
    await ports.mutation.execute(
      () => ports.api.runCopyOrMove(operation, selectedEntry.path, destinationPath),
      { context: picker.context, intent, isAttemptCurrent: pickerStillCurrent, busyOwner: input.attempt }
    );
    if (shouldCloseDestinationPickerAfterSubmit(pickerStillCurrent())) {
      input.completeDestination(input.attempt, picker.context);
    }
  } catch (error) {
    if (pickerStillCurrent() && !ports.session.isUnauthorized(error)) {
      input.failAttempt(input.attempt, error instanceof Error ? error.message : "Unable to complete this action.");
    }
  }
}
