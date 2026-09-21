import type { FileEntry } from "@davora/shared";

import type { DestinationOperation, ResolvedDestinationTarget } from "../destination";
import type { OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import { executeBatchCopyMove } from "./controller";
import {
  buildBatchCopyMovePartialActionError,
  buildBatchCopyMovePartialStatus,
  buildBatchCopyMoveSuccessStatus,
  buildCopyMoveOperationLabel,
  buildCopyMoveSkippedStatus,
  deriveRetainedFailedEntries,
  mapResolvedTargets,
  shouldCloseDestinationPickerAfterSubmit,
  shouldRetainDestinationPickerAfterPartialBatch,
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
  const { operation, picker, destinationPath, targets, skipped, accountName } = input;
  const intent: OperationIntent = { kind: operation, count: picker.sourceEntries.length };
  const pickerStillCurrent = () => input.isAttemptCurrent(input.attempt)
    && ports.context.isContextAllowed(picker.context, intent);
  const operationLabel = buildCopyMoveOperationLabel(operation);

  try {
    if (targets.length === 0) {
      ports.presentation.setStatus(buildCopyMoveSkippedStatus(operationLabel, skipped.length, accountName));
      if (shouldCloseDestinationPickerAfterSubmit(pickerStillCurrent())) {
        input.completeDestination(input.attempt, picker.context);
      }
      return;
    }

    if (picker.batch || targets.length > 1 || targets.some((target) => target.merge)) {
      const sourceEntriesByPath = new Map(picker.sourceEntries.map((entry) => [entry.path, entry] as const));
      ports.mutations.begin(picker.context, input.attempt);
      let outcome: Awaited<ReturnType<typeof executeBatchCopyMove>>;
      try {
        outcome = await executeBatchCopyMove({
          operation,
          targets: mapResolvedTargets(targets),
          skipped,
          applySizeRule: input.applySizeRule
        }, {
          isCurrent: pickerStillCurrent,
          executeTarget: (targetOperation, target) => ports.batch.executeCopyMoveTarget(
            targetOperation,
            target.source.path,
            target.destinationPath,
            target.mode === "overwrite",
            picker.context,
            intent,
            pickerStillCurrent
          ),
          listChildren: (path) => ports.batch.listChildren(path, picker.context),
          deleteFolder: (path, confirmName) => ports.batch.deleteFolder(
            path,
            confirmName,
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
      if (outcome.kind === "sessionTerminated" || outcome.kind === "canceled") {
        if (shouldCloseDestinationPickerAfterSubmit(pickerStillCurrent())) {
          ports.destinationPicker.closeIfCurrent(picker.context);
        }
        return;
      }

      if (outcome.kind === "partial") {
        if (!pickerStillCurrent()) return;
        const failures = deriveRetainedFailedEntries(sourceEntriesByPath, outcome.failures);
        const retainedEntries = [...failures.map((failure) => failure.entry), ...skipped];
        const partialError = buildBatchCopyMovePartialActionError(
          operationLabel,
          outcome.completedCount,
          outcome.totalCount + outcome.skippedCount,
          failures
        );
        ports.selection.retainFailedPaths(retainedEntries.map((entry) => entry.path));
        if (shouldRetainDestinationPickerAfterPartialBatch()) {
          input.reportPartial(input.attempt, partialError, failures.map((failure) => failure.entry));
        }
        if (!pickerStillCurrent()) return;
        ports.presentation.setStatus(buildBatchCopyMovePartialStatus(
          operationLabel,
          outcome.completedCount,
          outcome.totalCount + outcome.skippedCount,
          failures.length,
          accountName
        ));
        return;
      }

      if (!pickerStillCurrent()) return;
      if (picker.batch && skipped.length > 0) {
        ports.selection.retainFailedPaths(skipped.map((entry) => entry.path));
      } else {
        ports.selection.clear();
      }
      ports.presentation.clearFocused();
      ports.presentation.closeMobileDetails();
      ports.presentation.setStatus(buildBatchCopyMoveSuccessStatus(
        operationLabel,
        outcome.completedCount,
        destinationPath,
        accountName,
        ports.labels.toDisplayPath,
        outcome.skippedCount
      ));
      input.completeDestination(input.attempt, picker.context);
      return;
    }

    const [target] = targets;
    if (!target) {
      return;
    }
    await ports.mutation.execute(
      () => ports.api.runCopyOrMove(operation, target.source.path, target.destinationPath, target.overwrite),
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
