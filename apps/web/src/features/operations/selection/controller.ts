import type { FileEntry } from "@davora/shared";

import {
  planBatchSelectionToggle,
  planClearBatchSelection,
  planEntrySelectionToggle,
  type SelectionInteractionPlan
} from "./interaction";
import type { SelectionInteractionPorts } from "./ports";

export function applySelectionInteractionPlan(
  plan: SelectionInteractionPlan,
  ports: SelectionInteractionPorts
): void {
  if (plan.batchClear) {
    ports.batch.clear();
  }
  if (plan.batchToggle) {
    ports.batch.toggle(plan.batchToggle.entry, plan.batchToggle.origin);
  }
  for (const action of plan.focused) {
    if (action.kind === "select") {
      ports.focused.select(action.entry);
    } else {
      ports.focused.clear();
    }
  }
  for (const action of plan.chrome) {
    switch (action.kind) {
      case "openMobileDetails":
        ports.chrome.openMobileDetails({ pushHistory: action.pushHistory });
        break;
      case "closeMobileDetails":
        ports.chrome.closeMobileDetails();
        break;
    }
  }
}

export function toggleEntrySelection(entry: FileEntry, ports: SelectionInteractionPorts): void {
  const selectedEntry = ports.focused.current();
  applySelectionInteractionPlan(planEntrySelectionToggle({
    entry,
    selectedEntryPath: selectedEntry?.path,
    isNarrowScreen: ports.chrome.isNarrowScreen(),
    mobileDetailsOpen: ports.chrome.isMobileDetailsOpen()
  }), ports);
}

export function toggleBatchSelectionEntry(
  entry: FileEntry,
  ports: SelectionInteractionPorts,
  gate: { isCurrentOperationHandler(): boolean; isMarkBatchAllowed(): boolean }
): boolean {
  if (!gate.isCurrentOperationHandler() || !gate.isMarkBatchAllowed()) {
    return false;
  }
  const selectedEntry = ports.focused.current();
  applySelectionInteractionPlan(planBatchSelectionToggle({
    entry,
    selectedEntryPath: selectedEntry?.path,
    wasBatchSelected: ports.batch.isSelected(entry.path),
    searchActive: ports.scope.isSearchActive(),
    currentPath: ports.scope.getCurrentPath()
  }), ports);
  return true;
}

export function clearBatchSelection(ports: SelectionInteractionPorts): void {
  applySelectionInteractionPlan(planClearBatchSelection({
    hasSelectedEntry: Boolean(ports.focused.current()),
    hasSelectedPreview: ports.focused.hasSelectedPreview()
  }), ports);
}
