import type { FileEntry, FilePreview } from "@davora/shared";
import { toDisplayPath } from "@davora/shared";

import { formatBrowseCount, getSearchDisplayQuery } from "../../browsing";
import {
  formatPreviewFileTimestamp,
  normalizePreviewMimeType,
  viewerHeading
} from "../../preview/shell";
import { formatFileSize, type FileSizeDisplayMode } from "../../../lib/fileSize";
import { buildDownloadSelectionLabel } from "../download/model";

import type { BatchSelectionSummary } from "./selectors";

export interface SelectionDetailsSingleItem {
  readonly name: string;
  readonly displayPath: string;
  readonly typeLabel: string;
  readonly modifiedLabel: string;
  readonly sizeLabel: string;
  readonly includedInSelection: boolean;
  readonly isFolder: boolean;
  readonly canOpen: boolean;
  readonly panelHeading: "Selected folder" | "Selected file";
  readonly ariaLabel: string;
}

export interface SelectionDetailsBatchSummary {
  readonly count: number;
  readonly countLabel: string;
  readonly selectionLabel: string;
  readonly fileCount: number;
  readonly folderCount: number;
  readonly sizeLabel: string;
  readonly ariaLabel: string;
}

export interface SelectionDetailsWorkspaceSummary {
  readonly folderLabel: string;
  readonly locationLabel: string;
  readonly itemsLabel: string;
  readonly itemsHeading: string;
  readonly searchActive: boolean;
  readonly searchQuery?: string;
  readonly modeLabel: string;
  readonly staleInfo?: string;
}

export type SelectionDetailsContent =
  | { readonly kind: "single"; readonly item: SelectionDetailsSingleItem }
  | { readonly kind: "batch"; readonly batch: SelectionDetailsBatchSummary }
  | { readonly kind: "workspace"; readonly workspace: SelectionDetailsWorkspaceSummary };

export interface SelectionPresentationFormatters {
  readonly formatCacheTimestamp: (value: string) => string | undefined;
}

const defaultFormatters: SelectionPresentationFormatters = {
  formatCacheTimestamp: (value) => (value ? new Date(value).toLocaleString() : undefined)
};

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function resolveMatchedSelectedPreview(
  selectedEntry: FileEntry | undefined,
  selected: FilePreview | undefined
): FilePreview | undefined {
  return selectedEntry && selected && selectedEntry.path === selected.path ? selected : undefined;
}

export function resolveSelectedDetails(
  batchSelectionCount: number,
  selectedEntry: FileEntry | undefined,
  selected: FilePreview | undefined
): FileEntry | undefined {
  if (batchSelectionCount > 0) {
    return undefined;
  }
  const matchedPreview = resolveMatchedSelectedPreview(selectedEntry, selected);
  return matchedPreview ?? selectedEntry;
}

export function resolveSelectedTypeLabel(
  selectedDetails: FileEntry,
  matchedPreview: FilePreview | undefined
): string {
  if (selectedDetails.isFolder) {
    return "Folder";
  }
  if (matchedPreview?.viewer) {
    return viewerHeading(matchedPreview.viewer).replace(" preview", "");
  }
  return normalizePreviewMimeType(selectedDetails.mimeType) ?? "File";
}

export function buildBatchSelectionSizeLabel(
  summary: BatchSelectionSummary,
  fileSizeDisplayMode: FileSizeDisplayMode
): string {
  const parts = [
    summary.knownFileSizeBytes > 0
      ? `${formatFileSize(summary.knownFileSizeBytes, fileSizeDisplayMode)} known`
      : undefined,
    summary.unknownSizeCount > 0
      ? `${pluralize(summary.unknownSizeCount, "item")} unknown or folder-sized`
      : undefined
  ].filter(Boolean);
  return parts.join("; ") || "No known file size";
}

export function buildWorkspaceModeLabel(input: {
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
}): string {
  if (input.explicitOfflineMode) {
    return "Offline mode";
  }
  if (input.offline) {
    return "Offline";
  }
  if (input.workerUnavailable) {
    return "Server unavailable";
  }
  return "Online";
}

export function buildWorkspaceStaleInfo(
  explicitOfflineMode: boolean,
  folderCachedAt: string | undefined,
  formatters: SelectionPresentationFormatters = defaultFormatters
): string | undefined {
  if (explicitOfflineMode || !folderCachedAt) {
    return undefined;
  }
  const formatted = formatters.formatCacheTimestamp(folderCachedAt);
  return formatted ? `Cached ${formatted}` : undefined;
}

