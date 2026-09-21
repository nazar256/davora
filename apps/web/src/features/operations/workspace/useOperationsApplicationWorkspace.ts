import { useSelectionInteractionWorkspace } from "../selection";
import type { OperationsApplicationWorkspace, OperationsApplicationWorkspaceInput } from "./ports";
import { useOperationAuthorityWorkspace } from "./useOperationAuthorityWorkspace";
import { useOperationExecutionWorkspace } from "./index";

export function useOperationsApplicationWorkspace(input: OperationsApplicationWorkspaceInput): OperationsApplicationWorkspace {
  const authority = useOperationAuthorityWorkspace({
    context: input.context,
    createAbortHandle: input.ports.createAbortHandle
  });
  const interaction = useSelectionInteractionWorkspace({
    selection: {
      focused: {
        current: input.selection.focused.current,
        select: input.selection.focused.select,
        clear: input.selection.focused.clear,
        hasSelectedPreview: () => Boolean(input.ports.preview.get()),
        showMobileActions: input.selection.focused.showMobileActions
      },
      batch: {
        isSelected: input.selection.batch.isSelected,
        toggle: input.selection.batch.toggle,
        selectAll: input.selection.batch.selectAll,
        deselectPaths: input.selection.batch.deselectPaths,
        clear: input.selection.batch.clear
      }
    },
    environment: {
      isCurrentOperationHandler: authority.isCurrentOperationHandler,
      isMarkBatchAllowed: () => authority.isOperationAllowed({ kind: "markBatch" }),
      canMarkForBatchDownload: () => authority.isOperationAllowed({ kind: "markBatch" }),
      isSearchActive: () => input.searchActive,
      getCurrentPath: () => input.context.currentPath
    },
    ports: {
      timer: input.ports.timer,
      chrome: input.ports.chrome
    },
    epoch: input.selectionEpoch
  }).commands;
  const execution = useOperationExecutionWorkspace({
    authority,
    context: input.context,
    selection: {
      focusedEntry: input.selection.focused.selectedEntry,
      batchSelectionEntries: input.selection.batch.entries,
      focused: input.selection.focused,
      batch: input.selection.batch,
      archiveInput: input.selection.batch.archiveInput,
      clearBatch: interaction.clearBatchSelection,
      selectedPreview: undefined,
      selectedPreviewPort: input.ports.preview
    },
    coordination: {
      session: input.ports.session,
      refresh: {
        getCurrentPath: () => input.context.currentPath,
        setCurrentPath: input.ports.refresh.setCurrentPath,
        loadFolder: input.ports.refresh.loadFolder
      },
      navigation: {
        closeNavigation: input.ports.navigation.closeNavigation,
        closeMobileDetails: input.ports.chrome.closeMobileDetails,
        openMobileDetails: input.ports.chrome.openMobileDetails,
        pushActionSurface: input.ports.navigation.pushActionSurface
      },
      presentation: input.ports.presentation,
      transfers: input.ports.transfers
    },
    runtime: input.ports.runtime
  });
  return { authority, interaction, execution };
}
