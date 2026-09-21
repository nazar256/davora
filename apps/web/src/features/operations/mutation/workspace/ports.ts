import type { FileEntry } from "@davora/shared";

import type { DestinationOperation, DestinationPickerPorts } from "../../destination";
import type { ActionDialogOpenerPorts } from "../../delete/orchestrationPorts";
import type { CopyMoveOpenerPorts } from "../../copyMove/orchestrationPorts";
import type {
  MutationApiSources,
  MutationDeleteWorkflowSources,
  MutationRegistrySource,
  MutationTransferSource
} from "../createMutationWorkflowPorts";
import type { MutationWorkflowOrchestrationPorts } from "../createMutationWorkflowPorts";
import type { MutationWorkflowState } from "../model";
import type { MutationSelectionSources } from "../createMutationWorkflowPorts";
import type { FolderLoadResult } from "../workflowAdapters";
import type { OperationContextToken, OperationEnvironment, OperationIntent } from "../../policy";

/** Runtime context shared by all mutation child controllers. */
export interface MutationWorkspaceContext {
  readonly accountId?: string;
  readonly accountName: string;
  readonly token?: string;
  readonly cacheOnlyMode: boolean;
  readonly offline: boolean;
  readonly operationMode: OperationEnvironment["mode"];
  readonly currentPath: string;
  readonly operationContextToken: OperationContextToken;
  readonly isCurrentOperationHandler: () => boolean;
  readonly hasSession: () => boolean;
  readonly isCurrentOperationContext: (
    context: OperationContextToken,
    expected?: OperationContextToken
  ) => boolean;
  readonly currentFocusedSelection?: FileEntry;
  readonly batchSelectionEntries: readonly FileEntry[];
}

export interface MutationWorkspacePolicy {
  readonly environment: OperationEnvironment;
  readonly isOperationAllowed: (intent: OperationIntent) => boolean;
  readonly selection: {
    readonly hasSelectedEntry: boolean;
    readonly selectedFilePath?: string;
    readonly selectedIsFolder: boolean;
    readonly batchSelectionCount: number;
  };
}

/** App-owned transport and lifecycle dependencies needed by useMutationWorkflow. */
export interface MutationWorkspaceWorkflowPorts {
  readonly api: MutationApiSources;
  readonly refresh: {
    getCurrentPath(): string;
    setCurrentPath(path: string): void;
    loadFolder(
      path: string,
      options?: { readonly preferCache?: boolean; readonly announceStatus?: boolean }
    ): Promise<FolderLoadResult>;
  };
  readonly registry: MutationRegistrySource;
  readonly transfers: MutationTransferSource;
  readonly session: {
    resetActiveSession(message: string, reconnectRequired?: boolean): void;
  };
  readonly deleteWorkflow?: MutationDeleteWorkflowSources;
}

export interface MutationWorkspaceActionDialogPorts extends Pick<
  ActionDialogOpenerPorts,
  "closeNavigation" | "closeMobileDetails" | "pushActionSurface" | "showMobileActions"
> {}

export interface MutationWorkspaceCopyMovePorts extends Pick<
  CopyMoveOpenerPorts,
  "closeMobileDetails" | "pushActionSurface" | "showMobileActions"
> {}

export interface MutationWorkspaceSelectionPorts extends MutationSelectionSources {
  clear(): void;
}

export interface MutationWorkspaceNavigationPorts {
  closeNavigation(): void;
  closeMobileDetails(): void;
  openMobileDetails(): void;
  pushActionSurface(): void;
  showMobileActions(): void;
  readonly isNarrowScreen: boolean;
}

export interface MutationWorkspacePresentationPorts {
  clearListError(): void;
  setActionError(message: string | undefined): void;
  setStatus(message: string): void;
  getAccountName(): string;
  toDisplayPath(path: string): string;
}

export interface MutationWorkspacePorts {
  readonly workflow: MutationWorkspaceWorkflowPorts;
  readonly destination: DestinationPickerPorts;
  readonly actionDialog: MutationWorkspaceActionDialogPorts;
  readonly copyMove: MutationWorkspaceCopyMovePorts;
  readonly selection: MutationWorkspaceSelectionPorts;
  readonly navigation: MutationWorkspaceNavigationPorts;
  readonly presentation: MutationWorkspacePresentationPorts;
}

export interface MutationWorkspaceInput {
  readonly context: MutationWorkspaceContext;
  readonly policy: MutationWorkspacePolicy;
  readonly ports: MutationWorkspacePorts;
}

export interface MutationWorkspaceBridgeSnapshot {
  readonly action: boolean;
  readonly destination: boolean;
}

export interface MutationWorkspaceBridge {
  snapshot(): MutationWorkspaceBridgeSnapshot;
  dismiss(): void;
}

export interface MutationWorkspaceStateBase {
  readonly busy: boolean;
  readonly surface: { readonly kind: "none" } | { readonly kind: "action" } | { readonly kind: "destination" };
}

export type MutationWorkspaceState = MutationWorkflowState & MutationWorkspaceStateBase & {
  readonly actionDialog?: import("../../delete").ActionDialogSnapshot;
  readonly destinationPicker?: import("../../destination").DestinationPickerState;
  readonly destinationValidation?: import("../../destination").DestinationPlan;
};

export interface MutationWorkspaceCommands {
  /** Existing upload interaction's orchestration port; lifecycle authority only. */
  readonly uploadOrchestration: MutationWorkflowOrchestrationPorts["upload"];
  updateDestinationFolder(folderPath: string): void;
  updateDestinationName(name: string): void;
  updateDestinationManualMode(manualMode: boolean): void;
  updateDestinationManualPath(manualPath: string): void;
  reloadDestinationPicker(): void;
  updateActionValue(value: string): void;
  openCreateFolder(): void;
  openDelete(): void;
  openDeleteSelection(): void;
  openMove(): void;
  openCopyMove(): void;
  openCopyMoveSelection(): void;
  submitActionDialog(event?: import("react").FormEvent<HTMLFormElement>): Promise<void>;
  submitDestinationPicker(
    operation: DestinationOperation,
    event?: import("react").FormEvent<HTMLFormElement>
  ): Promise<void>;
  updateConflictDecision(sourcePath: string, decision: import("../../destination").DestinationConflictDecision): void;
  applyConflictDecisionToAll(decision: import("../../destination").DestinationConflictDecision): void;
  updateConflictApplySizeRule(checked: boolean): void;
  dismissConflictReview(): void;
  confirmConflictReview(): Promise<void>;
}

export interface MutationWorkspaceOutput {
  readonly state: MutationWorkspaceState;
  readonly commands: MutationWorkspaceCommands;
  readonly bridge: MutationWorkspaceBridge;
}
