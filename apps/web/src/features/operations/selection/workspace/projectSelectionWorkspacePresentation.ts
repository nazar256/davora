import type { FileEntry } from "@davora/shared";
import { toDisplayPath } from "@davora/shared";

import type { SelectionDetailsStageProps } from "../SelectionDetailsStage";
import {
  buildSelectionDetailsContent,
  resolveSelectAllState,
  resolveSelectedDetails
} from "../presentation";

import type {
  SelectionWorkspacePresentation,
  SelectionWorkspacePresentationInput
} from "./ports";

function selectedFilePath(selectedDetails: FileEntry | undefined): string | undefined {
  return selectedDetails && !selectedDetails.isFolder ? selectedDetails.path : undefined;
}

export function projectSelectionWorkspacePresentation(
  input: SelectionWorkspacePresentationInput
): SelectionWorkspacePresentation {
  const selectedDetails = resolveSelectedDetails(
    input.selection.batchSummary.count,
    input.selection.focusedEntry,
    input.preview.selected
  );
  const selectionModeActive = input.selection.batchSummary.count > 0;
  const showDetailsRail = Boolean(selectedDetails || selectionModeActive);
  const selectedPath = selectedFilePath(selectedDetails);
  const showMobileSelectionSheet = input.view.isNarrowScreen
    && Boolean(selectedDetails && input.view.mobileDetailsOpen);
  const showMobileBatchBar = input.view.isNarrowScreen
    && selectionModeActive
    && !showMobileSelectionSheet;
  const favouriteActionLabel = input.favourite.selected
    ? "Remove from Favourites"
    : "Add to Favourites";
  const selectAllState = resolveSelectAllState(input.selection.selectAllItems, input.selection.isBatchSelected);
  const canSelectAll = input.capabilities.canMarkForBatchDownload
    && !input.workspace.searchActive
    && input.selection.selectAllItems.length > 0;
  const canDeselectAll = !input.workspace.searchActive && selectAllState === "all";
  const content = buildSelectionDetailsContent({
    selectedEntry: input.selection.focusedEntry,
    selected: input.preview.selected,
    batchSelectionCount: input.selection.batchSummary.count,
    batchSelectionSummary: input.selection.batchSummary,
    isPathInBatchSelection: input.selection.isBatchSelected,
    hasSelectedEntry: Boolean(input.selection.focusedEntry),
    fileSizeDisplayMode: input.view.fileSizeDisplayMode,
    workspace: input.workspace,
    formatters: input.formatters
  });

  const detailsStage: SelectionDetailsStageProps = {
    visible: showDetailsRail,
    content,
    showMobileBatchBar,
    showMobileSelectionSheet,
    mobileSheetDetailsExpanded: input.selection.focusedMobileSubview === "details",
    offline: input.workspace.offline,
    mutationBusy: input.view.mutationBusy,
    canDownloadSelected: input.capabilities.canDownloadSelected,
    canSyncSelectedOffline: input.capabilities.canSyncSelectedOffline,
    selectedIsFavourite: input.favourite.selected,
    selectedFavouriteActionLabel: favouriteActionLabel,
    canMoveSelected: input.capabilities.canMoveSelected,
    canCopySelected: input.capabilities.canCopySelected,
    canDeleteSelected: input.capabilities.canDeleteSelected,
    canDownloadBatchSelection: input.capabilities.canDownloadBatchSelection,
    canSyncBatchOffline: input.capabilities.canSyncBatchOffline,
    canCopyMoveBatchSelection: input.capabilities.canCopyMoveBatchSelection,
    canDeleteBatchSelection: input.capabilities.canDeleteBatchSelection,
    selectAllState,
    canSelectAll,
    canDeselectAll,
    onToggleSelectAll: input.commands.toggleSelectAll,
    onOpenSelected: () => {
      const focusedEntry = input.selection.focusedEntry;
      if (!focusedEntry) {
        return;
      }
      if (selectedDetails?.isFolder) {
        input.commands.navigateToFolder(focusedEntry.path);
        return;
      }
      input.commands.openFile(focusedEntry);
    },
    onDownloadSelected: () => {
      if (selectedPath) {
        input.commands.downloadFocused(selectedPath, toDisplayPath(selectedPath));
      }
    },
    onKeepOfflineSelected: () => {
      if (input.selection.focusedEntry) {
        input.commands.keepOfflineFocused(input.selection.focusedEntry);
      }
    },
    onToggleFavourite: () => {
      if (input.selection.focusedEntry) {
        input.favourite.toggle(input.selection.focusedEntry);
      }
    },
    onFolderShortcut: () => {
      const focusedEntry = input.selection.focusedEntry;
      if (focusedEntry?.isFolder) {
        input.commands.openFolderShortcut(focusedEntry);
      }
    },
    onToggleMobileSheetDetails: () => {
      if (input.selection.focusedMobileSubview === "details") {
        input.commands.showMobileActions();
      } else {
        input.commands.showMobileDetails();
      }
    },
    onRenameSelected: input.commands.renameFocused,
    onCopyMoveSelected: input.commands.copyMoveFocused,
    onDeleteSelected: input.commands.deleteFocused,
    onDownloadBatchSelection: input.commands.downloadBatch,
    onKeepOfflineBatchSelection: input.commands.keepOfflineBatch,
    onCopyMoveBatchSelection: input.commands.copyMoveBatch,
    onDeleteBatchSelection: input.commands.deleteBatch,
    onClearBatchSelection: input.commands.clearBatch,
    onCloseMobileSelectionSheet: () => {
      input.commands.clearFocused();
      input.commands.closeMobileDetails();
      input.commands.showMobileActions();
    },
    onCollapseMobileSheetDetails: input.commands.showMobileActions
  };

  return {
    detailsStage,
    selectionModeActive,
    selectedDetails,
    selectedFilePath: selectedPath,
    showDetailsRail,
    showMobileSelectionSheet,
    showMobileBatchBar,
    favouriteActionLabel
  };
}
