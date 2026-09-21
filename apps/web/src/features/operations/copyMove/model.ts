import type { FileEntry } from "@davora/shared";
import { dirname } from "@davora/shared";

import type { DestinationOperation, DestinationPickerInitialState, DestinationPickerSnapshot, ResolvedDestinationTarget } from "../destination";
import type { OperationContextToken } from "../policy";

export type BatchCopyMoveOperation = "copy" | "move";

export type CopyMoveTargetMode = "write" | "overwrite" | "merge";

export interface BatchCopyMoveTarget {
  readonly source: FileEntry;
  readonly destinationPath: string;
  readonly mode: CopyMoveTargetMode;
}

export type CopyMoveItemStatus = "done" | "skipped" | "failed";

export interface CopyMoveSettledItem {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly isFolder: boolean;
  readonly size?: number;
  readonly status: CopyMoveItemStatus;
  readonly error?: string;
}

export interface BatchCopyMoveInput {
  readonly operation: BatchCopyMoveOperation;
  readonly targets: readonly BatchCopyMoveTarget[];
  /** Pre-resolved conflicts the user chose to skip — reported but never executed. */
  readonly skipped?: readonly FileEntry[];
  /** Whether nested merge conflicts replace when source size >= existing size. */
  readonly applySizeRule?: boolean;
}

export interface BatchCopyMoveFailure {
  readonly sourcePath: string;
  readonly message: string;
}

interface BatchCopyMoveOutcomeBase {
  readonly completedCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
  readonly failures: readonly BatchCopyMoveFailure[];
}

export type BatchCopyMoveOutcome =
  | (BatchCopyMoveOutcomeBase & { readonly kind: "completed" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "partial" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "sessionTerminated" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "canceled" })
  | (BatchCopyMoveOutcomeBase & { readonly kind: "superseded" });

export type CopyMovePickerSnapshot = DestinationPickerSnapshot;

export type CopyMoveDestinationPickerInitialState = DestinationPickerInitialState;

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
  toDisplayPath: (path: string) => string,
  skippedCount = 0
): string {
  const skipped = skippedCount > 0 ? ` ${pluralize(skippedCount, "item")} skipped.` : "";
  return `${operationLabel} ${pluralize(batchTargetCount, "selected item")} to ${toDisplayPath(destinationPath)} in ${accountName}.${skipped}`;
}

export function buildCopyMoveSkippedStatus(
  operationLabel: "Copied" | "Moved",
  skippedCount: number,
  accountName: string
): string {
  return `Nothing ${operationLabel.toLowerCase()} — ${pluralize(skippedCount, "item")} skipped in ${accountName}.`;
}

export function buildCopyMoveQueuedStatus(
  operation: DestinationOperation,
  targetCount: number,
  destinationPath: string,
  accountName: string,
  toDisplayPath: (path: string) => string
): string {
  const verb = operation === "move" ? "Moving" : "Copying";
  return `${verb} ${pluralize(targetCount, "item")} to ${toDisplayPath(destinationPath)} in ${accountName}…`;
}

export function buildBatchCopyMoveCanceledStatus(
  operation: DestinationOperation,
  completedCount: number,
  totalCount: number,
  accountName: string
): string {
  const noun = operation === "move" ? "Move" : "Copy";
  return `${noun} canceled after ${completedCount} of ${pluralize(totalCount, "item")} in ${accountName}.`;
}

export function buildCopyMoveTaskLabel(
  sources: readonly Pick<FileEntry, "name">[]
): string {
  return sources.length === 1 ? sources[0]?.name ?? "item" : pluralize(sources.length, "item");
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

export function mapResolvedTargets(
  targets: readonly ResolvedDestinationTarget[]
): readonly BatchCopyMoveTarget[] {
  return targets.map((target) => ({
    source: target.source,
    destinationPath: target.destinationPath,
    mode: target.merge ? "merge" : target.overwrite ? "overwrite" : "write"
  }));
}
