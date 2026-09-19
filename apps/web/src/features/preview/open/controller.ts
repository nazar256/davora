import type { FileEntry } from "@davora/shared";
import { toDisplayPath } from "@davora/shared";

import { isAudioFileEntry } from "../folderAudio/model";
import type { PreviewOpenRequest } from "../session/model";
import {
  canBeginPreviewOpen,
  resolvePreviewOpenTarget,
  resolveUnsupportedOpenRoute,
  selectPrefetchCandidates,
  shouldSkipPrefetchForCurrentItem
} from "./model";
import type { PreviewOpenOptions } from "./model";
import type { PreviewOpenPorts, PrefetchAcceptPolicy } from "./ports";

export interface OpenPreviewFileInput {
  readonly entry: FileEntry;
  readonly options?: PreviewOpenOptions;
  readonly hasToken: boolean;
  readonly cacheOnlyMode: boolean;
  readonly cacheNamespace: string | undefined;
  readonly hasActiveAccount: boolean;
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly accountId: string;
  readonly cacheNamespaceValue: string;
  readonly accountName: string;
  readonly contextGeneration: string;
  readonly connectionMode: "online" | "cache-only";
  readonly heicPreviewEnabled: boolean;
  readonly freshnessIntervalMs: number;
  readonly cacheLimitBytes: number;
  readonly mediaItems: readonly FileEntry[];
}

export async function downloadUnsupportedPreviewFile(
  path: string,
  displayPath: string,
  accountName: string,
  ports: PreviewOpenPorts,
  input: { readonly cacheOnlyMode: boolean; readonly offline: boolean }
): Promise<void> {
  if (!ports.unsupportedDownload.isCurrentHandler()) {
    return;
  }
  if (input.cacheOnlyMode) {
    ports.surface.close();
    ports.surface.clearSelection();
    ports.unsupportedDownload.reportCacheOnlyBlocked(displayPath, accountName, input.offline);
    return;
  }
  if (!ports.unsupportedDownload.canDownloadFocused(path)) {
    return;
  }

  ports.unsupportedDownload.prepareForDownload();
  ports.unsupportedDownload.reportStarting(displayPath, accountName);
  await ports.unsupportedDownload.download(path, displayPath);
}

export async function openPreviewFile(input: OpenPreviewFileInput, ports: PreviewOpenPorts): Promise<void> {
  if (!canBeginPreviewOpen({
    hasToken: input.hasToken,
    cacheOnlyMode: input.cacheOnlyMode,
    cacheNamespace: input.cacheNamespace,
    hasActiveAccount: input.hasActiveAccount
  })) {
    return;
  }

  const displayPath = toDisplayPath(input.entry.path);
  const unsupportedRoute = resolveUnsupportedOpenRoute({
    entry: input.entry,
    explicitOfflineMode: input.explicitOfflineMode,
    hasToken: input.hasToken,
    offline: input.offline
  });

  if (unsupportedRoute.kind === "explicit-offline-local") {
    const cached = await ports.explicitOffline.readCachedBlob(input.entry.path);
    if (!ports.explicitOffline.isRetentionCurrent(input.accountId, input.cacheNamespaceValue)) {
      return;
    }
    if (cached) {
      ports.explicitOffline.triggerLocalOpen(cached.blob, cached.filename);
      ports.explicitOffline.reportLocalOpen(displayPath);
    } else {
      ports.explicitOffline.reportUnreadable();
    }
    return;
  }

  if (unsupportedRoute.kind === "download") {
    await downloadUnsupportedPreviewFile(
      input.entry.path,
      displayPath,
      input.accountName,
      ports,
      { cacheOnlyMode: input.cacheOnlyMode, offline: input.offline }
    );
    return;
  }

  if (unsupportedRoute.kind === "preview-error") {
    ports.surface.setPreviewError(new Error(unsupportedRoute.message));
    return;
  }

  if (isAudioFileEntry(input.entry) && input.options?.preferFolderAudioPlayer) {
    if (ports.surface.isOpen()) {
      ports.surface.close();
    }
    ports.folderAudio.activate(input.entry);
    ports.surface.clearSelection();
    ports.navigation.closeMobileDetails();
    return;
  }

  ports.folderAudio.pause();
  ports.surface.setOpenedEntryPath(input.entry.path);
  if (!input.options?.reusePreviewSurface) {
    ports.navigation.pushPreviewSurface();
  }
  ports.surface.setOpenedEntry(input.entry);
  ports.navigation.closeMobileDetails();
  ports.surface.setStatus(`Opening ${displayPath} in ${input.accountName}`);
  ports.session.clearOwner();

  const request: PreviewOpenRequest = {
    accountId: input.accountId,
    cacheNamespace: input.cacheNamespaceValue,
    path: input.entry.path,
    contextGeneration: input.contextGeneration,
    connectionMode: input.connectionMode,
    heicPreviewEnabled: input.heicPreviewEnabled,
    freshnessIntervalMs: input.freshnessIntervalMs,
    cacheLimitBytes: input.cacheLimitBytes,
    target: resolvePreviewOpenTarget(input.entry)
  };

  const outcome = await ports.session.open(request);
  if (outcome.kind === "download-original") {
    await downloadUnsupportedPreviewFile(
      input.entry.path,
      displayPath,
      input.accountName,
      ports,
      { cacheOnlyMode: input.cacheOnlyMode, offline: input.offline }
    );
    return;
  }
  if (outcome.kind === "opened") {
    ports.surface.markWorkerAvailable();
    const startIndex = input.mediaItems.findIndex((item) => item.path === input.entry.path);
    void prefetchUpcomingPreviewMedia({
      startIndex,
      mediaItems: input.mediaItems,
      accountId: input.accountId,
      cacheNamespace: input.cacheNamespaceValue,
      contextGeneration: input.contextGeneration,
      cacheOnlyMode: input.cacheOnlyMode,
      hasToken: input.hasToken,
      hasActiveAccount: input.hasActiveAccount,
      cacheNamespacePresent: Boolean(input.cacheNamespace),
      heicPreviewEnabled: input.heicPreviewEnabled,
      freshnessIntervalMs: input.freshnessIntervalMs,
      cacheLimitBytes: input.cacheLimitBytes
    }, ports, ports.prefetch.acceptPolicy);
  }
}

