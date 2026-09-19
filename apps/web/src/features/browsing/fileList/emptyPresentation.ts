export interface FileListEmptyPresentationInput {
  readonly visibleItemCount: number;
  readonly searchActive: boolean;
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

export function buildFileListEmptyPresentation(input: FileListEmptyPresentationInput): FileListEmptyPresentation {
  const listRecoveryAvailable = Boolean(input.folderError)
    && !input.searchActive
    && !input.loadingFolder
    && !input.cacheOnlyMode;
  const showEmptyState = input.visibleItemCount === 0
    && !(input.loadingFolder && !input.hasEverCachedFolder && !input.searchActive);
  const emptyTitle = input.searchActive
    ? input.visibleListError
      ? "Unable to load search results."
      : "No files match this search yet."
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
