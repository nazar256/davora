import type { FileEntry } from "@davora/shared";
import { useCallback, useState } from "react";

import {
  captureBatchSelection,
  clearBatchSelection,
  createBatchSelectionState,
  rebindBatchSelection,
  removeCapturedSelection,
  removeDeletedPath,
  replaceBatchSelectionAccount,
  retainBatchSelectionPaths,
  toggleBatchSelection,
  type BatchSelectionCapture,
  type BatchSelectionMembership,
  type SelectionOrigin
} from "./model";
import { isBatchPathSelected, selectBatchArchiveInput, selectBatchEntries, selectBatchSelectionSummary } from "./selectors";

export interface BatchSelectionController {
  readonly memberships: readonly BatchSelectionMembership[];
  readonly entries: FileEntry[];
  readonly archiveInput: ReturnType<typeof selectBatchArchiveInput>;
  readonly summary: ReturnType<typeof selectBatchSelectionSummary>;
  isSelected(path: string): boolean;
  toggle(entry: FileEntry, origin: SelectionOrigin): void;
  clear(): void;
  rebind(sourcePath: string, entry: FileEntry): void;
  removeDeleted(path: string): void;
  retain(paths: readonly string[]): void;
  capture(): BatchSelectionCapture;
  removeCaptured(capture: BatchSelectionCapture): void;
}

export function useBatchSelection(accountId: string | undefined): BatchSelectionController {
  const [state, setState] = useState(() => createBatchSelectionState(accountId));
  let currentState = state;
  if (state.accountId !== accountId) {
    currentState = replaceBatchSelectionAccount(state, accountId);
    setState(currentState);
  }

  const activeAccountId = accountId ?? "";
  const update = useCallback((transition: (current: typeof state) => typeof state) => {
    setState((current) => current.accountId === accountId ? transition(current) : current);
  }, [accountId]);
  const clear = useCallback(() => {
    update((current) => clearBatchSelection(current, activeAccountId));
  }, [activeAccountId, update]);

  return {
    memberships: currentState.memberships,
    entries: selectBatchEntries(currentState),
    archiveInput: selectBatchArchiveInput(currentState),
    summary: selectBatchSelectionSummary(currentState),
    isSelected(path) {
      return isBatchPathSelected(currentState, path);
    },
    toggle(entry, origin) {
      update((current) => toggleBatchSelection(current, activeAccountId, entry, origin).state);
    },
    clear,
    rebind(sourcePath, entry) {
      update((current) => rebindBatchSelection(current, activeAccountId, sourcePath, entry));
    },
    removeDeleted(path) {
      update((current) => removeDeletedPath(current, activeAccountId, path));
    },
    retain(paths) {
      update((current) => retainBatchSelectionPaths(current, activeAccountId, paths));
    },
    capture() {
      return captureBatchSelection(currentState);
    },
    removeCaptured(capture) {
      update((current) => removeCapturedSelection(current, capture));
    }
  };
}
