import type { FileEntry, SearchResult } from "@davora/shared";
import { assertNever } from "@davora/shared";

import type { SortMode } from "./model";

export const isHiddenEntry = (entry: { name: string }): boolean => entry.name.startsWith(".");

export const sortAndGroupEntries = (entries: readonly FileEntry[], sortMode: SortMode): FileEntry[] => {
  const compareWithinGroup = (left: FileEntry, right: FileEntry): number => {
    switch (sortMode) {
      case "name-asc":
        return left.name.localeCompare(right.name);
      case "name-desc":
        return right.name.localeCompare(left.name);
      case "modified-desc":
        return (right.lastModified ?? "").localeCompare(left.lastModified ?? "");
      case "modified-asc":
        return (left.lastModified ?? "").localeCompare(right.lastModified ?? "");
      case "size-desc":
        return (right.size ?? 0) - (left.size ?? 0);
      case "size-asc":
        return (left.size ?? 0) - (right.size ?? 0);
      default:
        return assertNever(sortMode, "entry sort mode");
    }
  };

  return [...entries].sort((left, right) => {
    if (left.isFolder !== right.isFolder) {
      return left.isFolder ? -1 : 1;
    }
    return compareWithinGroup(left, right);
  });
};

export interface VisibleItemsInput {
  readonly browseEntries: readonly FileEntry[];
  readonly searchActive: boolean;
  readonly searchResults: readonly SearchResult[];
  readonly showHiddenFiles: boolean;
  readonly sortMode: SortMode;
}

export const selectVisibleItems = (input: VisibleItemsInput): FileEntry[] => {
  const entries = input.searchActive ? input.searchResults : input.browseEntries;
  const visibleEntries = entries.filter((entry) => input.showHiddenFiles || !isHiddenEntry(entry));
  return input.searchActive ? visibleEntries : sortAndGroupEntries(visibleEntries, input.sortMode);
};
