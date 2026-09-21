import type { FileEntry, SearchResult } from "@davora/shared";

import { resolveSelectAllState, type SelectAllState } from "../presentation";
import type { SelectionInteractionWorkspaceCommands } from "./ports";

export interface SelectionFileListBindingsInput {
  readonly focusedEntry?: FileEntry;
  readonly batchCount: number;
  readonly isBatchSelected: (path: string) => boolean;
  readonly interaction: SelectionInteractionWorkspaceCommands;
  readonly isNarrowScreen: boolean;
  readonly selectAllItems: readonly FileEntry[];
  readonly searchActive: boolean;
  readonly canMarkForBatchDownload: boolean;
}

export interface SelectionFileListBindings {
  readonly batchModeActive: boolean;
  readonly selectionModeActive: boolean;
  readonly selectAllState: SelectAllState;
  readonly canSelectAll: boolean;
  readonly canDeselectAll: boolean;
  readonly onToggleSelectAll: () => void;
  readonly isItemBatchSelected: (item: FileEntry | SearchResult) => boolean;
  readonly isItemSelected: (item: FileEntry | SearchResult) => boolean;
  readonly clearRowOpenSuppression: () => void;
  readonly getRowOpenSuppressed: () => boolean;
  readonly onRowPointerCancel: () => void;
  readonly onRowPointerDown: (item: FileEntry | SearchResult) => void;
  readonly onRowPointerLeave: () => void;
  readonly onRowPointerUp: () => void;
  readonly onToggleBatchSelection: (item: FileEntry | SearchResult) => void;
  readonly onToggleEntrySelection: (item: FileEntry | SearchResult) => void;
  readonly suppressNarrowScreenContextMenu: boolean;
}

export function projectFileListSelectionBindings(
  input: SelectionFileListBindingsInput
): SelectionFileListBindings {
  const selectionModeActive = input.batchCount > 0;
  const selectAllState = resolveSelectAllState(input.selectAllItems, input.isBatchSelected);
  return {
    batchModeActive: selectionModeActive,
    selectionModeActive,
    selectAllState,
    canSelectAll: input.canMarkForBatchDownload && !input.searchActive && input.selectAllItems.length > 0,
    canDeselectAll: !input.searchActive && selectAllState === "all",
    onToggleSelectAll: () => input.interaction.toggleSelectAllEntries(input.selectAllItems),
    isItemBatchSelected: (item) => input.isBatchSelected(item.path),
    isItemSelected: (item) => input.focusedEntry?.path === item.path,
    clearRowOpenSuppression: input.interaction.clearRowOpenSuppression,
    getRowOpenSuppressed: input.interaction.getRowOpenSuppressed,
    onRowPointerCancel: input.interaction.clearRowLongPressTimer,
    onRowPointerDown: input.interaction.startRowLongPressSelection,
    onRowPointerLeave: input.interaction.clearRowLongPressTimer,
    onRowPointerUp: input.interaction.clearRowLongPressTimer,
    onToggleBatchSelection: input.interaction.toggleBatchSelectionEntry,
    onToggleEntrySelection: input.interaction.toggleEntrySelection,
    suppressNarrowScreenContextMenu: input.isNarrowScreen
  };
}
