import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import {
  applyPendingPreviewRefresh,
  openAdjacentPreviewMedia,
  openPreviewFile,
  type OpenPreviewFileInput
} from "./controller";
import {
  buildMediaGalleryItems,
  buildPreviewNavigationItems,
  resolveAdjacentMediaItem,
  resolveOpenedMediaIndex,
  type PreviewOpenOptions
} from "./model";
import type { PreviewOpenPorts } from "./ports";

export interface UsePreviewOpenInput {
  readonly visibleItems: readonly FileEntry[];
  readonly openedEntry: FileEntry | undefined;
  readonly experimentalHeicPreviewEnabled: boolean;
  readonly previewFreshnessIntervalSeconds: number;
  readonly maxCacheableFileSizeBytes: number;
  readonly imagePreviewPrefetchCount: number;
  readonly token: string | undefined;
  readonly cacheOnlyMode: boolean;
  readonly cacheNamespace: string | undefined;
  readonly activeAccount: { readonly id: string; readonly cacheNamespace: string; readonly displayName: string } | undefined;
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  previewContextGeneration(): string;
  readonly ports: PreviewOpenPorts;
  onInvalidatePrefetch(): void;
}

export function usePreviewOpen(input: UsePreviewOpenInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const mediaItems = useMemo(
    () => buildMediaGalleryItems(input.visibleItems, input.experimentalHeicPreviewEnabled),
    [input.experimentalHeicPreviewEnabled, input.visibleItems]
  );
  const previewNavigationItems = useMemo(
    () => buildPreviewNavigationItems(mediaItems, input.openedEntry),
    [mediaItems, input.openedEntry]
  );
  const openedMediaIndex = useMemo(
    () => resolveOpenedMediaIndex(previewNavigationItems, input.openedEntry),
    [previewNavigationItems, input.openedEntry]
  );
  const previousMediaItem = resolveAdjacentMediaItem(previewNavigationItems, openedMediaIndex, -1);
  const nextMediaItem = resolveAdjacentMediaItem(previewNavigationItems, openedMediaIndex, 1);

  const buildOpenInput = useCallback((entry: FileEntry, options?: PreviewOpenOptions): OpenPreviewFileInput | undefined => {
    const current = inputRef.current;
    if (!current.activeAccount) {
      return undefined;
    }
    return {
      entry,
      options,
      hasToken: Boolean(current.token),
      cacheOnlyMode: current.cacheOnlyMode,
      cacheNamespace: current.cacheNamespace,
      hasActiveAccount: true,
      explicitOfflineMode: current.explicitOfflineMode,
      offline: current.offline,
      accountId: current.activeAccount.id,
      cacheNamespaceValue: current.activeAccount.cacheNamespace,
      accountName: current.activeAccount.displayName,
      contextGeneration: current.previewContextGeneration(),
      connectionMode: current.cacheOnlyMode ? "cache-only" : "online",
      heicPreviewEnabled: current.experimentalHeicPreviewEnabled,
      freshnessIntervalMs: current.previewFreshnessIntervalSeconds * 1000,
      cacheLimitBytes: current.maxCacheableFileSizeBytes,
      prefetchAheadCount: current.imagePreviewPrefetchCount,
      mediaItems: buildMediaGalleryItems(current.visibleItems, current.experimentalHeicPreviewEnabled)
    };
  }, []);

  const openFile = useCallback(async (entry: FileEntry, options: PreviewOpenOptions = {}) => {
    const current = inputRef.current;
    const openInput = buildOpenInput(entry, options);
    if (!openInput) {
      return;
    }
    await openPreviewFile(openInput, current.ports);
  }, [buildOpenInput]);

  const openAdjacentMedia = useCallback((offset: -1 | 1) => {
    const current = inputRef.current;
    const galleryItems = buildMediaGalleryItems(current.visibleItems, current.experimentalHeicPreviewEnabled);
    const navigationItems = buildPreviewNavigationItems(galleryItems, current.openedEntry);
    const index = resolveOpenedMediaIndex(navigationItems, current.openedEntry);
    const target = resolveAdjacentMediaItem(navigationItems, index, offset);
    openAdjacentPreviewMedia(target, (next, nextOptions) => openFile(next, nextOptions));
  }, [openFile]);

  const applyPendingRefresh = useCallback(async () => {
    const current = inputRef.current;
    if (!current.activeAccount || !current.openedEntry) {
      return;
    }
    await applyPendingPreviewRefresh(
      current.activeAccount.displayName,
      current.openedEntry.path,
      current.ports,
      Boolean(current.activeAccount)
    );
  }, []);

  useLayoutEffect(() => {
    inputRef.current.onInvalidatePrefetch();
  }, [
    input.activeAccount?.id,
    input.cacheNamespace,
    input.token,
    input.cacheOnlyMode,
    input.onInvalidatePrefetch
  ]);

  return {
    mediaItems,
    previewNavigationItems,
    openedMediaIndex,
    previousMediaItem,
    nextMediaItem,
    openFile,
    openAdjacentMedia,
    applyPendingRefresh
  };
}
