import type { MutationResult } from "@davora/shared";

import type { DestinationOperation } from "../destination";
import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import type { BatchCopyMoveOperation, CopyMoveDestinationPickerInitialState } from "./model";
import type { FolderListResult, FolderRefreshResult, TargetExecutionResult } from "./ports";

export interface CopyMoveMutationExecuteOptions {
  readonly refreshFolder?: boolean;
  readonly successStatus?: string | false;
  readonly syncSelection?: boolean;
  readonly manageBusy?: boolean;
  readonly context: OperationContextToken;
  readonly intent: OperationIntent;
  readonly isAttemptCurrent: () => boolean;
  readonly busyOwner: MutationAttemptToken;
}

export interface CopyMoveMutationPort {
  execute(
    runner: () => Promise<MutationResult>,
    options: CopyMoveMutationExecuteOptions
  ): Promise<MutationResult>;
}

export interface CopyMoveMutationsLifecyclePort {
  begin(context: OperationContextToken, owner: MutationAttemptToken): void;
  finish(context: OperationContextToken, owner: MutationAttemptToken): void;
}

export interface CopyMoveContextPort {
  isCurrentOperationContext(context: OperationContextToken): boolean;
  isContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
}

export interface CopyMoveSessionPort {
  hasSession(): boolean;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
}

export interface CopyMoveBatchTargetPort {
  executeCopyMoveTarget(
    operation: BatchCopyMoveOperation,
    sourcePath: string,
    destinationPath: string,
    overwrite: boolean,
    context: OperationContextToken,
    intent: OperationIntent,
    isAttemptCurrent: () => boolean
  ): Promise<TargetExecutionResult>;
  listChildren(path: string, context: OperationContextToken): Promise<FolderListResult>;
  deleteFolder(path: string, confirmName: string, context: OperationContextToken, intent: OperationIntent, isAttemptCurrent: () => boolean): Promise<TargetExecutionResult>;
  refreshFolder(path: string): Promise<FolderRefreshResult>;
}

export interface CopyMoveSelectionPort {
  retainFailedPaths(paths: readonly string[]): void;
  clear(): void;
}

export interface CopyMoveDestinationPickerPort {
  closeIfCurrent(context: OperationContextToken): void;
}

export interface CopyMovePresentationPort {
  setActionError(message: string | undefined): void;
  setStatus(message: string): void;
  closeMobileDetails(): void;
  clearFocused(): void;
}

export interface CopyMoveLabelsPort {
  toDisplayPath(path: string): string;
}

export interface CopyMoveApiPort {
  runCopyOrMove(
    operation: DestinationOperation,
    sourcePath: string,
    destinationPath: string,
    overwrite: boolean
  ): Promise<MutationResult>;
}

export interface CopyMoveOrchestrationPorts {
  readonly context: CopyMoveContextPort;
  readonly session: CopyMoveSessionPort;
  readonly mutations: CopyMoveMutationsLifecyclePort;
  readonly mutation: CopyMoveMutationPort;
  readonly api: CopyMoveApiPort;
  readonly batch: CopyMoveBatchTargetPort;
  readonly selection: CopyMoveSelectionPort;
  readonly destinationPicker: CopyMoveDestinationPickerPort;
  readonly presentation: CopyMovePresentationPort;
  readonly labels: CopyMoveLabelsPort;
}

export interface CopyMoveOpenerPorts {
  closeMobileDetails(): void;
  setActionError(message: string | undefined): void;
  pushActionSurface(): void;
  showMobileActions(): void;
  openDestinationPicker(state: CopyMoveDestinationPickerInitialState): void;
}

export interface CopyMovePorts {
  readonly opener: CopyMoveOpenerPorts;
  readonly submit: CopyMoveOrchestrationPorts;
}
