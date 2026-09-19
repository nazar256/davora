import type { FileEntry } from "@davora/shared";
import { basename } from "@davora/shared";

import type { BatchSelectionState } from "./model";

export interface BatchSelectionSummary {
  readonly count: number;
  readonly fileCount: number;
  readonly folderCount: number;
  readonly knownFileSizeBytes: number;
  readonly unknownSizeCount: number;
}

export interface BatchArchiveRoot {
  readonly entry: FileEntry;
  readonly archiveRoot: string;
}

export interface BatchArchiveInput {
  readonly roots: readonly BatchArchiveRoot[];
  readonly archiveLabel: string;
}

export function selectBatchEntries(state: BatchSelectionState): FileEntry[] {
  return state.memberships.map((membership) => ({ ...membership.descriptor }));
}

export function isBatchPathSelected(state: BatchSelectionState, path: string): boolean {
  return state.memberships.some((membership) => membership.identity.path === path);
}

export function selectBatchSelectionSummary(state: BatchSelectionState): BatchSelectionSummary {
  let fileCount = 0;
  let folderCount = 0;
  let knownFileSizeBytes = 0;
  let unknownSizeCount = 0;
  for (const { descriptor } of state.memberships) {
    if (descriptor.isFolder) {
      folderCount += 1;
      unknownSizeCount += 1;
    } else {
      fileCount += 1;
      if (descriptor.size === undefined) {
        unknownSizeCount += 1;
      } else {
        knownFileSizeBytes += descriptor.size;
      }
    }
  }
  return { count: state.memberships.length, fileCount, folderCount, knownFileSizeBytes, unknownSizeCount };
}

export function selectBatchArchiveInput(state: BatchSelectionState): BatchArchiveInput {
  const roots = state.memberships.map(({ descriptor, origin }) => {
    if (origin.kind === "search") {
      return { entry: { ...descriptor }, archiveRoot: descriptor.path };
    }
    const prefix = origin.folderPath ? `${origin.folderPath}/` : "";
    const archiveRoot = prefix && descriptor.path.startsWith(prefix)
      ? descriptor.path.slice(prefix.length)
      : descriptor.path;
    return { entry: { ...descriptor }, archiveRoot };
  });
  const origins = state.memberships.map((membership) => membership.origin);
  const allSearch = origins.length > 0 && origins.every((origin) => origin.kind === "search");
  const browseFolders = new Set(origins.flatMap((origin) => origin.kind === "browse" ? [origin.folderPath] : []));
  const allOneBrowseFolder = origins.length > 0 && browseFolders.size === 1 && origins.every((origin) => origin.kind === "browse");
  const archiveLabel = allSearch
    ? "search-results"
    : allOneBrowseFolder
      ? basename([...browseFolders][0] ?? "") || "home"
      : "selection";
  return { roots, archiveLabel };
}
