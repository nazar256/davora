import type { FileEntry, FilePreview, MutationResult, CapabilitySet } from "@davora/shared";

import type { MutationWorkspaceOutput } from "../mutation/workspace";
import type { DownloadWorkspaceCommands } from "../download/workspace";
import type { UploadInteraction } from "../upload";
import type { OperationContextToken, OperationEnvironment, OperationIntent } from "../policy";
import type { DownloadBatchSource, DownloadFileSources } from "../download/createDownloadPorts";
import type { UploadFileContentPort } from "../upload/orchestrationPorts";
import type { TransfersController } from "../../transfers";
import type { FolderLoadResult } from "../mutation/workflowAdapters";
import type {
  SelectionChromePorts,
  SelectionInteractionWorkspaceCommands,
  SelectionStateBindings,
  SelectionTimerPorts,
  SelectionWorkspaceEpoch
} from "../selection";

export interface OperationRuntimePort {
  readonly request: {
    createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
    createTransferId(): string;
  };
  readonly mutation: {
    createFolder(parentPath: string, name: string, token: string): Promise<MutationResult>;
    deleteFile(path: string, confirmName: string, token: string): Promise<MutationResult>;
    uploadFile(
      input: { readonly path: string; readonly name: string; readonly mimeType: string; readonly contentBase64: string },
      token: string,
      onProgress: (loadedBytes: number, totalBytes: number) => void,
      signal: AbortSignal
    ): Promise<MutationResult>;
    copyOrMove(kind: "copy" | "move", source: string, destination: string, token: string, overwrite?: boolean): Promise<MutationResult>;
    listDestination(path: string, token: string): Promise<{ readonly items: FileEntry[] }>;
  };
  readonly download: DownloadFileSources & { saveDownload(blob: Blob, filename: string): void };
  readonly batch: DownloadBatchSource;
  readonly preview: {
    createFileStreamUrl(path: string, token: string, signal?: AbortSignal): Promise<string>;
  };
  readonly time: {
    wait(delayMs: number): Promise<void>;
  };
  readonly uploadFiles: UploadFileContentPort;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export interface OperationAuthority {
  readonly token: OperationContextToken;
  readonly environment: OperationEnvironment;
  readonly registry: {
    acquire(input: {
      readonly context: OperationContextToken;
      readonly intent?: OperationIntent;
      readonly path?: string;
      readonly ownership?: { readonly checkPath?: string; readonly checkAborted?: boolean };
      readonly rejectUnlessImmediateOwner?: boolean;
    }): {
      readonly signal: AbortSignal;
      isRegistered(): boolean;
      isOwned(): boolean;
      isCurrent(): boolean;
      release(): void;
    } | undefined;
  };
  isOperationAllowed(intent: OperationIntent): boolean;
  isOperationAllowedForRender(intent: OperationIntent): boolean;
  isOperationContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
  isCurrentOperationHandler(): boolean;
  isCurrentOperationContext(context: OperationContextToken, expected?: OperationContextToken): boolean;
  getCurrentOperationContextToken(): OperationContextToken;
  getCurrentCapabilities(): CapabilitySet | undefined;
  capabilitiesMatch(captured: CapabilitySet | undefined): boolean;
}

export interface OperationExecutionWorkspaceContext {
  readonly accountId?: string;
  readonly accountName: string;
  readonly token?: string;
  readonly capabilities?: CapabilitySet;
  readonly currentPath: string;
  readonly cacheOnlyMode: boolean;
  readonly explicitOffline: boolean;
  readonly browserOffline: boolean;
  readonly workerUnavailable: boolean;
  readonly isNarrowScreen: boolean;
}

export interface OperationAuthorityWorkspaceInput {
  readonly context: OperationExecutionWorkspaceContext;
  readonly createAbortHandle: OperationRuntimePort["request"]["createAbortHandle"];
}

export interface OperationSelectionPublicPort {
  readonly focusedEntry?: FileEntry;
  readonly batchSelectionEntries: readonly FileEntry[];
  readonly focused: {
    current(): FileEntry | undefined;
    select(entry: FileEntry): void;
    clear(): void;
    clearIfCurrent(capture: import("../selection").FocusedSelectionCapture | undefined): void;
    rebindIfCurrent(capture: import("../selection").FocusedSelectionCapture | undefined, entry: FileEntry): void;
    removeDeleted(path: string): void;
    capture(): import("../selection").FocusedSelectionCapture | undefined;
    isCurrent(capture: import("../selection").FocusedSelectionCapture | undefined): boolean;
    showMobileActions(): void;
  };
  readonly batch: {
    removeDeleted(path: string): void;
    rebind(path: string, item: FileEntry): void;
    retain(paths: readonly string[]): void;
    clear(): void;
    removeCaptured(capture: import("../selection").BatchSelectionCapture): void;
    isSelected(path: string): boolean;
    toggle(entry: FileEntry, origin: import("../selection").SelectionOrigin): void;
    capture(): import("../selection").BatchSelectionCapture;
  };
  readonly archiveInput: import("../selection").BatchArchiveInput;
  clearBatch(): void;
  readonly selectedPreview?: FilePreview;
  readonly selectedPreviewPort: {
    get(): { readonly path: string; readonly name: string } | undefined;
    set(updater: (previous: { readonly path: string; readonly name: string } | undefined) => { readonly path: string; readonly name: string } | undefined): void;
    closePreview(): void;
  };
}

export interface OperationExecutionCoordination {
  readonly session: { resetActiveSession(message: string, reconnectRequired?: boolean): void };
  readonly refresh: {
    getCurrentPath(): string;
    setCurrentPath(path: string): void;
    loadFolder(path: string, options?: { readonly preferCache?: boolean; readonly announceStatus?: boolean }): Promise<FolderLoadResult>;
  };
  readonly navigation: {
    closeNavigation(): void;
    closeMobileDetails(): void;
    openMobileDetails(): void;
    pushActionSurface(): void;
  };
  readonly presentation: {
    clearListError(): void;
    reportListError(error: Error): void;
    setStatus(message: string): void;
    getAccountName(): string;
    toDisplayPath(path: string): string;
  };
  readonly transfers: TransfersController;
}

export interface OperationExecutionWorkspaceInput {
  readonly authority: OperationAuthority;
  readonly context: OperationExecutionWorkspaceContext;
  readonly selection: OperationSelectionPublicPort;
  readonly coordination: OperationExecutionCoordination;
  readonly runtime: OperationRuntimePort;
}

export interface OperationExecutionCommands {
  openCreateFolder(): void;
  openDelete(): void;
  openDeleteSelection(): void;
  openMove(): void;
  openCopyMove(): void;
  openCopyMoveSelection(): void;
}

export interface OperationExecutionRenderCapabilities {
  readonly canCreateFolder: boolean;
  readonly canUploadFiles: boolean;
  readonly canUploadFolders: boolean;
  readonly canMoveSelected: boolean;
  readonly canCopySelected: boolean;
  readonly canDeleteSelected: boolean;
  readonly canDownloadSelected: boolean;
  readonly canDownloadBatchSelection: boolean;
  readonly canMarkForBatchDownload: boolean;
  readonly canSyncSelectedOffline: boolean;
  readonly canSyncBatchOffline: boolean;
  readonly canDeleteBatchSelection: boolean;
  readonly canCopyMoveBatchSelection: boolean;
  readonly canSubmitDestinationCopy: boolean;
  readonly canSubmitDestinationMove: boolean;
}

export interface OperationExecutionWorkspaceOutput {
  readonly authority: OperationAuthority;
  readonly mutation: {
    readonly state: MutationWorkspaceOutput["state"];
    readonly bridge: MutationWorkspaceOutput["bridge"];
    readonly stage: import("../mutation/MutationWorkflowStage").MutationWorkflowStageProps;
    readonly cancelTransferTask: (taskId: string) => void;
    readonly retryTransferTask: (taskId: string) => void;
  };
  readonly download: DownloadWorkspaceCommands;
  readonly upload: UploadInteraction;
  readonly capabilities: OperationExecutionRenderCapabilities;
  readonly commands: OperationExecutionCommands;
}

export interface OperationsApplicationWorkspaceInput {
  readonly context: OperationExecutionWorkspaceContext;
  readonly selection: SelectionStateBindings;
  readonly selectionEpoch: SelectionWorkspaceEpoch;
  readonly searchActive: boolean;
  readonly ports: {
    readonly createAbortHandle: OperationRuntimePort["request"]["createAbortHandle"];
    readonly timer: SelectionTimerPorts;
    readonly chrome: SelectionChromePorts;
    readonly preview: OperationSelectionPublicPort["selectedPreviewPort"];
    readonly session: OperationExecutionCoordination["session"];
    readonly refresh: Pick<OperationExecutionCoordination["refresh"], "setCurrentPath" | "loadFolder">;
    readonly navigation: Pick<OperationExecutionCoordination["navigation"], "closeNavigation" | "pushActionSurface">;
    readonly presentation: OperationExecutionCoordination["presentation"];
    readonly transfers: TransfersController;
    readonly runtime: OperationRuntimePort;
  };
}

export interface OperationsApplicationWorkspace {
  readonly authority: OperationAuthority;
  readonly interaction: SelectionInteractionWorkspaceCommands;
  readonly execution: OperationExecutionWorkspaceOutput;
}
