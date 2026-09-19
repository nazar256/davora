import type { FileEntry, FilePreview } from "@davora/shared";

import type {
  BatchSelectionCapture,
  BatchSelectionMembership,
  FocusedSelectionCapture,
  MobileSelectionSubview,
  SelectedResourceDescriptor,
  SelectionOrigin
} from "../model";
import type { BatchArchiveInput, BatchSelectionSummary } from "../selectors";
import type { SelectionChromePorts, SelectionTimerPorts } from "../ports";
import type { SelectionPresentationFormatters } from "../presentation";
import type { FileSizeDisplayMode } from "../../../../lib/fileSize";
import type { SelectionDetailsStageProps } from "../SelectionDetailsStage";

/**
 * Identity token for one mounted account-selection generation.
 * Consumers can compare it for equality but cannot derive its identity.
 */
export class SelectionWorkspaceEpoch {
  private constructor(readonly id: symbol) {}

  static create(): SelectionWorkspaceEpoch {
    return new SelectionWorkspaceEpoch(Symbol("davora-selection-workspace"));
  }
}

export interface SelectionStateWorkspaceInput {
  readonly accountId: string | undefined;
}

export interface SelectionStateWorkspaceFocusedSnapshot {
  readonly selectedEntry: SelectedResourceDescriptor | undefined;
  readonly mobileSubview: MobileSelectionSubview;
  readonly hasSelection: boolean;
}

export interface SelectionStateWorkspaceBatchSnapshot {
  readonly memberships: readonly BatchSelectionMembership[];
  readonly entries: readonly FileEntry[];
  readonly archiveInput: BatchArchiveInput;
  readonly summary: BatchSelectionSummary;
}

export interface SelectionStateWorkspaceSnapshot {
  readonly accountId: string | undefined;
  readonly focused: SelectionStateWorkspaceFocusedSnapshot;
  readonly batch: SelectionStateWorkspaceBatchSnapshot;
}

export interface SelectionStateWorkspaceCommands {
  readonly selectFocused: (entry: FileEntry) => void;
  readonly toggleFocused: (entry: FileEntry) => void;
  readonly clearFocused: () => void;
  readonly clearFocusedIfCurrent: (capture: FocusedSelectionCapture | undefined) => void;
  readonly rebindFocusedIfCurrent: (capture: FocusedSelectionCapture | undefined, entry: FileEntry) => void;
  readonly removeDeletedFocused: (path: string) => void;
  readonly showMobileActions: () => void;
  readonly showMobileDetails: () => void;
  readonly toggleBatch: (entry: FileEntry, origin: SelectionOrigin) => void;
  readonly clearBatch: () => void;
  readonly rebindBatch: (sourcePath: string, entry: FileEntry) => void;
  readonly removeDeletedBatch: (path: string) => void;
  readonly retainBatch: (paths: readonly string[]) => void;
  readonly removeCapturedBatch: (capture: BatchSelectionCapture) => void;
}

export interface SelectionStateWorkspaceCaptures {
  readonly focused: () => FocusedSelectionCapture | undefined;
  readonly batch: () => BatchSelectionCapture;
  readonly isBatchSelected: (path: string) => boolean;
  readonly isFocusedCurrent: (capture: FocusedSelectionCapture | undefined) => boolean;
}

export interface SelectionStateWorkspaceOutput {
  readonly epoch: SelectionWorkspaceEpoch;
  readonly snapshot: SelectionStateWorkspaceSnapshot;
  readonly commands: SelectionStateWorkspaceCommands;
  readonly captures: SelectionStateWorkspaceCaptures;
}

export interface SelectionInteractionWorkspaceSelection {
  readonly focused: {
    readonly current: () => FileEntry | undefined;
    readonly select: (entry: FileEntry) => void;
    readonly clear: () => void;
    readonly hasSelectedPreview: () => boolean;
    readonly showMobileActions: () => void;
  };
  readonly batch: {
    readonly isSelected: (path: string) => boolean;
    readonly toggle: (entry: FileEntry, origin: SelectionOrigin) => void;
    readonly clear: () => void;
  };
}

export interface SelectionInteractionWorkspaceEnvironment {
  readonly isCurrentOperationHandler: () => boolean;
  readonly isMarkBatchAllowed: () => boolean;
  readonly canMarkForBatchDownload: () => boolean;
  readonly isSearchActive: () => boolean;
  readonly getCurrentPath: () => string;
}