export interface BuildSelectionDetailsContentInput {
  readonly selectedEntry?: FileEntry;
  readonly selected?: FilePreview;
  readonly batchSelectionCount: number;
  readonly batchSelectionSummary: BatchSelectionSummary;
  readonly isPathInBatchSelection: (path: string) => boolean;
  readonly hasSelectedEntry: boolean;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly workspace: {
    readonly folderLabel: string;
    readonly locationLabel: string;
    readonly visibleItemCount: number;
    readonly searchActive: boolean;
    readonly searchQuery: string;
    readonly explicitOfflineMode: boolean;
    readonly offline: boolean;
    readonly workerUnavailable: boolean;
    readonly folderCachedAt?: string;
  };
  readonly formatters?: SelectionPresentationFormatters;
}

export function buildSelectionDetailsContent(
  input: BuildSelectionDetailsContentInput
): SelectionDetailsContent {
  const formatters = input.formatters ?? defaultFormatters;
  const selectedDetails = resolveSelectedDetails(
    input.batchSelectionCount,
    input.selectedEntry,
    input.selected
  );
  const matchedPreview = selectedDetails
    ? resolveMatchedSelectedPreview(input.selectedEntry, input.selected)
    : undefined;

  if (selectedDetails) {
    return {
      kind: "single",
      item: {
        name: selectedDetails.name,
        displayPath: toDisplayPath(selectedDetails.path),
        typeLabel: resolveSelectedTypeLabel(selectedDetails, matchedPreview),
        modifiedLabel: formatPreviewFileTimestamp(selectedDetails.lastModified),
        sizeLabel: formatFileSize(selectedDetails.size, input.fileSizeDisplayMode),
        includedInSelection: input.isPathInBatchSelection(selectedDetails.path),
        isFolder: selectedDetails.isFolder,
        canOpen: input.hasSelectedEntry,
        panelHeading: selectedDetails.isFolder ? "Selected folder" : "Selected file",
        ariaLabel: `Details for ${selectedDetails.name}`
      }
    };
  }

  if (input.batchSelectionCount > 0) {
    const selectionLabel = buildDownloadSelectionLabel(
      input.batchSelectionSummary.fileCount,
      input.batchSelectionSummary.folderCount
    );
    return {
      kind: "batch",
      batch: {
        count: input.batchSelectionCount,
        countLabel: `${pluralize(input.batchSelectionCount, "item")} selected`,
        selectionLabel,
        fileCount: input.batchSelectionSummary.fileCount,
        folderCount: input.batchSelectionSummary.folderCount,
        sizeLabel: buildBatchSelectionSizeLabel(input.batchSelectionSummary, input.fileSizeDisplayMode),
        ariaLabel: `Selection details for ${input.batchSelectionCount} items`
      }
    };
  }

  const { workspace } = input;
  const itemCountLabel = formatBrowseCount(workspace.visibleItemCount, "item");
  const resultCountLabel = formatBrowseCount(workspace.visibleItemCount, "result");
  const searchDisplayQuery = getSearchDisplayQuery(workspace.searchQuery);

  return {
    kind: "workspace",
    workspace: {
      folderLabel: workspace.folderLabel,
      locationLabel: workspace.locationLabel,
      itemsLabel: workspace.searchActive ? resultCountLabel : itemCountLabel,
      itemsHeading: workspace.searchActive ? "Results" : "Items",
      searchActive: workspace.searchActive,
      searchQuery: searchDisplayQuery,
      modeLabel: buildWorkspaceModeLabel(workspace),
      staleInfo: buildWorkspaceStaleInfo(workspace.explicitOfflineMode, workspace.folderCachedAt, formatters)
    }
  };
}

export function buildSelectionSummaryLabel(
  batchSelectionCount: number,
  batchSelectionSummary: BatchSelectionSummary
): string | undefined {
  if (batchSelectionCount <= 0) {
    return undefined;
  }
  const selectionLabel = buildDownloadSelectionLabel(
    batchSelectionSummary.fileCount,
    batchSelectionSummary.folderCount
  );
  return `${pluralize(batchSelectionCount, "item")} selected (${selectionLabel})`;
}
