import type { BatchCopyMoveFailure, BatchCopyMoveInput, BatchCopyMoveOutcome } from "./model";
import type { BatchCopyMovePorts } from "./ports";

function outcome(
  kind: BatchCopyMoveOutcome["kind"],
  input: BatchCopyMoveInput,
  completedCount: number,
  failures: readonly BatchCopyMoveFailure[]
): BatchCopyMoveOutcome {
  return { kind, completedCount, totalCount: input.targets.length, failures: [...failures] };
}

export async function executeBatchCopyMove(
  input: BatchCopyMoveInput,
  ports: BatchCopyMovePorts
): Promise<BatchCopyMoveOutcome> {
  let completedCount = 0;
  const failures: BatchCopyMoveFailure[] = [];

  for (const target of input.targets) {
    if (!ports.isCurrent()) {
      return outcome("superseded", input, completedCount, failures);
    }

    const result = await ports.executeTarget(input.operation, target);
    if (!ports.isCurrent()) {
      return outcome("superseded", input, completedCount, failures);
    }

    if (result.kind === "sessionTerminated") {
      return outcome("sessionTerminated", input, completedCount, failures);
    }
    if (result.kind === "failed") {
      failures.push({ target, message: result.message });
    } else {
      completedCount += 1;
    }
  }

  if (!ports.isCurrent()) {
    return outcome("superseded", input, completedCount, failures);
  }
  const refreshResult = await ports.refreshFolder();
  if (!ports.isCurrent()) {
    return outcome("superseded", input, completedCount, failures);
  }
  if (refreshResult.kind === "sessionTerminated") {
    return outcome("sessionTerminated", input, completedCount, failures);
  }

  return outcome(failures.length > 0 ? "partial" : "completed", input, completedCount, failures);
}
