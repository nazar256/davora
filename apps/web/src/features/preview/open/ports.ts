import type { FileEntry } from "@davora/shared";

import type { PreviewOpenOutcome, PreviewApplyRefreshOutcome } from "../session/controller";
import type { PreviewAbortHandle, PreviewAcquisition, PreviewPrefetchPort } from "../session";
import type { PreviewOpenRequest } from "../session/model";

export interface PreviewOpenSessionPort {
  open(request: PreviewOpenRequest): Promise<PreviewOpenOutcome>;
  applyRefresh(): Promise<PreviewApplyRefreshOutcome>;
  clearOwner(): void;
}

export interface PreviewOpenNavigationPort {
  pushPreviewSurface(): void;
  closeMobileDetails(): void;
}

export interface PreviewOpenFolderAudioPort {
  pause(): void;
  activate(entry: FileEntry): void;
}

export interface PreviewOpenSurfacePort {
  close(): void;
  isOpen(): boolean;
  setOpenedEntry(entry: FileEntry): void;
  setOpenedEntryPath(path: string): void;
  clearSelection(): void;
  setPreviewError(error: Error | undefined): void;
  setStatus(message: string): void;
  reportListError(error: Error | undefined): void;
  markWorkerAvailable(): void;
}

export interface PreviewOpenUnsupportedDownloadPort {
  isCurrentHandler(): boolean;
  canDownloadFocused(path: string): boolean;
  download(path: string, displayPath: string): Promise<void>;
  reportCacheOnlyBlocked(displayPath: string, accountName: string, offline: boolean): void;
  reportStarting(displayPath: string, accountName: string): void;
  prepareForDownload(): void;
}

export interface PreviewOpenExplicitOfflinePort {
  readCachedBlob(path: string): Promise<{ blob: Blob; filename: string } | undefined>;
  triggerLocalOpen(blob: Blob, filename: string): void;
  isRetentionCurrent(accountId: string, cacheNamespace: string): boolean;
  reportLocalOpen(displayPath: string): void;
  reportUnreadable(): void;
}

export interface PreviewOpenPrefetchContextPort {
  getContextGeneration(): string;
  getAccountId(): string;
  getCacheNamespace(): string;
  isStillCurrent(accountId: string, cacheNamespace: string, contextGeneration: string): boolean;
  nextPrefetchSequence(): number;
  trackPrefetchAbort(aborter: PreviewAbortHandle): void;
  untrackPrefetchAbort(aborter: PreviewAbortHandle): void;
  createAbort(): PreviewAbortHandle;
}

export interface PreviewOpenPrefetchPort {
  readonly runtime: PreviewPrefetchPort;
  readonly context: PreviewOpenPrefetchContextPort;
  readonly acceptPolicy: PrefetchAcceptPolicy;
  refreshCacheSummary(): Promise<void>;
}

export interface PreviewOpenRefreshPort {
  applyPending(displayPath: string, accountName: string): Promise<void>;
}

export interface PreviewOpenPorts {
  readonly session: PreviewOpenSessionPort;
  readonly navigation: PreviewOpenNavigationPort;
  readonly folderAudio: PreviewOpenFolderAudioPort;
  readonly surface: PreviewOpenSurfacePort;
  readonly unsupportedDownload: PreviewOpenUnsupportedDownloadPort;
  readonly explicitOffline: PreviewOpenExplicitOfflinePort;
  readonly prefetch: PreviewOpenPrefetchPort;
  readonly refresh: PreviewOpenRefreshPort;
}

export type PrefetchAcceptPolicy = { readonly accept: (acquisition: PreviewAcquisition) => boolean };