export interface SelectionInteractionWorkspacePorts {
  readonly timer: SelectionTimerPorts;
  readonly chrome: SelectionChromePorts;
}

export interface SelectionInteractionWorkspaceInput {
  readonly selection: SelectionInteractionWorkspaceSelection;
  readonly environment: SelectionInteractionWorkspaceEnvironment;
  readonly ports: SelectionInteractionWorkspacePorts;
  readonly epoch: SelectionWorkspaceEpoch;
}

export interface SelectionInteractionWorkspaceCommands {
  readonly toggleEntrySelection: (entry: FileEntry) => void;
  readonly toggleBatchSelectionEntry: (entry: FileEntry) => void;
  readonly clearBatchSelection: () => void;
  readonly startRowLongPressSelection: (entry: FileEntry) => void;
  readonly clearRowLongPressTimer: () => void;
  readonly clearRowOpenSuppression: () => void;
  readonly getRowOpenSuppressed: () => boolean;
}

export interface SelectionInteractionWorkspaceOutput {
  readonly commands: SelectionInteractionWorkspaceCommands;
}

export interface SelectionActionCapabilities {
  readonly canDownloadSelected: boolean;
  readonly canSyncSelectedOffline: boolean;
  readonly canMoveSelected: boolean;
  readonly canCopySelected: boolean;
  readonly canDeleteSelected: boolean;
  readonly canDownloadBatchSelection: boolean;
  readonly canSyncBatchOffline: boolean;
  readonly canCopyMoveBatchSelection: boolean;
  readonly canDeleteBatchSelection: boolean;
}

export interface SelectionWorkspacePresentationInput {
  readonly selection: {
    readonly focusedEntry?: FileEntry;
    readonly focusedMobileSubview: MobileSelectionSubview;
    readonly batchSummary: BatchSelectionSummary;
    readonly isBatchSelected: (path: string) => boolean;
  };
  readonly preview: {
    readonly selected?: FilePreview;
  };
  readonly workspace: {
    readonly folderLabel: string;
    readonly locationLabel: string;
    readonly visibleItemCount: number;
    readonly searchActive: boolean;
    readonly searchQuery: string;
    readonly explicitOfflineMode: boolean;
    readonly offline: boolean;
    readonly workerUnavailable: boolean;
    readonly folderCachedAt?: string;
  };
  readonly view: {
    readonly fileSizeDisplayMode: FileSizeDisplayMode;
    readonly isNarrowScreen: boolean;
    readonly mobileDetailsOpen: boolean;
    readonly mutationBusy: boolean;
  };
  readonly capabilities: SelectionActionCapabilities;
  readonly favourite: {
    readonly selected: boolean;
    readonly toggle: (entry: FileEntry) => void;
  };
  readonly commands: {
    readonly clearFocused: () => void;
    readonly clearBatch: () => void;
    readonly showMobileActions: () => void;
    readonly showMobileDetails: () => void;
    readonly closeMobileDetails: () => void;
    readonly navigateToFolder: (path: string) => void;
    readonly openFile: (entry: FileEntry) => void;
    readonly openFolderShortcut: (entry: FileEntry) => void;
    readonly downloadFocused: (path: string, label: string) => void;
    readonly downloadBatch: () => void;
    readonly keepOfflineFocused: (entry: FileEntry) => void;
    readonly keepOfflineBatch: () => void;
    readonly renameFocused: () => void;
    readonly copyMoveFocused: () => void;
    readonly copyMoveBatch: () => void;
    readonly deleteFocused: () => void;
    readonly deleteBatch: () => void;
  };
  readonly formatters?: SelectionPresentationFormatters;
}

export interface SelectionWorkspacePresentation {
  readonly detailsStage: SelectionDetailsStageProps;
  readonly selectionModeActive: boolean;
  readonly selectionSummaryLabel?: string;
  readonly selectedDetails?: FileEntry;
  readonly selectedFilePath?: string;
  readonly showDetailsRail: boolean;
  readonly showMobileSelectionSheet: boolean;
  readonly showMobileBatchBar: boolean;
  readonly favouriteActionLabel: string;
}
