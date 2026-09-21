import type { OperationContextToken, OperationIntent } from "../policy";
import type { CopyMoveDestinationPickerInitialState } from "./model";
import type { CopyMoveTaskSpec } from "./tasks";

export interface CopyMoveContextPort {
  isCurrentOperationContext(context: OperationContextToken): boolean;
  isContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
}

export interface CopyMoveLabelsPort {
  toDisplayPath(path: string): string;
}

export interface CopyMoveTaskEnqueuePort {
  enqueue(spec: CopyMoveTaskSpec): void;
}

export interface CopyMoveOrchestrationPorts {
  readonly context: CopyMoveContextPort;
  readonly presentation: {
    setActionError(message: string | undefined): void;
    setStatus(message: string): void;
  };
  readonly labels: CopyMoveLabelsPort;
  readonly tasks: CopyMoveTaskEnqueuePort;
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