export interface PrefetchUpcomingMediaInput {
  readonly startIndex: number;
  readonly mediaItems: readonly FileEntry[];
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly contextGeneration: string;
  readonly cacheOnlyMode: boolean;
  readonly hasToken: boolean;
  readonly hasActiveAccount: boolean;
  readonly cacheNamespacePresent: boolean;
  readonly heicPreviewEnabled: boolean;
  readonly freshnessIntervalMs: number;
  readonly cacheLimitBytes: number;
}

export async function prefetchUpcomingPreviewMedia(
  input: PrefetchUpcomingMediaInput,
  ports: PreviewOpenPorts,
  policy: PrefetchAcceptPolicy
): Promise<void> {
  if (!input.hasToken || !input.cacheNamespacePresent || !input.hasActiveAccount || input.cacheOnlyMode || input.startIndex < 0) {
    return;
  }

  const currentItem = input.mediaItems[input.startIndex];
  if (shouldSkipPrefetchForCurrentItem(currentItem)) {
    return;
  }

  const upcomingItems = selectPrefetchCandidates(input.mediaItems, input.startIndex);
  const accountId = input.accountId;
  const namespace = input.cacheNamespace;
  const contextGeneration = input.contextGeneration;
  const aborters = upcomingItems.map(() => ports.prefetch.context.createAbort());
  for (const aborter of aborters) {
    ports.prefetch.context.trackPrefetchAbort(aborter);
  }

  await Promise.all(upcomingItems.map(async (item, index) => {
    const aborter = aborters[index];
    if (!aborter) {
      return;
    }
    try {
      const outcome = await ports.prefetch.runtime.prefetch({
        requestSequence: ports.prefetch.context.nextPrefetchSequence(),
        accountId,
        cacheNamespace: namespace,
        path: item.path,
        contextGeneration,
        connectionMode: "online",
        heicPreviewEnabled: input.heicPreviewEnabled,
        freshnessIntervalMs: input.freshnessIntervalMs,
        cacheLimitBytes: input.cacheLimitBytes
      }, policy, aborter);
      if (outcome.kind === "persisted"
        && ports.prefetch.context.isStillCurrent(accountId, namespace, contextGeneration)) {
        await ports.prefetch.refreshCacheSummary();
      }
    } catch {
      // Best-effort gallery prefetch deliberately has no UI/status side effect.
    } finally {
      ports.prefetch.context.untrackPrefetchAbort(aborter);
    }
  }));
}

export function openAdjacentPreviewMedia(
  target: FileEntry | undefined,
  openFile: (entry: FileEntry, options: PreviewOpenOptions) => Promise<void>
): void {
  if (!target) {
    return;
  }
  void openFile(target, { reusePreviewSurface: true });
}

export async function applyPendingPreviewRefresh(
  activeAccountName: string,
  displayPath: string,
  ports: PreviewOpenPorts,
  hasActiveAccount: boolean
): Promise<void> {
  if (!hasActiveAccount) {
    return;
  }
  await ports.refresh.applyPending(displayPath, activeAccountName);
}
