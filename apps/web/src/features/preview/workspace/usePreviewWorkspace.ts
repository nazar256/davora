import { useCallback, useMemo, useRef, useState } from "react";

import type { FileEntry } from "@davora/shared";

import { useFolderAudioMount, type FolderAudioPreviewOpenSources } from "../folderAudio";
import { usePreviewOpen, type PreviewOpenPorts } from "../open";
import { usePreviewSession } from "../session";
import { isMediaGalleryViewer } from "../shell";
import type { PreviewModalStageProps } from "../shell";
import { projectPreviewModalStage } from "./projectPreviewModalStage";
import type { PreviewWorkspaceContext, PreviewWorkspaceOpenOptions, PreviewWorkspacePorts, PreviewWorkspaceSettings } from "./ports";

export interface PreviewWorkspaceInput {
  readonly context: PreviewWorkspaceContext;
  readonly settings: PreviewWorkspaceSettings;
  readonly ports: PreviewWorkspacePorts;
}

export interface PreviewWorkspaceMediaActivity {
  readonly previewPlaying: boolean;
  readonly folderAudioPlaying: boolean;
}

export interface PreviewWorkspaceModalProjection {
  readonly entry: FileEntry | undefined;
  readonly previewOpen: boolean;
  readonly selected: ReturnType<typeof usePreviewSession>["selected"];
  readonly selectedBlobUrl: ReturnType<typeof usePreviewSession>["selectedBlobUrl"];
  readonly previewError: ReturnType<typeof usePreviewSession>["previewError"];
  readonly loadingPreview: boolean;
  readonly previewCacheState: ReturnType<typeof usePreviewSession>["previewCacheState"];
  readonly pendingPreviewUpdate: ReturnType<typeof usePreviewSession>["pendingPreviewUpdate"];
  readonly onMediaPlaybackChange: (playing: boolean) => void;
}

export interface PreviewWorkspaceFolderAudioProjection {
  readonly playing: boolean;
  readonly interaction: ReturnType<typeof useFolderAudioMount>["interaction"];
  readonly hasPlayer: boolean;
  readonly previewOpenSources: FolderAudioPreviewOpenSources;
}

export interface PreviewWorkspaceState {
  readonly modal: PreviewWorkspaceModalProjection;
  readonly folderAudio: PreviewWorkspaceFolderAudioProjection;
  readonly mediaActivity: PreviewWorkspaceMediaActivity;
}

export interface PreviewWorkspaceApplicationProjection {
  readonly stage: PreviewModalStageProps;
}

export interface PreviewWorkspaceBridge {
  readonly snapshot: () => PreviewWorkspaceState;
  readonly dismiss: (surface?: string) => void;
  readonly clearForPathTransition: () => void;
  readonly clearAccountContext: () => void;
  readonly clearOpenedEntry: () => void;
  readonly prepareUnsupportedDownload: () => void;
  readonly pauseForExclusivePlayback: () => void;
  readonly openFile: (entry: FileEntry, options?: PreviewWorkspaceOpenOptions) => Promise<void>;
  readonly setSelectedPreview: (updater: (previous: { readonly path: string; readonly name: string } | undefined) => { readonly path: string; readonly name: string } | undefined) => void;
}

