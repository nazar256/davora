import type { FileEntry } from "@davora/shared";
import { getViewerKind } from "@davora/shared";

import { isHeicLikeFile } from "../../../lib/heicPreviewShared";
import { isMediaGalleryViewer } from "../shell/model";

export const PREVIEW_PREFETCH_AHEAD_COUNT = 1;

export interface PreviewOpenOptions {
  readonly preferFolderAudioPlayer?: boolean;
  readonly reusePreviewSurface?: boolean;
}

export function isMediaGalleryEntry(entry: FileEntry, experimentalHeicPreviewEnabled: boolean): boolean {
  if (isHeicLikeFile(entry)) {
    return experimentalHeicPreviewEnabled;
  }
  return isMediaGalleryViewer(getViewerKind(entry.mimeType));
}

export function buildMediaGalleryItems(
  visibleItems: readonly FileEntry[],
  experimentalHeicPreviewEnabled: boolean
): readonly FileEntry[] {
  return visibleItems.filter((item) => !item.isFolder && isMediaGalleryEntry(item, experimentalHeicPreviewEnabled));
}

export function buildPreviewNavigationItems(
  mediaItems: readonly FileEntry[],
  openedEntry: FileEntry | undefined
): readonly FileEntry[] {
  if (openedEntry && getViewerKind(openedEntry.mimeType) === "video") {
    return mediaItems.filter((item) => getViewerKind(item.mimeType) === "video");
  }
  return mediaItems;
}

export function resolveOpenedMediaIndex(
  previewNavigationItems: readonly FileEntry[],
  openedEntry: FileEntry | undefined
): number {
  return openedEntry ? previewNavigationItems.findIndex((item) => item.path === openedEntry.path) : -1;
}

export function resolveAdjacentMediaItem(
  previewNavigationItems: readonly FileEntry[],
  openedMediaIndex: number,
  offset: -1 | 1
): FileEntry | undefined {
  if (openedMediaIndex < 0) {
    return undefined;
  }
  const targetIndex = openedMediaIndex + offset;
  return targetIndex >= 0 && targetIndex < previewNavigationItems.length
    ? previewNavigationItems[targetIndex]
    : undefined;
}

export function shouldSkipPrefetchForCurrentItem(item: FileEntry | undefined): boolean {
  return item !== undefined && getViewerKind(item.mimeType) === "video";
}

export function selectPrefetchCandidates(
  mediaItems: readonly FileEntry[],
  startIndex: number,
  aheadCount: number = PREVIEW_PREFETCH_AHEAD_COUNT
): readonly FileEntry[] {
  if (startIndex < 0) {
    return [];
  }
  return mediaItems
    .slice(startIndex + 1, startIndex + 1 + aheadCount)
    .filter((item) => getViewerKind(item.mimeType) !== "video");
}

export type UnsupportedOpenRoute =
  | { readonly kind: "explicit-offline-local" }
  | { readonly kind: "download" }
  | { readonly kind: "preview-error"; readonly message: string }
  | { readonly kind: "continue-preview" };

export function resolveUnsupportedOpenRoute(input: {
  entry: FileEntry;
  explicitOfflineMode: boolean;
  hasToken: boolean;
  offline: boolean;
}): UnsupportedOpenRoute {
  if (input.explicitOfflineMode && (getViewerKind(input.entry.mimeType) === "unsupported" || isHeicLikeFile(input.entry))) {
    return { kind: "explicit-offline-local" };
  }
  if (getViewerKind(input.entry.mimeType) === "unsupported" && !isHeicLikeFile(input.entry)) {
    if (input.hasToken) {
      return { kind: "download" };
    }
    return {
      kind: "preview-error",
      message: input.offline
        ? "Offline and no cached inline preview is available for this file type yet."
        : "The local server is unavailable and no cached inline preview is available for this file type yet."
    };
  }
  return { kind: "continue-preview" };
}

export function resolvePreviewOpenTarget(entry: FileEntry): "heic" | "previewable" {
  return isHeicLikeFile(entry) ? "heic" : "previewable";
}

export function canBeginPreviewOpen(input: {
  hasToken: boolean;
  cacheOnlyMode: boolean;
  cacheNamespace: string | undefined;
  hasActiveAccount: boolean;
}): boolean {
  return (input.hasToken || input.cacheOnlyMode)
    && Boolean(input.cacheNamespace)
    && input.hasActiveAccount;
}
