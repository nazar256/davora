import type { FileEntry } from "@davora/shared";
import { dirname } from "@davora/shared";

import type { DestinationOperation, DestinationPickerInitialState, DestinationPickerSnapshot, DestinationTarget } from "../destination";
import type { OperationContextToken } from "../policy";

export type BatchCopyMoveOperation = "copy" | "move";

export interface BatchCopyMoveTarget {
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export interface BatchCopyMoveInput {
  readonly operation: BatchCopyMoveOperation;
  readonly targets: readonly BatchCopyMoveTarget[];
}

export interface BatchCopyMoveFailure {
  readonly target: BatchCopyMoveTarget;
  readonly message: string;
}

interface BatchCopyMoveOutcomeBase {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly failures: readonly BatchCopyMoveFailure[];
}

export type BatchCopyMoveOutcome =
  | (BatchCopyMoveOutcomeBase & { readonly kind: "completed" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "partial" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "sessionTerminated" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "superseded" });

export type CopyMovePickerSnapshot = DestinationPickerSnapshot;

export type CopyMoveDestinationPickerInitialState = DestinationPickerInitialState;

export interface CopyMovePartialFailure {
  readonly entry: FileEntry;
  readonly message: string;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildCopyMoveOperationLabel(operation: DestinationOperation): "Copied" | "Moved" {
  return operation === "move" ? "Moved" : "Copied";
}

export { buildDestinationPlanFromPicker } from "../destination/pickerState";

export function buildMovePickerInitialState(
  context: OperationContextToken,
  selectedEntry: FileEntry
): CopyMoveDestinationPickerInitialState {
  const initialFolder = dirname(selectedEntry.path);
  return {
    context,
    kind: "move",
    sourceEntries: [selectedEntry],
    batch: false,
    folderPath: initialFolder,
    name: selectedEntry.name,
    nameEdited: false,
    manualPath: selectedEntry.path,
    manualMode: false,
    entries: [],
    loading: true,
    reloadKey: 0
  };
}

export function buildSingleCopyMovePickerInitialState(
  context: OperationContextToken,
  selectedEntry: FileEntry
): CopyMoveDestinationPickerInitialState {
  const initialFolder = dirname(selectedEntry.path);
  return {
    context,
    kind: "copyMove",
    sourceEntries: [selectedEntry],
    batch: false,
    folderPath: initialFolder,
    name: selectedEntry.name,
    nameEdited: false,
    manualPath: selectedEntry.path,
    manualMode: false,
    entries: [],
    loading: true,
    reloadKey: 0
  };
}

export function buildBatchCopyMovePickerInitialState(
  context: OperationContextToken,
  sourceEntries: readonly FileEntry[],
  currentPath: string
): CopyMoveDestinationPickerInitialState {
  return {
    context,
    kind: "copyMove",
    sourceEntries: [...sourceEntries],
    batch: true,
    folderPath: currentPath,
    name: "",
    nameEdited: false,
    manualPath: currentPath,
    manualMode: false,
    entries: [],
    loading: true,
    reloadKey: 0
  };
}

export function buildBatchCopyMoveSuccessStatus(
  operationLabel: "Copied" | "Moved",
  batchTargetCount: number,
  destinationPath: string,
  accountName: string,
  toDisplayPath: (path: string) => string
): string {
  return `${operationLabel} ${pluralize(batchTargetCount, "selected item")} to ${toDisplayPath(destinationPath)} in ${accountName}.`;
}

export function buildBatchCopyMovePartialActionError(
  operationLabel: "Copied" | "Moved",
  completedCount: number,
  totalCount: number,
  failures: readonly CopyMovePartialFailure[]
): string {
  return `${operationLabel} ${completedCount} of ${totalCount} selected items; ${failures.length} failed. ${failures.map((failure) => `${failure.entry.path}: ${failure.message}`).join("; ")}`;
}

export function buildBatchCopyMovePartialStatus(
  operationLabel: "Copied" | "Moved",
  completedCount: number,
  totalCount: number,
  failureCount: number,
  accountName: string
): string {
  return `${operationLabel} ${completedCount} of ${totalCount} selected items; ${failureCount} failed in ${accountName}.`;
}

export function deriveRetainedFailedEntries(
  sourceEntriesByPath: ReadonlyMap<string, FileEntry>,
  failures: readonly BatchCopyMoveFailure[]
): CopyMovePartialFailure[] {
  return failures.map((failure) => {
    const entry = sourceEntriesByPath.get(failure.target.sourcePath);
    if (!entry) {
      throw new Error("Batch copy/move outcome referenced an unknown source.");
    }
    return { entry, message: failure.message };
  });
}

export function shouldCloseDestinationPickerAfterSubmit(
  pickerStillCurrent: boolean
): boolean {
  return pickerStillCurrent;
}

export function shouldRetainDestinationPickerAfterPartialBatch(): boolean {
  return true;
}

export function mapBatchTargets(
  targets: readonly DestinationTarget[]
): readonly BatchCopyMoveTarget[] {
  return targets.map((target) => ({
    sourcePath: target.source.path,
    destinationPath: target.destinationPath
  }));
}