export function usePreviewWorkspace({ context, settings, ports }: PreviewWorkspaceInput) {
  const application = ports.application;
  const sessionComposition = application.runtime.session;
  const sessionRuntimeCallbacksCurrent = {
    onResetSession: application.session.reset,
    onMarkWorkerUnavailable: application.session.markWorkerUnavailable,
    onPublishCacheSummary: application.session.publishCacheSummary,
    onStreamCacheReady: application.session.streamCacheReady,
    onStreamCacheFailed: application.session.streamCacheFailed
  };
  const sessionRuntimeCallbacksRef = useRef(sessionRuntimeCallbacksCurrent);
  sessionRuntimeCallbacksRef.current = sessionRuntimeCallbacksCurrent;
  const sessionRuntimeCallbacks = useMemo(() => ({
    onResetSession: (message: string, reconnectRequired: boolean) => sessionRuntimeCallbacksRef.current.onResetSession(message, reconnectRequired),
    onMarkWorkerUnavailable: () => sessionRuntimeCallbacksRef.current.onMarkWorkerUnavailable(),
    onPublishCacheSummary: (snapshot: Parameters<typeof application.session.publishCacheSummary>[0]) => sessionRuntimeCallbacksRef.current.onPublishCacheSummary(snapshot),
    onStreamCacheReady: (displayPath: string, accountName: string) => sessionRuntimeCallbacksRef.current.onStreamCacheReady(displayPath, accountName),
    onStreamCacheFailed: (displayPath: string, accountName: string) => sessionRuntimeCallbacksRef.current.onStreamCacheFailed(displayPath, accountName)
  // Callback identity is intentionally stable; the ref above provides event-time ports.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const folderAudioPorts = application.runtime.folderAudio;
  const [openedEntry, setOpenedEntryState] = useState<FileEntry | undefined>();
  const openedEntryRef = useRef<FileEntry | undefined>();
  const openedEntryPathRef = useRef<string>();
  const clearIdentityRef = useRef<() => void>(() => undefined);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const bridgeCloseRef = useRef(false);
  const sessionCallbacks = useMemo(() => ({
    ...sessionRuntimeCallbacks,
    onOpenedEntryClear: () => clearIdentityRef.current()
  }), [sessionRuntimeCallbacks]);
  const session = usePreviewSession({
    accountId: context.activeAccount?.id,
    cacheNamespace: context.cacheNamespace,
    accountName: context.accountName ?? context.activeAccount?.displayName ?? "current account",
    token: context.token,
    cacheOnlyMode: context.cacheOnlyMode,
    openedEntryPath: openedEntry?.path,
    composition: sessionComposition,
    callbacks: sessionCallbacks
  });

  const folderAudio = useFolderAudioMount({
    context: context.activeAccount ? {
      accountId: context.activeAccount.id,
      folderPath: context.currentPath,
      folderLabel: context.currentPath.split("/").filter(Boolean).at(-1) ?? "Root",
      token: context.token,
      cacheOnlyMode: context.cacheOnlyMode,
      visibleItems: context.visibleItems
    } : undefined,
    ports: folderAudioPorts
  });

  const clearIdentity = useCallback(() => {
    if (openedEntryRef.current === undefined && openedEntryPathRef.current === undefined) {
      return;
    }
    openedEntryRef.current = undefined;
    openedEntryPathRef.current = undefined;
    session.clearOpenedEntryPath();
    setOpenedEntryState(undefined);
  }, [session]);
  const setOpenedEntry = useCallback((entry: FileEntry) => {
    openedEntryRef.current = entry;
    setOpenedEntryState(entry);
  }, []);
  const setOpenedEntryPath = useCallback((path: string) => {
    openedEntryPathRef.current = path;
    session.setOpenedEntryPath(path);
  }, [session]);
  clearIdentityRef.current = clearIdentity;
  const closeSessionAndClearIdentity = useCallback(() => {
    if (!bridgeCloseRef.current) {
      session.close();
    }
    clearIdentity();
    bridgeCloseRef.current = true;
  }, [clearIdentity, session]);
  const prepareUnsupportedDownload = useCallback(() => {
    closeSessionAndClearIdentity();
  }, [closeSessionAndClearIdentity]);

  const openPorts = useMemo<PreviewOpenPorts>(() => ({
    session: {
      open: (request) => session.controller.open(request),
      applyRefresh: () => session.controller.applyRefresh(),
      clearOwner: session.clearOwner
    },
    navigation: {
      pushPreviewSurface: application.navigation.pushPreviewSurface,
      closeMobileDetails: application.navigation.closeMobileDetails
    },
    folderAudio: folderAudio.previewOpenSources,
    surface: {
      ...{
        close: application.navigation.closeNavigation,
        setStatus: application.presentation.announce,
        reportListError: (error: Error | undefined) => error
          ? application.presentation.reportListError(error)
          : application.presentation.clearListError(),
        markWorkerAvailable: application.presentation.markWorkerAvailable
      },
      close: () => {
        closeSessionAndClearIdentity();
        application.navigation.closeNavigation();
      },
      isOpen: () => session.previewOpen,
      setOpenedEntry: (entry) => setOpenedEntry(entry),
      setOpenedEntryPath,
      clearSelection: clearIdentity,
      setPreviewError: () => undefined
    },
    unsupportedDownload: {
      ...{
        isCurrentHandler: application.operation.isCurrent,
        canDownloadFocused: application.operation.canDownload,
        download: (path: string) => application.operation.download(path, application.presentation.toDisplayPath(path)),
        reportCacheOnlyBlocked: (displayPath: string, accountName: string, offlineBlocked: boolean) => {
          application.presentation.reportListError(new Error(offlineBlocked
            ? "This file type downloads instead of previewing. Reconnect to download it."
            : "This file type downloads instead of previewing. Restore the local server to download it."));
          application.presentation.announce(offlineBlocked
            ? `Reconnect to download ${displayPath} in ${accountName}. Unsupported files open by download instead of preview.`
            : `Restore the local server to download ${displayPath} in ${accountName}. Unsupported files open by download instead of preview.`);
        },
        reportStarting: (displayPath: string, accountName: string) => {
          application.presentation.announce(`Starting browser download for ${displayPath} from ${accountName} because this file type opens outside preview.`);
        }
      },
      prepareForDownload: () => {
        prepareUnsupportedDownload();
        application.navigation.closeNavigation();
        application.presentation.clearListError();
      }
    },
    explicitOffline: {
      readCachedBlob: async (path: string) => {
        const account = context.activeAccount;
        if (!account) return undefined;
        const cached = await application.retention.readPreview({ accountId: account.id, cacheNamespace: account.cacheNamespace }, path);
        if (!cached?.blob) return undefined;
        return { blob: cached.blob, filename: cached.file.name || path.split("/").at(-1) || path };
      },
      triggerLocalOpen: application.operation.saveLocal,
      isRetentionCurrent: (accountId: string, namespace: string) => application.retention.isCurrent({ accountId, cacheNamespace: namespace }),
      reportLocalOpen: () => undefined,
      reportUnreadable: () => undefined
    },
    prefetch: {
      runtime: session.prefetchPort,
      context: session.prefetchContext,
      acceptPolicy: { accept: (acquisition) => isMediaGalleryViewer(acquisition.snapshot.preview.viewer) },
      refreshCacheSummary: application.retention.refreshSummary
    },
    refresh: {
      applyPending: async (_displayPath, accountName) => {
        const outcome = await session.controller.applyRefresh();
        if (outcome.kind === "applied") {
          application.presentation.announce(`Applied refreshed preview for ${application.presentation.toDisplayPath(outcome.key.path)} in ${accountName}`);
        }
      }
    }
  }), [application, clearIdentity, closeSessionAndClearIdentity, context.activeAccount, folderAudio.previewOpenSources, prepareUnsupportedDownload, session, setOpenedEntry, setOpenedEntryPath]);
  const open = usePreviewOpen({
    visibleItems: context.visibleItems,
    openedEntry,
    experimentalHeicPreviewEnabled: settings.experimentalHeicPreviewEnabled,
    previewFreshnessIntervalSeconds: settings.previewFreshnessIntervalSeconds,
    maxCacheableFileSizeBytes: settings.maxCacheableFileSizeBytes,
    token: context.token,
    cacheOnlyMode: context.cacheOnlyMode,
    cacheNamespace: context.cacheNamespace,
    activeAccount: context.activeAccount,
    explicitOfflineMode: context.explicitOfflineMode,
    offline: context.offline,
    previewContextGeneration: () => String(session.contextGenerationRef?.current ?? 0),
    ports: openPorts,
    onInvalidatePrefetch: () => undefined
  });

  const pauseFolderAudio = useCallback(() => folderAudio.pauseForExclusivePlayback(), [folderAudio]);
  const openFile = useCallback(async (entry: FileEntry, options?: PreviewWorkspaceOpenOptions) => {
    bridgeCloseRef.current = false;
    await open.openFile(entry, options);
  }, [bridgeCloseRef, open]);

  const onMediaPlaybackChange = useMemo(
    () => folderAudio.bindPreviewMediaPlaybackChange(setPreviewPlaying),
    [folderAudio]
  );
  const mediaActivity = useMemo<PreviewWorkspaceMediaActivity>(() => ({
    previewPlaying,
    folderAudioPlaying: previewPlaying ? false : folderAudio.playing
  }), [folderAudio, previewPlaying]);
  const modal = useMemo<PreviewWorkspaceModalProjection>(() => ({
    entry: openedEntry,
    previewOpen: session.previewOpen,
    selected: session.selected,
    selectedBlobUrl: session.selectedBlobUrl,
    previewError: session.previewError,
    loadingPreview: session.loadingPreview,
    previewCacheState: session.previewCacheState,
    pendingPreviewUpdate: session.pendingPreviewUpdate,
    onMediaPlaybackChange
  }), [openedEntry, onMediaPlaybackChange, session.loadingPreview, session.pendingPreviewUpdate, session.previewCacheState, session.previewError, session.previewOpen, session.selected, session.selectedBlobUrl]);
  const folderAudioProjection = useMemo<PreviewWorkspaceFolderAudioProjection>(() => ({
    playing: folderAudio.playing,
    interaction: folderAudio.interaction,
    hasPlayer: folderAudio.hasPlayer,
    previewOpenSources: folderAudio.previewOpenSources
  }), [folderAudio.hasPlayer, folderAudio.interaction, folderAudio.playing, folderAudio.previewOpenSources]);
  const state = useMemo<PreviewWorkspaceState>(() => ({ modal, folderAudio: folderAudioProjection, mediaActivity }), [folderAudioProjection, mediaActivity, modal]);
  const stage = useMemo(() => projectPreviewModalStage({
        open: modal.previewOpen,
        accountId: context.activeAccount?.id,
        entry: modal.entry,
        file: modal.selected,
        blobUrl: modal.selectedBlobUrl,
        offline: context.offline || context.explicitOfflineMode,
        workerUnavailable: context.workerUnavailable ?? false,
        loading: modal.loadingPreview,
        error: modal.previewError,
        token: context.cacheOnlyMode ? undefined : context.token,
        cacheState: modal.previewCacheState,
        fileSizeDisplayMode: settings.fileSizeDisplayMode ?? "human",
        imageFitMode: settings.imageFitMode ?? "fill",
        videoMuted: settings.videoMuted ?? false,
        maxCacheableFileSizeBytes: settings.maxCacheableFileSizeBytes,
        ports: application.runtime.modal,
        onImageFitModeChange: application.presentation.onImageFitModeChange,
        onVideoMutedChange: application.presentation.onVideoMutedChange,
        onApplyRefresh: modal.pendingPreviewUpdate ? () => { void commandsRef.current.open.applyPendingRefresh(); } : undefined,
        onDownload: (path) => void application.operation.download(path, application.presentation.toDisplayPath(path)),
        onPrevious: open.previousMediaItem ? () => open.openAdjacentMedia(-1) : undefined,
        onNext: open.nextMediaItem ? () => open.openAdjacentMedia(1) : undefined,
        onMediaPlaybackChange,
        onClose: application.navigation.closePreview
      }), [application, context.activeAccount?.id, context.cacheOnlyMode, context.explicitOfflineMode, context.offline, context.token, context.workerUnavailable, modal, onMediaPlaybackChange, open, settings.fileSizeDisplayMode, settings.imageFitMode, settings.maxCacheableFileSizeBytes, settings.videoMuted]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const commandsRef = useRef({ clearIdentity, openFile, pauseFolderAudio, session, open });
  commandsRef.current = { clearIdentity, openFile, pauseFolderAudio, session, open };
  const bridge = useMemo<PreviewWorkspaceBridge>(() => ({
    snapshot: () => stateRef.current,
    dismiss: () => {
      if (!bridgeCloseRef.current) {
        commandsRef.current.session.close();
      }
      commandsRef.current.clearIdentity();
      bridgeCloseRef.current = true;
    },
    clearForPathTransition: () => {
      if (!bridgeCloseRef.current) {
        commandsRef.current.session.close();
      }
      commandsRef.current.clearIdentity();
      bridgeCloseRef.current = true;
    },
    clearAccountContext: () => {
      if (!bridgeCloseRef.current) {
        commandsRef.current.session.close();
      }
      commandsRef.current.clearIdentity();
      bridgeCloseRef.current = true;
    },
    clearOpenedEntry: () => {
      commandsRef.current.clearIdentity();
    },
    prepareUnsupportedDownload: () => {
      if (!bridgeCloseRef.current) {
        commandsRef.current.session.close();
      }
      commandsRef.current.clearIdentity();
      bridgeCloseRef.current = true;
    },
    pauseForExclusivePlayback: () => commandsRef.current.pauseFolderAudio(),
    openFile: (entry, options) => commandsRef.current.openFile(entry, options),
    setSelectedPreview: (updater) => {
      commandsRef.current.session.setSelected((previous) => {
        const next = updater(previous ? { path: previous.path, name: previous.name } : undefined);
        return next && previous ? { ...previous, path: next.path, name: next.name } : previous;
      });
    }
  }), []);

  return {
    state,
    modal,
    folderAudio: folderAudioProjection,
    mediaActivity,
    previousMediaItem: open.previousMediaItem,
    nextMediaItem: open.nextMediaItem,
    openAdjacentMedia: open.openAdjacentMedia,
    applyPendingRefresh: open.applyPendingRefresh,
    openFile,
    bridge,
    stage
  };
}
