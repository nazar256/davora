import { evaluateOperationAvailability } from "./evaluateOperationAvailability";
import type { OperationEnvironment, OperationIntent } from "./model";

export interface OperationRenderSelectionState {
  readonly hasSelectedEntry: boolean;
  readonly selectedFilePath?: string;
  readonly selectedIsFolder: boolean;
  readonly batchSelectionCount: number;
}

export interface ProjectOperationRenderCapabilitiesInput {
  readonly environment: OperationEnvironment;
  readonly selection: OperationRenderSelectionState;
  readonly destinationSourceCount?: number;
}

export interface OperationRenderCapabilities {
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

function isAllowed(environment: OperationEnvironment, intent: OperationIntent): boolean {
  return evaluateOperationAvailability(environment, intent).kind === "allowed";
}

export function projectOperationRenderCapabilities(
  input: ProjectOperationRenderCapabilitiesInput
): OperationRenderCapabilities {
  const { environment, selection, destinationSourceCount } = input;
  const focusedCount = selection.hasSelectedEntry ? 1 : 0;
  const batchCount = selection.batchSelectionCount;
  const destinationCount = destinationSourceCount ?? 0;

  return {
    canCreateFolder: isAllowed(environment, { kind: "createFolder" }),
    canUploadFiles: isAllowed(environment, { kind: "upload", requiresFolderCreation: false }),
    canUploadFolders: isAllowed(environment, { kind: "upload", requiresFolderCreation: true }),
    canMoveSelected: isAllowed(environment, { kind: "move", count: focusedCount }),
    canCopySelected: isAllowed(environment, { kind: "copy", count: focusedCount }),
    canDeleteSelected: isAllowed(environment, { kind: "delete", count: focusedCount }),
    canDownloadSelected: isAllowed(environment, {
      kind: "downloadFocused",
      present: Boolean(selection.selectedFilePath),
      isFolder: selection.selectedIsFolder
    }),
    canDownloadBatchSelection: isAllowed(environment, { kind: "downloadBatch", count: batchCount }),
    canMarkForBatchDownload: isAllowed(environment, { kind: "markBatch" }),
    canSyncSelectedOffline: isAllowed(environment, { kind: "keepOffline", count: focusedCount }),
    canSyncBatchOffline: isAllowed(environment, { kind: "keepOffline", count: batchCount }),
    canDeleteBatchSelection: isAllowed(environment, { kind: "delete", count: batchCount }),
    canCopyMoveBatchSelection: isAllowed(environment, { kind: "copyOrMove", count: batchCount }),
    canSubmitDestinationCopy: destinationSourceCount === undefined
      ? false
      : isAllowed(environment, { kind: "copy", count: destinationCount }),
    canSubmitDestinationMove: destinationSourceCount === undefined
      ? false
      : isAllowed(environment, { kind: "move", count: destinationCount })
  };
}

export function projectOfflineSyncCanStart(
  environment: OperationEnvironment,
  entryCount: number
): boolean {
  return isAllowed(environment, { kind: "keepOffline", count: entryCount });
}

export function projectDeleteDialogCanConfirm(
  environment: OperationEnvironment,
  unresolvedTargetCount: number
): boolean {
  return isAllowed(environment, { kind: "delete", count: unresolvedTargetCount });
}
