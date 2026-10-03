import { useCallback, useMemo, useRef } from "react";

import type { ConnectedAccount, FileEntry, SearchResult } from "@davora/shared";

import { formatFileSize, type FileSizeDisplayMode } from "../../../lib/fileSize";
import {
  buildOfflineFolderItems,
  buildOfflineSearchResults,
  selectFolderOfflineAvailability,
  selectReadableRetainedFiles,
  selectRetainedReadiness,
  selectRetainedRecovery,
  selectRetainedStorageBytes,
  type RetainedReadiness,
  type RetainedRecovery,
  type RetainedSnapshot,
  type RetentionRepository,
  type RetentionAccount,
  type RetentionPreviewRead
} from "../retention";
import { useExplicitOfflineMode, type ExplicitOfflineModeEntryPorts, type ExplicitOfflineModeRuntimePort } from "../mode";
import { useRetention, type RetentionPresentationPorts, type RetentionUIPorts } from "../retention";

export interface OfflineApplicationCachePort {
  clearFolderCacheForPath(namespace: string, path: string): void;
  clearFolderAndSearchCache(namespace: string, options?: { readonly preserveFolderPaths?: readonly string[] }): void;
  clearSelectionChrome(): void;
}

export interface OfflineApplicationWorkspaceInput {
  readonly activeAccount?: ConnectedAccount;
  readonly accountName: string;
  readonly cacheNamespace?: string;
  readonly currentPath: string;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly runtime: ExplicitOfflineModeRuntimePort;
  readonly retentionRepository: RetentionRepository;
  readonly entry: ExplicitOfflineModeEntryPorts;
  readonly cache: OfflineApplicationCachePort;
  readonly announce: (message: string) => void;
}

export interface OfflineApplicationSettingsCache {
  readonly summary: RetainedSnapshot["normalCache"];
  readonly offlineItems: OfflineApplicationSettingsCacheItem[];
  readonly retainedBytes: number;
  readonly storageScope?: string;
  readonly getRecovery: (rootId: string) => RetainedRecovery;
  readonly onClearCache: () => void;
  readonly onOpenedFileCacheLimitChange: (limitBytes: number) => void;
  readonly onRemoveOfflineItem: (rootId: string) => void;
}

export interface OfflineApplicationSettingsCacheItem {
  readonly rootId: string;
  readonly rootPath: string;
  readonly name: string;
  readonly kind: "file" | "folder" | "batch";
  readonly fileCount: number;
  readonly readableFileCount: number;
  readonly readiness: RetainedReadiness;
  readonly recoverable: boolean;
  readonly totalBytes: number;
  readonly addedAt?: string;
}

export interface OfflineApplicationBrowsingSource {
  readonly folderItems: readonly FileEntry[];
  searchItemsFor(query: string): readonly SearchResult[];
}

export interface OfflineApplicationRetentionBridge {
  readonly getActiveAccount: () => { readonly id: string; readonly cacheNamespace: string } | undefined;
  readonly toRetentionAccount: (account: { readonly id: string; readonly cacheNamespace: string }) => RetentionAccount;
  readonly readPreview: (account: RetentionAccount, path: string) => Promise<RetentionPreviewRead | undefined>;
  readonly isCurrent: (account: RetentionAccount) => boolean;
  readonly refreshSummary: () => Promise<void>;
  readonly publishSummary: (summary: RetainedSnapshot["normalCache"]) => void;
  readonly executeSnapshotCommand: ReturnType<typeof useRetention>["executeSnapshotCommand"];
}

export interface OfflineApplicationShellToggle {
  readonly label: "Go online" | "Go offline";
  readonly onToggle: () => void;
}

export interface OfflineApplicationWorkspaceResult {
  readonly explicitOfflineMode: boolean;
  readonly setExplicitOfflineMode: (enabled: boolean) => void;
  readonly browsingOfflineSource: OfflineApplicationBrowsingSource;
  readonly isItemAvailableOffline: (item: OfflineFavouriteLike) => boolean;
  readonly projectVisibleFavourites: <T extends OfflineFavouriteLike>(favourites: readonly T[]) => readonly T[];
  readonly settingsCache: OfflineApplicationSettingsCache;
  readonly shellToggle: (input: { readonly browserOffline: boolean; readonly workerUnavailable: boolean }) => OfflineApplicationShellToggle | undefined;
  readonly retention: OfflineApplicationRetentionBridge;
}

