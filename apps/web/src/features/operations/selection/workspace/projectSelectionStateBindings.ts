import type { SelectionStateWorkspaceOutput } from "./ports";

export interface SelectionStateBindings {
  readonly focused: {
    readonly selectedEntry: SelectionStateWorkspaceOutput["snapshot"]["focused"]["selectedEntry"];
    readonly mobileSubview: SelectionStateWorkspaceOutput["snapshot"]["focused"]["mobileSubview"];
    readonly hasSelection: boolean;
    readonly current: () => SelectionStateBindings["focused"]["selectedEntry"];
    readonly select: SelectionStateWorkspaceOutput["commands"]["selectFocused"];
    readonly clear: SelectionStateWorkspaceOutput["commands"]["clearFocused"];
    readonly clearIfCurrent: SelectionStateWorkspaceOutput["commands"]["clearFocusedIfCurrent"];
    readonly rebindIfCurrent: SelectionStateWorkspaceOutput["commands"]["rebindFocusedIfCurrent"];
    readonly removeDeleted: SelectionStateWorkspaceOutput["commands"]["removeDeletedFocused"];
    readonly showMobileActions: SelectionStateWorkspaceOutput["commands"]["showMobileActions"];
    readonly showMobileDetails: SelectionStateWorkspaceOutput["commands"]["showMobileDetails"];
    readonly capture: SelectionStateWorkspaceOutput["captures"]["focused"];
    readonly isCurrent: SelectionStateWorkspaceOutput["captures"]["isFocusedCurrent"];
  };
  readonly batch: {
    readonly entries: readonly SelectionStateWorkspaceOutput["snapshot"]["batch"]["entries"][number][];
    readonly archiveInput: SelectionStateWorkspaceOutput["snapshot"]["batch"]["archiveInput"];
    readonly summary: SelectionStateWorkspaceOutput["snapshot"]["batch"]["summary"];
    readonly memberships: SelectionStateWorkspaceOutput["snapshot"]["batch"]["memberships"];
    readonly isSelected: SelectionStateWorkspaceOutput["captures"]["isBatchSelected"];
    readonly toggle: SelectionStateWorkspaceOutput["commands"]["toggleBatch"];
    readonly selectAll: SelectionStateWorkspaceOutput["commands"]["selectAllBatch"];
    readonly deselectPaths: SelectionStateWorkspaceOutput["commands"]["deselectBatchPaths"];
    readonly clear: SelectionStateWorkspaceOutput["commands"]["clearBatch"];
    readonly removeDeleted: SelectionStateWorkspaceOutput["commands"]["removeDeletedBatch"];
    readonly rebind: SelectionStateWorkspaceOutput["commands"]["rebindBatch"];
    readonly retain: SelectionStateWorkspaceOutput["commands"]["retainBatch"];
    readonly removeCaptured: SelectionStateWorkspaceOutput["commands"]["removeCapturedBatch"];
    readonly capture: SelectionStateWorkspaceOutput["captures"]["batch"];
  };
}

export function projectSelectionStateBindings(
  selectionStateWorkspace: SelectionStateWorkspaceOutput
): SelectionStateBindings {
  const { snapshot, commands, captures } = selectionStateWorkspace;
  const selectedEntry = snapshot.focused.selectedEntry;
  return {
    focused: {
      selectedEntry,
      mobileSubview: snapshot.focused.mobileSubview,
      hasSelection: snapshot.focused.hasSelection,
      current: () => selectedEntry,
      select: commands.selectFocused,
      clear: commands.clearFocused,
      clearIfCurrent: commands.clearFocusedIfCurrent,
      rebindIfCurrent: commands.rebindFocusedIfCurrent,
      removeDeleted: commands.removeDeletedFocused,
      showMobileActions: commands.showMobileActions,
      showMobileDetails: commands.showMobileDetails,
      capture: captures.focused,
      isCurrent: captures.isFocusedCurrent
    },
    batch: {
      entries: [...snapshot.batch.entries],
      archiveInput: snapshot.batch.archiveInput,
      summary: snapshot.batch.summary,
      memberships: snapshot.batch.memberships,
      isSelected: captures.isBatchSelected,
      toggle: commands.toggleBatch,
      selectAll: commands.selectAllBatch,
      deselectPaths: commands.deselectBatchPaths,
      clear: commands.clearBatch,
      removeDeleted: commands.removeDeletedBatch,
      rebind: commands.rebindBatch,
      retain: commands.retainBatch,
      removeCaptured: commands.removeCapturedBatch,
      capture: captures.batch
    }
  };
}
