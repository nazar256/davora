import type { MutationResult } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import type { ActionDialogSnapshot, DeleteWorkflowId } from "./model";
import type { DeleteExecutionResult, DeleteProgress, DeleteRefreshResult } from "./ports";

export interface ActionDialogMutationExecuteOptions {
  readonly refreshFolder?: boolean;
  readonly successStatus?: string | false;
  readonly syncSelection?: boolean;
  readonly manageBusy?: boolean;
  readonly context: OperationContextToken;
  readonly intent: OperationIntent;
  readonly isAttemptCurrent: () => boolean;
  readonly busyOwner: MutationAttemptToken;
}

export interface ActionDialogMutationPort {
  execute(
    runner: () => Promise<MutationResult>,
    options: ActionDialogMutationExecuteOptions
  ): Promise<MutationResult>;
}

export interface ActionDialogMutationsLifecyclePort {
  begin(context: OperationContextToken, owner: MutationAttemptToken): void;
  finish(context: OperationContextToken, owner: MutationAttemptToken): void;
}

export interface ActionDialogContextPort {
  isCurrentOperationContext(context: OperationContextToken): boolean;
  isContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
}

export interface ActionDialogSessionPort {
  hasSession(): boolean;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
}

export interface ActionDialogApiPort {
  createFolder(parentPath: string, name: string): Promise<MutationResult>;
  deleteFile(targetPath: string, confirmName: string): Promise<MutationResult>;
}

export interface ActionDialogBatchPort {
  executeDeleteTarget(
    targetPath: string,
    confirmName: string,
    context: OperationContextToken,
    intent: OperationIntent,
    isAttemptCurrent: () => boolean
  ): Promise<DeleteExecutionResult>;
  acceptDeleteProgress(
    progress: DeleteProgress,
    dialog: Extract<ActionDialogSnapshot, { kind: "delete" }>,
    actionStillCurrent: () => boolean,
    attempt: MutationAttemptToken
  ): boolean;
  refreshFolder(path: string): Promise<DeleteRefreshResult>;
  isDeleteWorkflowCurrent(workflowId: DeleteWorkflowId): boolean;
}

export interface ActionDialogSelectionPort {
  clear(): void;
}

export interface ActionDialogPresentationPort {
  setActionError(message: string | undefined): void;
  setStatus(message: string): void;
  closeMobileDetails(): void;
  clearFocused(): void;
}

export interface ActionDialogLabelsPort {
  toDisplayPath(path: string): string;
}

export interface ActionDialogOrchestrationPorts {
  readonly context: ActionDialogContextPort;
  readonly session: ActionDialogSessionPort;
  readonly mutations: ActionDialogMutationsLifecyclePort;
  readonly mutation: ActionDialogMutationPort;
  readonly api: ActionDialogApiPort;
  readonly batch: ActionDialogBatchPort;
  readonly selection: ActionDialogSelectionPort;
  readonly presentation: ActionDialogPresentationPort;
  readonly labels: ActionDialogLabelsPort;
}

export interface ActionDialogOpenerPorts {
  closeNavigation(): void;
  closeMobileDetails(): void;
  setActionError(message: string | undefined): void;
  pushActionSurface(): void;
  showMobileActions(): void;
  openActionDialog(state: ActionDialogSnapshot): void;
}

export interface ActionDialogPorts {
  readonly opener: ActionDialogOpenerPorts;
  readonly submit: ActionDialogOrchestrationPorts;
}
