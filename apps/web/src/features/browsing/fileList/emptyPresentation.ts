import type { SearchCoverage } from "../search";

export interface FileListEmptyPresentationInput {
  readonly visibleItemCount: number;
  readonly searchActive: boolean;
  readonly searchCoverage?: SearchCoverage;
  readonly loadingFolder: boolean;
  readonly hasEverCachedFolder: boolean;
  readonly visibleListError?: Error;
  readonly locationLabel: string;
  readonly folderError?: Error;
  readonly cacheOnlyMode: boolean;
}

export interface FileListEmptyPresentation {
  readonly showEmptyState: boolean;
  readonly emptyTitle: string;
  readonly emptyStatus: string;
  readonly listRecoveryAvailable: boolean;
}

const searchEmptyTitles: Record<SearchCoverage, string> = {
  complete: "No matches in this folder.",
  partial: "No matches in the searched portion.",
  saved: "No matches in saved results.",
  offline: "No matches in saved files.",
  failed: "Unable to load search results.",
  searching: "Searching…"
};

export function buildFileListEmptyPresentation(input: FileListEmptyPresentationInput): FileListEmptyPresentation {
  const listRecoveryAvailable = Boolean(input.folderError)
    && !input.searchActive
    && !input.loadingFolder
    && !input.cacheOnlyMode;
  const showEmptyState = input.visibleItemCount === 0
    && (!input.searchActive || (input.searchCoverage !== "searching" && input.searchCoverage !== undefined))
    && !(input.loadingFolder && !input.hasEverCachedFolder && !input.searchActive);
  const emptyTitle = input.searchActive
    ? input.visibleListError
      ? "Unable to load search results."
      : searchEmptyTitles[input.searchCoverage ?? "searching"]
    : input.visibleListError
      ? input.hasEverCachedFolder
        ? "Unable to load this folder."
        : "Couldn't load this folder. Its contents are unknown."
      : "This folder is empty.";
  const emptyStatus = input.visibleListError
    ? input.visibleListError.message
    : input.searchActive
      ? `Search scope: ${input.locationLabel}`
      : `Location: ${input.locationLabel}`;

  return {
    showEmptyState,
    emptyTitle,
    emptyStatus,
    listRecoveryAvailable
  };
}
