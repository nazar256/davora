import type { FileEntry, SearchResult } from "@davora/shared";

import type { SelectionInteractionWorkspaceCommands } from "./ports";

export interface SelectionFileListBindingsInput {
  readonly focusedEntry?: FileEntry;
  readonly batchCount: number;
  readonly isBatchSelected: (path: string) => boolean;
  readonly interaction: SelectionInteractionWorkspaceCommands;
  readonly isNarrowScreen: boolean;
}

export interface SelectionFileListBindings {
  readonly batchModeActive: boolean;
  readonly selectionModeActive: boolean;
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
  return {
    batchModeActive: selectionModeActive,
    selectionModeActive,
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
