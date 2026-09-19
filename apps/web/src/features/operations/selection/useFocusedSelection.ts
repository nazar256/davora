import type { FileEntry } from "@davora/shared";
import { useCallback, useState } from "react";

import {
  captureFocusedSelection,
  clearFocusedSelection,
  clearFocusedSelectionIfCurrent,
  createFocusedSelectionState,
  isFocusedSelectionCurrent,
  removeDeletedFocusedSelection,
  rebindFocusedSelectionIfCurrent,
  replaceFocusedSelectionAccount,
  selectFocusedEntry,
  showFocusedMobileActions,
  showFocusedMobileDetails,
  toggleFocusedEntry,
  type FocusedSelectionCapture,
  type FocusedSelectionState,
  type MobileSelectionSubview,
  type SelectedResourceDescriptor
} from "./model";

export interface FocusedSelectionController {
  readonly state: FocusedSelectionState;
  readonly selectedEntry: SelectedResourceDescriptor | undefined;
  readonly mobileSubview: MobileSelectionSubview;
  readonly hasSelection: boolean;
  current(): SelectedResourceDescriptor | undefined;
  select(entry: FileEntry): void;
  toggle(entry: FileEntry): void;
  clear(): void;
  clearIfCurrent(capture: FocusedSelectionCapture | undefined): void;
  rebindIfCurrent(capture: FocusedSelectionCapture | undefined, entry: FileEntry): void;
  removeDeleted(path: string): void;
  capture(): FocusedSelectionCapture | undefined;
  isCurrent(capture: FocusedSelectionCapture | undefined): boolean;
  showMobileActions(): void;
  showMobileDetails(): void;
}

export function useFocusedSelection(accountId: string | undefined): FocusedSelectionController {
  const [state, setState] = useState<FocusedSelectionState>(() => createFocusedSelectionState(accountId));
  const currentState = state.accountId === accountId
    ? state
    : replaceFocusedSelectionAccount(state, accountId);
  const activeAccountId = accountId ?? "";

  const update = useCallback((transition: (current: FocusedSelectionState) => FocusedSelectionState) => {
    setState((current) => transition(
      current.accountId === accountId ? current : replaceFocusedSelectionAccount(current, accountId)
    ));
  }, [accountId]);

  const select = useCallback((entry: FileEntry) => {
    update((current) => selectFocusedEntry(current, activeAccountId, entry));
  }, [activeAccountId, update]);

  const toggle = useCallback((entry: FileEntry) => {
    update((current) => toggleFocusedEntry(current, activeAccountId, entry));
  }, [activeAccountId, update]);

  const clear = useCallback(() => {
    update((current) => clearFocusedSelection(current, activeAccountId));
  }, [activeAccountId, update]);

  const clearIfCurrent = useCallback((capture: FocusedSelectionCapture | undefined) => {
    if (capture) {
      update((current) => clearFocusedSelectionIfCurrent(current, capture));
    }
  }, [update]);

  const rebindIfCurrent = useCallback((capture: FocusedSelectionCapture | undefined, entry: FileEntry) => {
    if (capture) {
      update((current) => rebindFocusedSelectionIfCurrent(current, capture, entry));
    }
  }, [update]);

  const removeDeleted = useCallback((path: string) => {
    update((current) => removeDeletedFocusedSelection(current, activeAccountId, path));
  }, [activeAccountId, update]);

  const showMobileActions = useCallback(() => {
    update(showFocusedMobileActions);
  }, [update]);

  const showMobileDetails = useCallback(() => {
    update(showFocusedMobileDetails);
  }, [update]);

  return {
    state: currentState,
    selectedEntry: currentState.kind === "selected" ? currentState.selection.descriptor : undefined,
    mobileSubview: currentState.mobileSubview,
    hasSelection: currentState.kind === "selected",
    current: () => currentState.kind === "selected" ? currentState.selection.descriptor : undefined,
    select,
    toggle,
    clear,
    clearIfCurrent,
    rebindIfCurrent,
    removeDeleted,
    capture: () => captureFocusedSelection(currentState),
    isCurrent: (capture) => Boolean(capture && isFocusedSelectionCurrent(currentState, capture)),
    showMobileActions,
    showMobileDetails
  };
}
