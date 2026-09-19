import type { FileEntry } from "@davora/shared";

import type { FolderState } from "./model";

export const selectFolderItems = (state: FolderState): FileEntry[] => {
  switch (state.kind) {
    case "refreshing":
    case "ready":
    case "stale":
    case "offline":
      return state.items;
    case "idle":
    case "initialLoading":
    case "failed":
      return [];
  }
};

export const selectFolderError = (state: FolderState): Error | undefined =>
  state.kind === "failed" ? state.error : undefined;

export const isFolderInitialLoading = (state: FolderState): boolean => state.kind === "initialLoading";

export const isFolderRefreshing = (state: FolderState): boolean => state.kind === "refreshing";

export const isFolderStale = (state: FolderState): boolean => state.kind === "refreshing" || state.kind === "stale";

export const hasKnownFolderContents = (state: FolderState): boolean =>
  state.kind === "refreshing" || state.kind === "ready" || state.kind === "stale" || state.kind === "offline";