export interface OfflineFavouriteLike {
  readonly path: string;
  readonly isFolder: boolean;
}

function retentionAccount(account: { readonly id: string; readonly cacheNamespace: string }): RetentionAccount {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

export function useOfflineApplicationWorkspace(input: OfflineApplicationWorkspaceInput): OfflineApplicationWorkspaceResult {
  const modePorts = useMemo(() => ({
    ...input.runtime,
    entry: input.entry
  }), [input.entry, input.runtime]);
  const { enabled: explicitOfflineMode, setEnabled: setExplicitOfflineMode } = useExplicitOfflineMode({
    activeAccount: input.activeAccount,
    ports: modePorts
  });

  const retentionPorts = useMemo(() => {
    const presentation: RetentionPresentationPorts = {
      formatCacheLimitStatus: (limitBytes, accountName) =>
        `Opened-file cache limit set to ${formatFileSize(limitBytes, input.fileSizeDisplayMode)} for ${accountName}.`,
      formatRemoveOfflineCopyStatus: (rootName) =>
        `Removed offline copy for ${rootName} from this device. Server files were not deleted.`,
      formatClearCacheStatus: (accountName) => `Offline cache cleared for ${accountName}.`
    };
    const ui: RetentionUIPorts = {
      clearFolderCacheForPath: input.cache.clearFolderCacheForPath,
      clearFolderAndSearchCache: input.cache.clearFolderAndSearchCache,
      clearSelectionChrome: input.cache.clearSelectionChrome,
      setStatus: input.announce
    };
    return {
      repository: input.retentionRepository,
      ui,
      presentation,
      toRetentionAccount: retentionAccount,
      defaultCacheLimitBytes: input.retentionRepository.defaultCacheLimitBytes ?? 24 * 1024 * 1024
    };
  }, [input.announce, input.cache, input.fileSizeDisplayMode, input.retentionRepository]);
  const retention = useRetention({
    activeAccount: input.activeAccount,
    cacheNamespace: input.cacheNamespace,
    accountName: input.accountName,
    ports: retentionPorts
  });
  const readableRetainedFiles = useMemo(
    () => retention.retentionSnapshot ? selectReadableRetainedFiles(retention.retentionSnapshot) : [],
    [retention.retentionSnapshot]
  );
  const retainedRootSummaries = useMemo(
    () => retention.retentionSnapshot && retention.retentionSnapshot.account.accountId === input.activeAccount?.id && retention.retentionSnapshot.account.cacheNamespace === input.cacheNamespace
      ? selectRetainedReadiness(retention.retentionSnapshot) : [],
    [retention.retentionSnapshot, input.activeAccount?.id, input.cacheNamespace]
  );
  const snapshotRef = useRef(retention.retentionSnapshot);
  snapshotRef.current = retention.retentionSnapshot;
  const browsingOfflineSource = useMemo(() => ({
    folderItems: buildOfflineFolderItems(readableRetainedFiles, input.currentPath),
    searchItemsFor: (query: string) => buildOfflineSearchResults(readableRetainedFiles, input.currentPath, query)
  }), [input.currentPath, readableRetainedFiles]);
  const readableOfflineFilePaths = useMemo(
    () => new Set(readableRetainedFiles.map((entry) => entry.path)),
    [readableRetainedFiles]
  );
  const completeOfflineFolderRoots = useMemo(() => {
    const snapshot = retention.retentionSnapshot;
    return new Set(
      snapshot?.roots
      .filter((root) => root.kind === "folder" && selectFolderOfflineAvailability(snapshot, root.rootPath))
      .flatMap((root) => [root.rootPath, ...root.folderRoots]) ?? []
    );
  }, [retention.retentionSnapshot]);
  const isItemAvailableOffline = useCallback((item: OfflineFavouriteLike) => item.isFolder
    ? [...completeOfflineFolderRoots].some((rootPath) => item.path === rootPath || item.path.startsWith(`${rootPath}/`))
    : readableOfflineFilePaths.has(item.path), [completeOfflineFolderRoots, readableOfflineFilePaths]);
  const projectVisibleFavourites = useCallback(<T extends OfflineFavouriteLike>(favourites: readonly T[]): readonly T[] =>
    explicitOfflineMode
      ? favourites.filter((favourite) => isItemAvailableOffline(favourite))
      : favourites, [explicitOfflineMode, isItemAvailableOffline]);
  const settingsCache = useMemo<OfflineApplicationSettingsCache>(() => ({
    summary: retention.cacheSummary,
    retainedBytes: retainedRootSummaries.length && retention.retentionSnapshot ? selectRetainedStorageBytes(retention.retentionSnapshot) : 0,
    storageScope: input.cacheNamespace,
    getRecovery: (rootId) => {
      const snapshot = snapshotRef.current;
      if (!snapshot || !retention.retentionStillCurrent(snapshot.account)) return { kind: "unavailable", reason: "missing-root" };
      const row = selectRetainedReadiness(snapshot).find((item) => item.rootId === rootId);
      return row?.readiness === "incomplete" || row?.readiness === "missing"
        ? selectRetainedRecovery(snapshot, rootId) : { kind: "unavailable", reason: "missing-root" };
    },
    offlineItems: retainedRootSummaries.map((root): OfflineApplicationSettingsCacheItem => ({
      rootId: root.rootId,
      rootPath: root.rootPath,
      name: root.rootName,
      kind: root.kind,
      fileCount: root.fileCount,
      readableFileCount: root.readableFileCount,
      readiness: root.readiness,
      recoverable: retention.retentionSnapshot !== undefined && selectRetainedRecovery(retention.retentionSnapshot, root.rootId).kind === "recoverable",
      totalBytes: root.totalBytes,
      addedAt: root.addedAt
    })),
    onClearCache: () => { void retention.clearNormalCache(); },
    onOpenedFileCacheLimitChange: (limitBytes) => { void retention.configureNormalCacheLimit(limitBytes); },
    onRemoveOfflineItem: (rootId) => {
      const root = retainedRootSummaries.find((item) => item.rootId === rootId);
      if (root) {
        void retention.removeOfflineCopy(root);
      }
    }
  }), [input.cacheNamespace, retainedRootSummaries, retention]);
  const shellToggle = useCallback((state: { readonly browserOffline: boolean; readonly workerUnavailable: boolean }) => {
    if (!explicitOfflineMode && !state.browserOffline && !state.workerUnavailable) {
      return undefined;
    }
    return {
      label: explicitOfflineMode ? "Go online" as const : "Go offline" as const,
      onToggle: () => setExplicitOfflineMode(!explicitOfflineMode)
    };
  }, [explicitOfflineMode, setExplicitOfflineMode]);
  const retentionBridge = useMemo<OfflineApplicationRetentionBridge>(() => ({
    getActiveAccount: () => input.activeAccount
      ? { id: input.activeAccount.id, cacheNamespace: input.activeAccount.cacheNamespace }
      : undefined,
    toRetentionAccount: retentionAccount,
    readPreview: async (account, path) => {
      const result = await input.retentionRepository.readPreview(account, path);
      return result.kind === "success" ? result.value : undefined;
    },
    isCurrent: retention.retentionStillCurrent,
    refreshSummary: retention.refreshCacheSummary,
    publishSummary: retention.publishCacheSummary,
    executeSnapshotCommand: retention.executeSnapshotCommand
  }), [input.activeAccount, input.retentionRepository, retention.executeSnapshotCommand, retention.publishCacheSummary, retention.refreshCacheSummary, retention.retentionStillCurrent]);
  return {
    explicitOfflineMode,
    setExplicitOfflineMode,
    browsingOfflineSource,
    isItemAvailableOffline,
    projectVisibleFavourites,
    settingsCache,
    shellToggle,
    retention: retentionBridge
  };
}
