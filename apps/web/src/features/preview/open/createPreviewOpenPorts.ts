import { basename } from "@davora/shared";
import type { FileEntry } from "@davora/shared";

import type {
  RetentionAccount,
  RetentionPreviewRead,
  RetentionResult
} from "../../offline/retention";
import { isMediaGalleryViewer } from "../shell/model";
import type { PreviewApplyRefreshOutcome, PreviewOpenOutcome } from "../session/controller";
import type { PreviewAcquisition, PreviewPrefetchPort } from "../session";
import type { PreviewOpenRequest } from "../session/model";
import type { PreviewOpenPorts, PreviewOpenPrefetchContextPort } from "./ports";

export interface PreviewOpenSessionSources {
  open(request: PreviewOpenRequest): Promise<PreviewOpenOutcome>;
  applyRefresh(): Promise<PreviewApplyRefreshOutcome>;
  clearOwner(): void;
}

export interface PreviewOpenNavigationSources {
  pushPreviewSurface(): void;
  closeMobileDetails(): void;
}

export interface PreviewOpenFolderAudioSources {
  pause(): void;
  activate(entry: FileEntry): void;
}

export interface PreviewOpenSurfaceSources {
  closePreview(): void;
  isPreviewOpen(): boolean;
  setOpenedEntry(entry: FileEntry): void;
  setOpenedEntryPath(path: string): void;
  clearSelectedBlob(): void;
  clearSelectedEntry(): void;
  setPreviewError(error: Error | undefined): void;
  setStatus(message: string): void;
  reportListError(error: Error | undefined): void;
  markWorkerAvailable(): void;
}

export interface PreviewOpenUnsupportedDownloadSources {
  isCurrentHandler(): boolean;
  canDownloadFocused(path: string): boolean;
  downloadFocused(path: string, displayPath: string): Promise<void>;
}

export interface PreviewOpenExplicitOfflineSources {
  getActiveAccount(): { readonly id: string; readonly cacheNamespace: string } | undefined;
  toRetentionAccount(account: { readonly id: string; readonly cacheNamespace: string }): RetentionAccount;
  readPreview(account: RetentionAccount, path: string): Promise<RetentionResult<RetentionPreviewRead | undefined>>;
  triggerBrowserDownload(blob: Blob, filename: string): void;
  isRetentionCurrent(accountId: string, cacheNamespace: string): boolean;
}

export interface PreviewOpenPrefetchSources {
  readonly runtime: PreviewPrefetchPort;
  readonly context: PreviewOpenPrefetchContextPort;
  refreshCacheSummary(): Promise<void>;
}

export interface CreatePreviewOpenPortsInput {
  readonly session: PreviewOpenSessionSources;
  readonly navigation: PreviewOpenNavigationSources;
  readonly folderAudio: PreviewOpenFolderAudioSources;
  readonly surface: PreviewOpenSurfaceSources;
  readonly unsupportedDownload: PreviewOpenUnsupportedDownloadSources;
  readonly explicitOffline: PreviewOpenExplicitOfflineSources;
  readonly prefetch: PreviewOpenPrefetchSources;
  readonly presentation: {
    toDisplayPath(path: string): string;
  };
}

export function createPreviewOpenPorts(input: CreatePreviewOpenPortsInput): PreviewOpenPorts {
  return {
    session: {
      open: (request) => input.session.open(request),
      applyRefresh: () => input.session.applyRefresh(),
      clearOwner: () => input.session.clearOwner()
    },
    navigation: {
      pushPreviewSurface: () => input.navigation.pushPreviewSurface(),
      closeMobileDetails: () => input.navigation.closeMobileDetails()
    },
    folderAudio: {
      pause: () => input.folderAudio.pause(),
      activate: (entry) => input.folderAudio.activate(entry)
    },
    surface: {
      close: () => input.surface.closePreview(),
      isOpen: () => input.surface.isPreviewOpen(),
      setOpenedEntry: (entry) => input.surface.setOpenedEntry(entry),
      setOpenedEntryPath: (path) => input.surface.setOpenedEntryPath(path),
      clearSelection: () => {
        input.surface.clearSelectedBlob();
        input.surface.clearSelectedEntry();
      },
      setPreviewError: (error) => input.surface.setPreviewError(error),
      setStatus: (message) => input.surface.setStatus(message),
      reportListError: (error) => input.surface.reportListError(error),
      markWorkerAvailable: () => input.surface.markWorkerAvailable()
    },
    unsupportedDownload: {
      isCurrentHandler: () => input.unsupportedDownload.isCurrentHandler(),
      canDownloadFocused: (path) => input.unsupportedDownload.canDownloadFocused(path),
      download: async (path, displayPath) => input.unsupportedDownload.downloadFocused(path, displayPath),
      reportCacheOnlyBlocked: (displayPath, accountName, offlineBlocked) => {
        input.surface.closePreview();
        input.surface.clearSelectedEntry();
        input.surface.clearSelectedBlob();
        input.surface.reportListError(new Error(offlineBlocked
          ? "This file type downloads instead of previewing. Reconnect to download it."
          : "This file type downloads instead of previewing. Restore the local server to download it."));
        input.surface.setStatus(offlineBlocked
          ? `Reconnect to download ${displayPath} in ${accountName}. Unsupported files open by download instead of preview.`
          : `Restore the local server to download ${displayPath} in ${accountName}. Unsupported files open by download instead of preview.`);
      },
      reportStarting: (displayPath, accountName) => {
        input.surface.setStatus(`Starting browser download for ${displayPath} from ${accountName} because this file type opens outside preview.`);
      },
      prepareForDownload: () => {
        input.surface.closePreview();
        input.surface.clearSelectedEntry();
        input.surface.clearSelectedBlob();
        input.surface.reportListError(undefined);
      }
    },
    explicitOffline: {
      readCachedBlob: async (path) => {
        const activeAccount = input.explicitOffline.getActiveAccount();
        if (!activeAccount) {
          return undefined;
        }
        const account = input.explicitOffline.toRetentionAccount(activeAccount);
        const cachedResult = await input.explicitOffline.readPreview(account, path);
        const cached = cachedResult.kind === "success" && cachedResult.value ? cachedResult.value : undefined;
        if (!cached?.blob) {
          return undefined;
        }
        return { blob: cached.blob, filename: cached.file.name || basename(path) };
      },
      triggerLocalOpen: (blob, filename) => input.explicitOffline.triggerBrowserDownload(blob, filename),
      isRetentionCurrent: (accountId, cacheNamespace) =>
        input.explicitOffline.isRetentionCurrent(accountId, cacheNamespace),
      reportLocalOpen: (displayPath) => input.surface.setStatus(`Opened the local offline copy of ${displayPath}.`),
      reportUnreadable: () => input.surface.setPreviewError(new Error("This file is no longer readable from local device storage."))
    },
    prefetch: {
      runtime: input.prefetch.runtime,
      context: input.prefetch.context,
      acceptPolicy: {
        accept: (acquisition: PreviewAcquisition) => isMediaGalleryViewer(acquisition.snapshot.preview.viewer)
      },
      refreshCacheSummary: () => input.prefetch.refreshCacheSummary()
    },
    refresh: {
      applyPending: async (_displayPath, accountName) => {
        const outcome = await input.session.applyRefresh();
        if (outcome.kind === "applied") {
          input.surface.setStatus(`Applied refreshed preview for ${input.presentation.toDisplayPath(outcome.key.path)} in ${accountName}`);
        }
      }
    }
  };
}
