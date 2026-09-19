import type { FileEntry, FilePreview } from "@davora/shared";

import { resolveSelectedDetails } from "../presentation";

export interface OperationSelectionFactsInput {
  readonly focusedEntry?: FileEntry;
  readonly selectedPreview?: FilePreview;
  readonly batchCount: number;
}

export interface OperationSelectionFacts {
  readonly hasSelectedEntry: boolean;
  readonly selectedFilePath?: string;
  readonly selectedIsFolder: boolean;
  readonly batchSelectionCount: number;
}

export function projectOperationSelectionFacts(
  input: OperationSelectionFactsInput
): OperationSelectionFacts {
  const selectedDetails = resolveSelectedDetails(
    input.batchCount,
    input.focusedEntry,
    input.selectedPreview
  );
  return {
    hasSelectedEntry: Boolean(selectedDetails),
    selectedFilePath: selectedDetails && !selectedDetails.isFolder ? selectedDetails.path : undefined,
    selectedIsFolder: Boolean(selectedDetails?.isFolder),
    batchSelectionCount: input.batchCount
  };
}
