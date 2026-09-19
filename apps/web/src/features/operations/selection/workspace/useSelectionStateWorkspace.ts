import type { FileEntry } from "@davora/shared";
import { useLayoutEffect, useMemo, useRef } from "react";

import { useBatchSelection } from "../useBatchSelection";
import { useFocusedSelection } from "../useFocusedSelection";
import { SelectionWorkspaceEpoch } from "./ports";
import type { FocusedSelectionCapture } from "../model";
import type {
  SelectionStateWorkspaceCommands,
  SelectionStateWorkspaceInput,
  SelectionStateWorkspaceOutput,
  SelectionStateWorkspaceSnapshot
} from "./ports";

function cloneEntry(entry: FileEntry): FileEntry {
  return { ...entry };
}

export function useSelectionStateWorkspace(
  input: SelectionStateWorkspaceInput
): SelectionStateWorkspaceOutput {
  const accountId = input.accountId;
  // The epoch must be replaced exactly when the account identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const epoch = useMemo(() => SelectionWorkspaceEpoch.create(), [accountId]);
  const committedEpochRef = useRef(epoch);
  const focused = useFocusedSelection(accountId);
  const batch = useBatchSelection(accountId);
  const clearFocused = focused.clear;
  const clearBatch = batch.clear;

  useLayoutEffect(() => {
    committedEpochRef.current = epoch;
    clearFocused();
    clearBatch();
  }, [clearBatch, clearFocused, epoch]);

  const snapshot = useMemo<SelectionStateWorkspaceSnapshot>(() => ({
    accountId,
    focused: {
      selectedEntry: focused.selectedEntry ? { ...focused.selectedEntry } : undefined,
      mobileSubview: focused.mobileSubview,
      hasSelection: focused.hasSelection
    },
    batch: {
      memberships: batch.memberships.map((membership) => ({
        ...membership,
        identity: { ...membership.identity },
        descriptor: { ...membership.descriptor },
        origin: { ...membership.origin }
      })),
      entries: batch.entries.map(cloneEntry),
      archiveInput: {
        archiveLabel: batch.archiveInput.archiveLabel,
        roots: batch.archiveInput.roots.map((root) => ({
          archiveRoot: root.archiveRoot,
          entry: cloneEntry(root.entry)
        }))
      },
      summary: { ...batch.summary }
    }
  }), [accountId, batch.archiveInput, batch.entries, batch.memberships, batch.summary, focused.hasSelection, focused.mobileSubview, focused.selectedEntry]);

  const commands = useMemo<SelectionStateWorkspaceCommands>(() => {
    const isCurrentEpoch = () => committedEpochRef.current === epoch;
    return {
      selectFocused: (entry) => {
        if (isCurrentEpoch()) focused.select(entry);
      },
      toggleFocused: (entry) => {
        if (isCurrentEpoch()) focused.toggle(entry);
      },
      clearFocused: () => {
        if (isCurrentEpoch()) focused.clear();
      },
      clearFocusedIfCurrent: (capture) => {
        if (isCurrentEpoch()) focused.clearIfCurrent(capture);
      },
      rebindFocusedIfCurrent: (capture, entry) => {
        if (isCurrentEpoch()) focused.rebindIfCurrent(capture, entry);
      },
      removeDeletedFocused: (path) => {
        if (isCurrentEpoch()) focused.removeDeleted(path);
      },
      showMobileActions: () => {
        if (isCurrentEpoch()) focused.showMobileActions();
      },
      showMobileDetails: () => {
        if (isCurrentEpoch()) focused.showMobileDetails();
      },
      toggleBatch: (entry, origin) => {
        if (isCurrentEpoch()) batch.toggle(entry, origin);
      },
      clearBatch: () => {
        if (isCurrentEpoch()) batch.clear();
      },
      rebindBatch: (sourcePath, entry) => {
        if (isCurrentEpoch()) batch.rebind(sourcePath, entry);
      },
      removeDeletedBatch: (path) => {
        if (isCurrentEpoch()) batch.removeDeleted(path);
      },
      retainBatch: (paths) => {
        if (isCurrentEpoch()) batch.retain(paths);
      },
      removeCapturedBatch: (capture) => {
        if (isCurrentEpoch()) batch.removeCaptured(capture);
      }
    };
  }, [batch, epoch, focused]);

  const captures = useMemo(() => {
    const isCurrentEpoch = () => committedEpochRef.current === epoch;
    return {
      focused: () => isCurrentEpoch() ? focused.capture() : undefined,
      batch: () => isCurrentEpoch()
        ? batch.capture()
        : { accountId: undefined, memberships: [] },
      isBatchSelected: (path: string) => isCurrentEpoch() && batch.isSelected(path),
      isFocusedCurrent: (capture: FocusedSelectionCapture | undefined) => isCurrentEpoch() && focused.isCurrent(capture)
    };
  }, [batch, epoch, focused]);

  return { epoch, snapshot, commands, captures };
}
