import type { FileEntry } from "@davora/shared";

import type { OperationContextToken } from "../policy";
import type { DestinationOperation, DestinationPickerState, DestinationPickerSnapshot, DestinationPlan } from "./model";
import {
  buildDestinationDraftPath,
  planDestination,
  resolveDestinationListingPath,
  suggestDestinationName
} from "./planner";

export function buildDestinationPlanFromPicker(
  picker: DestinationPickerSnapshot,
  operation: DestinationOperation
): DestinationPlan {
  if (picker.sourceEntries.length === 0) {
    return { kind: "invalid", destinationPath: "", message: "No selected item." };
  }

  if (picker.batch) {
    return planDestination({
      kind: "batch",
      operation,
      sources: picker.sourceEntries,
      destinationEntries: picker.entries,
      manualMode: picker.manualMode,
      folderPath: picker.folderPath,
      manualPath: picker.manualPath
    });
  }

  const [selectedEntry] = picker.sourceEntries;
  if (!selectedEntry) {
    return { kind: "invalid", destinationPath: "", message: "No selected item." };
  }
  return planDestination({
    kind: "single",
    operation,
    source: selectedEntry,
    destinationEntries: picker.entries,
    manualMode: picker.manualMode,
    folderPath: picker.folderPath,
    name: picker.name,
    manualPath: picker.manualPath
  });
}

export function matchesDestinationListing(
  previous: DestinationPickerState,
  capturedContext: OperationContextToken,
  folderPath: string,
  isCurrentOperationContext: (
    context: OperationContextToken,
    expected: OperationContextToken
  ) => boolean,
  currentContext: OperationContextToken
): boolean {
  const previousListingPath = resolveDestinationListingPath(previous);
  return isCurrentOperationContext(previous.context, capturedContext)
    && isCurrentOperationContext(capturedContext, currentContext)
    && previousListingPath.kind === "valid"
    && previousListingPath.path === folderPath;
}

export function updateDestinationPickerFolder(
  previous: DestinationPickerState,
  folderPath: string
): DestinationPickerState {
  return {
    ...previous,
    folderPath,
    name: previous.batch
      ? previous.name
      : previous.nameEdited
        ? previous.name
        : previous.sourceEntries[0]?.name ?? previous.name,
    manualPath: previous.manualMode
      ? previous.manualPath
      : previous.batch
        ? folderPath
        : buildDestinationDraftPath(
          folderPath,
          previous.nameEdited ? previous.name : previous.sourceEntries[0]?.name ?? previous.name
        ),
    entries: [],
    loading: true,
    reloadKey: previous.reloadKey + 1,
    error: undefined
  };
}

export function updateDestinationPickerName(
  previous: DestinationPickerState,
  name: string
): DestinationPickerState {
  return {
    ...previous,
    name,
    nameEdited: true,
    manualPath: previous.manualMode
      ? previous.manualPath
      : buildDestinationDraftPath(previous.folderPath, name)
  };
}

export function updateDestinationPickerManualMode(
  previous: DestinationPickerState,
  manualMode: boolean
): DestinationPickerState {
  return {
    ...previous,
    manualMode,
    manualPath: previous.batch
      ? previous.folderPath
      : buildDestinationDraftPath(previous.folderPath, previous.name)
  };
}

export function updateDestinationPickerManualPath(
  previous: DestinationPickerState,
  manualPath: string
): DestinationPickerState {
  return {
    ...previous,
    manualPath,
    ...(previous.manualMode ? { entries: [], loading: true, error: undefined } : {})
  };
}

export function reloadDestinationPickerFolder(
  previous: DestinationPickerState
): DestinationPickerState {
  return {
    ...previous,
    entries: [],
    loading: true,
    error: undefined,
    reloadKey: previous.reloadKey + 1
  };
}

export function applyDestinationListingSuccess(
  previous: DestinationPickerState,
  nextEntries: readonly FileEntry[]
): DestinationPickerState {
  const sourceEntry = previous.sourceEntries[0];
  const shouldSuggestName = !previous.batch
    && !previous.nameEdited
    && Boolean(sourceEntry)
    && (previous.kind === "copy" || previous.kind === "copyMove");
  const suggestedName = shouldSuggestName && sourceEntry
    ? suggestDestinationName(
      nextEntries,
      sourceEntry.name,
      sourceEntry,
      "copy"
    )
    : previous.name;
  return {
    ...previous,
    entries: [...nextEntries],
    name: suggestedName,
    manualPath: shouldSuggestName && !previous.manualMode
      ? buildDestinationDraftPath(previous.folderPath, suggestedName)
      : previous.manualPath,
    loading: false,
    error: undefined
  };
}

export function closeDestinationPickerIfCurrent(
  previous: DestinationPickerState | undefined,
  context: OperationContextToken,
  isCurrentOperationContext: (
    context: OperationContextToken,
    expected: OperationContextToken
  ) => boolean
): DestinationPickerState | undefined {
  return previous && isCurrentOperationContext(previous.context, context)
    ? undefined
    : previous;
}

export function updateDestinationPickerFailedSourcesIfCurrent(
  previous: DestinationPickerState | undefined,
  context: OperationContextToken,
  pickerStillCurrent: () => boolean,
  failedEntries: readonly FileEntry[],
  isCurrentOperationContext: (
    context: OperationContextToken,
    expected: OperationContextToken
  ) => boolean
): DestinationPickerState | undefined {
  return previous
    && isCurrentOperationContext(previous.context, context)
    && pickerStillCurrent()
    ? { ...previous, sourceEntries: [...failedEntries] }
    : previous;
}

export function selectCurrentDestinationPicker(
  picker: DestinationPickerState | undefined,
  currentContext: OperationContextToken,
  isCurrentOperationContext: (
    context: OperationContextToken,
    expected: OperationContextToken
  ) => boolean
): DestinationPickerState | undefined {
  return picker && isCurrentOperationContext(picker.context, currentContext)
    ? picker
    : undefined;
}
