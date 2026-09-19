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

export type DestinationPlan =
  | {
      kind: "valid";
      destinationPath: string;
      targets: readonly DestinationTarget[];
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
  loading: boolean;
  reloadKey: number;
  error?: string;
}

export type DestinationPickerSnapshot = Omit<DestinationPickerState, "loading" | "reloadKey" | "error">;

export interface DestinationPickerInitialState extends DestinationPickerState {
  loading: true;
  reloadKey: 0;
  entries: [];
}
