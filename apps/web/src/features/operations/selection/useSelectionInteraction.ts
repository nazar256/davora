import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import {
  clearBatchSelection as clearBatchSelectionController,
  toggleBatchSelectionEntry as toggleBatchSelectionEntryController,
  toggleEntrySelection as toggleEntrySelectionController
} from "./controller";
import { ROW_LONG_PRESS_DELAY_MS } from "./interaction";
import type { SelectionInteractionPorts } from "./ports";

export interface UseSelectionInteractionInput {
  ports: SelectionInteractionPorts;
  isCurrentOperationHandler(): boolean;
  isMarkBatchAllowed(): boolean;
  canMarkForBatchDownload(): boolean;
  captureEpoch?(): unknown;
  isEpochCurrent?(epoch: unknown): boolean;
}

export interface SelectionInteractionController {
  toggleEntrySelection(entry: FileEntry): void;
  toggleBatchSelectionEntry(entry: FileEntry): void;
  clearBatchSelection(): void;
  startRowLongPressSelection(entry: FileEntry): void;
  clearRowLongPressTimer(): void;
  clearRowOpenSuppression(): void;
  getRowOpenSuppressed(): boolean;
}

export function useSelectionInteraction(input: UseSelectionInteractionInput): SelectionInteractionController {
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);
  const timerRef = useRef<number | undefined>();
  const handledRef = useRef(false);

  const clearRowLongPressTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      inputRef.current.ports.timer.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => () => clearRowLongPressTimer(), [clearRowLongPressTimer]);

  const toggleEntrySelection = useCallback((entry: FileEntry) => {
    toggleEntrySelectionController(entry, inputRef.current.ports);
  }, []);

  const toggleBatchSelectionEntry = useCallback((entry: FileEntry) => {
    toggleBatchSelectionEntryController(entry, inputRef.current.ports, {
      isCurrentOperationHandler: () => inputRef.current.isCurrentOperationHandler(),
      isMarkBatchAllowed: () => inputRef.current.isMarkBatchAllowed()
    });
  }, []);

  const clearBatchSelection = useCallback(() => {
    clearBatchSelectionController(inputRef.current.ports);
  }, []);

  const startRowLongPressSelection = useCallback((entry: FileEntry) => {
    const current = inputRef.current;
    if (!current.ports.chrome.isNarrowScreen() || !current.canMarkForBatchDownload()) {
      return;
    }
    clearRowLongPressTimer();
    handledRef.current = false;
    const pendingEpoch = current.captureEpoch?.();
    const pendingScopePath = current.ports.scope.getCurrentPath();
    const pendingSearchActive = current.ports.scope.isSearchActive();
    timerRef.current = current.ports.timer.setTimeout(() => {
      timerRef.current = undefined;
      const latest = inputRef.current;
      if (latest.isEpochCurrent && !latest.isEpochCurrent(pendingEpoch)) {
        return;
      }
      const latestScope = latest.ports.scope;
      if (latestScope.getCurrentPath() !== pendingScopePath || latestScope.isSearchActive() !== pendingSearchActive) {
        return;
      }
      const toggled = toggleBatchSelectionEntryController(entry, latest.ports, {
        isCurrentOperationHandler: () => inputRef.current.isCurrentOperationHandler(),
        isMarkBatchAllowed: () => inputRef.current.isMarkBatchAllowed()
      });
      if (toggled) {
        handledRef.current = true;
      }
    }, ROW_LONG_PRESS_DELAY_MS);
  }, [clearRowLongPressTimer]);

  return {
    toggleEntrySelection,
    toggleBatchSelectionEntry,
    clearBatchSelection,
    startRowLongPressSelection,
    clearRowLongPressTimer,
    clearRowOpenSuppression: () => {
      handledRef.current = false;
    },
    getRowOpenSuppressed: () => handledRef.current
  };
}
