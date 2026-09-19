import type { FileEntry } from "@davora/shared";

import type { SelectionSyncEffect } from "./model";
import type { FocusedSelectionCapture } from "../selection";

export interface SelectionPreviewState {
  readonly path: string;
  readonly name: string;
}

export interface SelectionSyncApplicationDeps {
  readonly batchSelection: {
    removeDeleted(path: string): void;
    rebind(fromPath: string, item: FileEntry): void;
  };
  readonly selection: {
    currentFocusedSelection(): FileEntry | undefined;
    selectFocused(entry: FileEntry): void;
    clearFocused(): void;
    clearFocusedIfCurrent(capture: FocusedSelectionCapture): void;
    rebindFocusedIfCurrent(capture: FocusedSelectionCapture, entry: FileEntry): void;
    removeDeletedFocused(path: string): void;
    isFocusedSelectionCurrent(capture: FocusedSelectionCapture): boolean;
    setSelectedPreview(
      updater: (previous: SelectionPreviewState | undefined) => SelectionPreviewState | undefined
    ): void;
    closePreview(): void;
  };
  readonly chrome: {
    closeMobileDetails(): void;
    openMobileDetails(): void;
  };
  readonly mobile: { isNarrowScreen: boolean };
}

export function applySelectionSyncEffect(
  effect: SelectionSyncEffect,
  deps: SelectionSyncApplicationDeps,
  capture: FocusedSelectionCapture | undefined = undefined
): void {
  switch (effect.kind) {
    case "delete":
      deps.batchSelection.removeDeleted(effect.path);
      deps.selection.setSelectedPreview(() => undefined);
      deps.selection.closePreview();
      if (!capture || deps.selection.isFocusedSelectionCurrent(capture)) {
        deps.selection.removeDeletedFocused(effect.path);
      }
      deps.chrome.closeMobileDetails();
      return;
    case "focus-item":
      if (capture && !deps.selection.isFocusedSelectionCurrent(capture)) {
        return;
      }
      if (!capture && deps.selection.currentFocusedSelection()) {
        return;
      }
      deps.selection.selectFocused(effect.item);
      if (deps.mobile.isNarrowScreen) {
        deps.chrome.openMobileDetails();
      }
      deps.batchSelection.rebind(effect.rebindFromPath, effect.item);
      return;
    case "move-copy-selected":
      if (capture && !deps.selection.isFocusedSelectionCurrent(capture)) {
        return;
      }
      deps.selection.selectFocused(effect.nextEntry);
      if (deps.mobile.isNarrowScreen) {
        deps.chrome.openMobileDetails();
      }
      deps.batchSelection.rebind(effect.sourcePath, effect.nextEntry);
      if (effect.updatePreview) {
        deps.selection.setSelectedPreview((previous) => previous
          ? {
              ...previous,
              path: effect.destinationPath,
              name: effect.previewName
            }
          : previous);
      }
      return;
    case "none":
      return;
  }
}
