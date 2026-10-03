import type { FileEntry } from "@davora/shared";

import type { OperationContextToken } from "../policy";

export type DestinationOperation = "move" | "copy";

export type DestinationActionKind = DestinationOperation | "copyMove";

interface DestinationPlanBase {
  operation: DestinationOperation;
  destinationEntries: readonly FileEntry[];
  manualMode: boolean;
  folderPath: string;
  manualPath: string;
}

export interface SingleDestinationPlanInput extends DestinationPlanBase {
  kind: "single";
  source: FileEntry;
  name: string;
}

export interface BatchDestinationPlanInput extends DestinationPlanBase {
  kind: "batch";
  sources: readonly FileEntry[];
}

export type DestinationPlanInput = SingleDestinationPlanInput | BatchDestinationPlanInput;

export interface DestinationTarget {
  source: FileEntry;
  destinationPath: string;
}

export interface PlannedDestinationConflict {
  readonly source: FileEntry;
  readonly existing: FileEntry;
  readonly destinationPath: string;
  readonly isSelfCollision: boolean;
}

export type DestinationConflictDecision = "replace" | "merge" | "keepBoth" | "skip";

export interface DestinationConflictReviewItem {
  readonly source: FileEntry;
  readonly existing: FileEntry;
  readonly destinationPath: string;
  readonly isSelfCollision: boolean;
  readonly allowedDecisions: readonly DestinationConflictDecision[];
  readonly decision?: DestinationConflictDecision;
}

export interface DestinationConflictReview {
  readonly operation: DestinationOperation;
  readonly destinationPath: string;
  readonly targets: readonly DestinationTarget[];
  readonly items: readonly DestinationConflictReviewItem[];
  readonly applySizeRule: boolean;
}

export interface ResolvedDestinationTarget {
  readonly source: FileEntry;
  readonly destinationPath: string;
  readonly overwrite: boolean;
  readonly merge: boolean;
}

export interface ResolvedDestinationConflicts {
  readonly targets: readonly ResolvedDestinationTarget[];
  readonly skipped: readonly FileEntry[];
}

export type DestinationPlan =
  | {
      kind: "valid";
      destinationPath: string;
      targets: readonly DestinationTarget[];
      conflicts: readonly PlannedDestinationConflict[];
    }
  | {
      kind: "invalid";
      destinationPath: string;
      message: string;
    };

export interface DestinationListingInput {
  batch: boolean;
  manualMode: boolean;
  folderPath: string;
  manualPath: string;
}

export type DestinationListingPath =
  | { kind: "valid"; path: string }
  | { kind: "invalid"; message: string };

export interface DestinationPickerState {
  context: OperationContextToken;
  kind: DestinationActionKind;
  sourceEntries: FileEntry[];
  batch: boolean;
  folderPath: string;
  name: string;
  nameEdited: boolean;
  manualPath: string;
  manualMode: boolean;
  entries: FileEntry[];
  completeness?: "complete" | "partial";
  loading: boolean;
  reloadKey: number;
  error?: string;
  conflictReview?: DestinationConflictReview;
}

export type DestinationPickerSnapshot = Omit<DestinationPickerState, "reloadKey" | "error">;

export interface DestinationPickerInitialState extends DestinationPickerState {
  loading: true;
  reloadKey: 0;
  entries: [];
}
