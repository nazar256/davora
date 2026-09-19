import type { FileEntry } from "@davora/shared";

import type { SelectionOrigin } from "./model";

export const ROW_LONG_PRESS_DELAY_MS = 450;

export type SelectionChromeAction =
  | { readonly kind: "openMobileDetails"; readonly pushHistory?: boolean }
  | { readonly kind: "closeMobileDetails" };

export type FocusedSelectionAction =
  | { readonly kind: "select"; readonly entry: FileEntry }
  | { readonly kind: "clear" };

export interface SelectionInteractionPlan {
  readonly focused: readonly FocusedSelectionAction[];
  readonly chrome: readonly SelectionChromeAction[];
  readonly batchToggle?: { readonly entry: FileEntry; readonly origin: SelectionOrigin };
  readonly batchClear?: true;
}

export function resolveBatchSelectionOrigin(searchActive: boolean, currentPath: string): SelectionOrigin {
  return searchActive
    ? { kind: "search", scopePath: currentPath }
    : { kind: "browse", folderPath: currentPath };
}

export function planEntrySelectionToggle(input: {
  entry: FileEntry;
  selectedEntryPath?: string;
  isNarrowScreen: boolean;
  mobileDetailsOpen: boolean;
}): SelectionInteractionPlan {
  const sameEntry = input.selectedEntryPath === input.entry.path;
  if (sameEntry) {
    if (input.isNarrowScreen && !input.mobileDetailsOpen) {
      return { focused: [], chrome: [{ kind: "openMobileDetails" }] };
    }
    return {
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }]
    };
  }

  const chrome: SelectionChromeAction[] = [];
  if (input.isNarrowScreen) {
    chrome.push({ kind: "openMobileDetails", pushHistory: true });
  } else {
    chrome.push({ kind: "closeMobileDetails" });
  }

  return {
    focused: [{ kind: "select", entry: input.entry }],
    chrome
  };
}

export function planBatchSelectionToggle(input: {
  entry: FileEntry;
  selectedEntryPath?: string;
  wasBatchSelected: boolean;
  searchActive: boolean;
  currentPath: string;
}): SelectionInteractionPlan {
  const origin = resolveBatchSelectionOrigin(input.searchActive, input.currentPath);
  const focused: FocusedSelectionAction[] = [];
  const chrome: SelectionChromeAction[] = [];

  if (input.wasBatchSelected && input.selectedEntryPath === input.entry.path) {
    focused.push({ kind: "clear" });
    chrome.push({ kind: "closeMobileDetails" });
  } else if (!input.wasBatchSelected && input.selectedEntryPath !== input.entry.path) {
    focused.push({ kind: "select", entry: input.entry });
    chrome.push({ kind: "closeMobileDetails" });
  }

  return {
    focused,
    chrome,
    batchToggle: { entry: input.entry, origin }
  };
}

export function planClearBatchSelection(input: {
  hasSelectedEntry: boolean;
  hasSelectedPreview: boolean;
}): SelectionInteractionPlan {
  const focused: FocusedSelectionAction[] = [];
  const chrome: SelectionChromeAction[] = [];

  if (input.hasSelectedEntry && !input.hasSelectedPreview) {
    focused.push({ kind: "clear" });
    chrome.push({ kind: "closeMobileDetails" });
  }

  return {
    focused,
    chrome,
    batchClear: true
  };
}
