import type { MutationResult } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationExecuteOptions } from "./ports";
import { isMutationSessionTerminated, isRetryableMutationError } from "./sessionErrors";

export type FolderLoadResult = "session-terminated" | undefined;

export type MutationExecutionResult =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string; readonly retryable?: boolean }
  | { readonly kind: "sessionTerminated" };

export type MutationRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" };

export function mapFolderLoadResult(result: FolderLoadResult): MutationRefreshResult {
  return result === "session-terminated"
    ? { kind: "sessionTerminated" }
    : { kind: "completed" };
}

export function mapMutationExecutionError(
  error: unknown,
  fallbackMessage: string
): Exclude<MutationExecutionResult, { readonly kind: "completed" }> {
  if (isMutationSessionTerminated(error)) {
    return { kind: "sessionTerminated" };
  }
  return {
    kind: "failed",
    message: error instanceof Error ? error.message : fallbackMessage
  };
}

export interface BatchMutationExecutor {
  execute(
    runner: () => Promise<MutationResult>,
    options: MutationExecuteOptions
  ): Promise<MutationResult>;
}

export const BATCH_MUTATION_EXECUTE_OPTIONS = {
  refreshFolder: false,
  successStatus: false as const,
  syncSelection: false,
  manageBusy: false
};

export async function executeBatchMutationTarget(
  hasSession: boolean,
  executor: BatchMutationExecutor,
  runner: () => Promise<MutationResult>,
  context: OperationContextToken,
  intent: OperationIntent,
  fallbackMessage: string,
  isAttemptCurrent?: () => boolean
): Promise<MutationExecutionResult> {
  if (!hasSession) {
    return { kind: "sessionTerminated" };
  }
  try {
    await executor.execute(runner, {
      ...BATCH_MUTATION_EXECUTE_OPTIONS,
      context,
      intent,
      isAttemptCurrent
    });
    return { kind: "completed" };
  } catch (error) {
    const mapped = mapMutationExecutionError(error, fallbackMessage);
    return mapped.kind === "failed"
      ? { ...mapped, retryable: isRetryableMutationError(error) }
      : mapped;
  }
}
