import { useMemo, useRef, useState } from "react";

import { toDisplayPath } from "@davora/shared";

import type { AppServices } from "./AppServices";
import type { AppShellProps } from "./AppShell";
import { useAppWorkspacePresentation } from "./useAppWorkspacePresentation";
import { useBrowsingApplicationWorkspace } from "../features/browsing";
import {
  useAccountActionsWorkspace,
  useAccountBootstrapWorkspace,
  useAccountStateWorkspace,
  type AccountActionsWorkspaceBridge
} from "../features/accounts";
import { useWorkspaceStatus } from "../features/workspace";
import { useSettingsPreferencesWorkspace } from "../features/settings";
import {
  closedChromeSurfaces,
  useWorkspaceNavigation,
  useNavigationSurfaceWorkspace,
  useResponsiveViewport,
} from "../features/navigation";
import { useTransfers } from "../features/transfers";
import { useOfflineSyncWorkspace } from "../features/offline/sync/workspace";
import { useOfflineApplicationWorkspace } from "../features/offline/workspace";
import { useRetentionSelectionChromeCoordination } from "../features/offline/retention";
import { useBrowserConnectivity } from "../features/offline/connectivity";
import { useWakeLock, type ScreenWakeLockPort } from "../features/offline/wakeLock";
import { folderAudioBrowsePanelClassName } from "../features/preview/folderAudio";
import { usePreviewWorkspace, type PreviewWorkspaceBridge } from "../features/preview/workspace";
import {
  useSelectionStateWorkspace,
  projectSelectionStateBindings,
  useOperationsApplicationWorkspace,
  type SelectionTimerPorts,
} from "../features/operations";
import {
  createDiagnosticsRedactor,
  useDiagnosticsWorkspace,
  wrapDiagnosticsFolderPorts,
  wrapDiagnosticsOperationRuntime,
  wrapDiagnosticsSearchPorts,
  type DiagnosticsObservedContext,
  type DiagnosticsWorkspaceCommands
} from "../features/diagnostics";

import { APP_BUILD_LABEL } from "../lib/appBuild";
import { formatFileSize } from "../lib/fileSize";
import { usePwaWorkspace } from "../features/pwa";
import { useFolderShortcut, type FolderShortcutPorts } from "../features/folderShortcut";
import { createBrowserScreenWakeLockPort } from "../platform/wakeLock/browserScreenWakeLockPort";
import { applyBrowserDirectoryUploadAttributes } from "../platform/upload/browserDirectoryInput";
import { useBrowserPwaRuntimePorts } from "../platform/pwa/useBrowserPwaRuntimePorts";
import { createBrowserThemePorts } from "../platform/theme/browserThemePorts";
import { createBrowserSelectionTimerPorts } from "../platform/time/browserSelectionTimerPorts";
import { createBrowserClipboardPort } from "../platform/browser/browserClipboardPort";
import { createBrowserManifestLinkPort } from "../platform/browser/browserManifestLinkPort";

const browserSelectionTimerPorts = createBrowserSelectionTimerPorts() satisfies SelectionTimerPorts;
const browserClipboardPort = createBrowserClipboardPort();
const browserManifestLinkPort = createBrowserManifestLinkPort();

const noopDiagnosticsRedactor = createDiagnosticsRedactor();
const noopDiagnosticsCommands: DiagnosticsWorkspaceCommands = {
  openReport: () => undefined,
  closeReport: () => undefined,
  clearData: () => undefined,
  exportReport: async () => undefined,
  uploadReport: async () => undefined,
  recordAction: () => undefined,
  recordActionResult: () => undefined,
  record: () => undefined,
  redactPath: (path, kind) => noopDiagnosticsRedactor.path(path, kind)
};

export function useBrowserWorkspaceComposition(services: AppServices): AppShellProps {
  const browsingCache = services.browsingCache;
  const diagnosticsCommandsRef = useRef<DiagnosticsWorkspaceCommands>(noopDiagnosticsCommands);
  const diagnosticsClock = services.diagnostics.clock;
  const diagnosticsFolderPorts = useMemo(
    () => wrapDiagnosticsFolderPorts(services.folder, diagnosticsCommandsRef, diagnosticsClock),
    [services.folder, diagnosticsClock]
  );
  const diagnosticsSearchPorts = useMemo(
    () => wrapDiagnosticsSearchPorts(services.search, diagnosticsCommandsRef, diagnosticsClock),
    [services.search, diagnosticsClock]
  );
  const diagnosticsOperationRuntime = useMemo(
    () => wrapDiagnosticsOperationRuntime(services.operationRuntime, diagnosticsCommandsRef, diagnosticsClock),
    [services.operationRuntime, diagnosticsClock]
  );
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const reportBugOpenRef = useRef(reportBugOpen);
  reportBugOpenRef.current = reportBugOpen;
  const diagnosticsContextRef = useRef<DiagnosticsObservedContext>({
    currentPath: "/",
    searchActive: false,
    browserOffline: false,
    explicitOfflineMode: false,
    workerUnavailable: false,
    themeMode: "system",
    chrome: closedChromeSurfaces(),
    transferTasks: []
  });
  const retentionRepository = services.retentionRepository;
  const accountStateWorkspace = useAccountStateWorkspace({
    registry: services.accountRegistry,
    transport: services.accountTransport,
    session: services.accountSession,
    locationSearch: services.history.getLocation().search
  });
  const accountContext = accountStateWorkspace.snapshot;
  const workspaceStatus = useWorkspaceStatus({ initialMessage: accountContext.initialStatus });
  const accountSessionAuthority = accountStateWorkspace.sessionAuthority.capture();
  const activeRecord = accountContext.operationalActiveRecord;
  const activeAccount = accountContext.operationalActiveAccount;
  const browserConnectivity = useBrowserConnectivity({ port: services.connectivity });
  const { offline } = browserConnectivity;
  const responsiveViewport = useResponsiveViewport({ port: services.responsiveViewport });
  const { isNarrowScreen } = responsiveViewport;
  const themePorts = useMemo(
    () => createBrowserThemePorts(),
    []
  );
  const settingsPreferencesWorkspace = useSettingsPreferencesWorkspace({
    settingsService: services.settings,
    themePorts,
    announceStatus: workspaceStatus.commands.announce
  });
  const { preferences: uiSettings, commands: settingsCommands } = settingsPreferencesWorkspace;
  const transfers = useTransfers(services.clock);
  const transferTasks = transfers.tasks;
  const pwaRuntimePorts = useBrowserPwaRuntimePorts();
  const pwaWorkspace = usePwaWorkspace(pwaRuntimePorts);
  const previewWorkspaceBridgeRef = useRef<PreviewWorkspaceBridge>();
  const closePreviewRef = useRef<() => void>(() => undefined);
  const dismissMutationWorkflowRef = useRef<() => void>(() => undefined);
  const setWorkerUnavailableRef = useRef<(unavailable: boolean) => void>(() => undefined);
  const workspacePathPortsRef = useRef<{
    clearSelectedEntry: () => void;
    clearBatchSelection: () => void;
    clearForPathTransition: () => void;
  }>({
    clearSelectedEntry: () => undefined,
    clearBatchSelection: () => undefined,
    clearForPathTransition: () => undefined
  });
  const accountActionsBridgeRef = useRef<AccountActionsWorkspaceBridge>({
    snapshot: () => ({ surface: "none", connect: { busy: false }, remove: { busy: false } }),
    dismiss: () => undefined,
    resetSession: () => undefined
  });
  const selectionStateWorkspace = useSelectionStateWorkspace({ accountId: activeAccount?.id });
  const selectionCommands = selectionStateWorkspace.commands;
  const { focused: focusedSelection, batch: batchSelection } = projectSelectionStateBindings(selectionStateWorkspace);
  const clearBatchSelectionState = selectionCommands.clearBatch;
  const workspaceNavigation = useWorkspaceNavigation({
    port: services.history,
    accountId: activeAccount?.id ?? "",
    path: workspacePathPortsRef.current
  });
  const currentPath = workspaceNavigation.currentPath;
  const setCurrentPath = workspaceNavigation.setCurrentPath;
  const navigation = workspaceNavigation;
  const chromeSurfaces = workspaceNavigation;
  const retentionSelectionChromeCoordination = useRetentionSelectionChromeCoordination({
    clearFocusedSelection: focusedSelection.clear,
    clearBatchSelection: clearBatchSelectionState,
    closeMobileDetails: () => chromeSurfaces.closeChrome("mobile-details"),
    closePreviewAndNavigation: () => closePreviewRef.current()
  });
  const token = accountSessionAuthority.token;
  const capabilities = accountSessionAuthority.capabilities;
  const cacheNamespace = accountContext.activeCacheNamespace;
  const activeAccountName = accountContext.activeAccountName;
  const failActiveTransfersForAccount = transfers.failActiveForAccount;
  const fileSizeDisplayMode = uiSettings.fileSizeDisplayMode;
  const offlineApplication = useOfflineApplicationWorkspace({
    activeAccount,
    accountName: activeAccountName,
    cacheNamespace,
    currentPath,
    fileSizeDisplayMode,
    runtime: services.explicitOfflineRuntime,
    retentionRepository,
    entry: {
      pauseFolderAudio: () => previewWorkspaceBridgeRef.current?.pauseForExclusivePlayback(),
      closeDestinationPicker: () => dismissMutationWorkflowRef.current(),
      clearActionDialog: () => dismissMutationWorkflowRef.current(),
      closePreview: () => previewWorkspaceBridgeRef.current?.dismiss("preview"),
      setWorkerUnavailable: (unavailable: boolean) => setWorkerUnavailableRef.current(unavailable),
      failActiveTransfers: (accountId, message) => failActiveTransfersForAccount(accountId, message),
      setStatus: workspaceStatus.commands.announce
    },
    cache: {
      clearFolderCacheForPath: (namespace, path) => browsingCache.clearFolderPathOrThrow(namespace, path),
      clearFolderAndSearchCache: (namespace, options) => browsingCache.clearNamespaceOrThrow(namespace, options),
      clearSelectionChrome: retentionSelectionChromeCoordination.clearSelectionChrome
    },
    announce: workspaceStatus.commands.announce
  });
  const { explicitOfflineMode } = offlineApplication;
  const accountBootstrapPorts = useMemo(() => ({
    session: services.accountSession,
    onStatusChange: workspaceStatus.commands.announce
  }), [services.accountSession, workspaceStatus.commands.announce]);
  const accountBootstrap = useAccountBootstrapWorkspace({
    account: accountContext,
    sessionAuthority: accountStateWorkspace.sessionAuthority,
    accountCommands: accountStateWorkspace.commands,
    explicitOfflineMode,
    offline,
    ports: accountBootstrapPorts,
  });
  const {
    cacheOnlyMode,
    unlockRequired,
    healthRootPath,
    workerUnavailable,
    setBootstrapError,
    setWorkerUnavailable,
    ensureSessionForAccount
  } = accountBootstrap;
  setWorkerUnavailableRef.current = setWorkerUnavailable;
  const maxCacheableFileSizeBytes = uiSettings.maxCacheableFileSizeBytes;
  const imagePreviewFitMode = uiSettings.imagePreviewFitMode;
  const previewFreshnessIntervalSeconds = uiSettings.previewFreshnessIntervalSeconds;
  workspacePathPortsRef.current = {
    clearSelectedEntry: focusedSelection.clear,
    clearBatchSelection: clearBatchSelectionState,
    clearForPathTransition: () => previewWorkspaceBridgeRef.current?.clearForPathTransition()
  };
  const { browsingOfflineSource } = offlineApplication;
  const browsingApplication = useBrowsingApplicationWorkspace({
    context: {
      accountId: activeAccount?.id,
      accountName: activeAccountName,
      cacheNamespace,
      path: currentPath,
      token
    },
    mode: {
      cacheOnly: cacheOnlyMode,
      explicitOffline: explicitOfflineMode,
      browserOffline: offline,
      workerUnavailable
    },
    settings: { showHiddenFiles: uiSettings.showHiddenFiles, sortMode: uiSettings.sortMode },
    offlineSource: browsingOfflineSource,
    ports: {
      folder: diagnosticsFolderPorts,
      search: diagnosticsSearchPorts,
      session: { resetActiveSession: (message, reconnectRequired) => accountActionsBridgeRef.current.resetSession(message, reconnectRequired) },
      availability: { setWorkerUnavailable },
      presentation: { setStatus: workspaceStatus.commands.announce },
      folderSort: {
        service: services.folderSorts,
        persistBaseline: settingsCommands.handleSortModeChange
      },
      navigation: { getCurrentPath: workspaceNavigation.getCurrentPath, setCurrentPath }
    }
  });
  const browsingWorkspace = browsingApplication.workspace;
  const folderLoadCoordination = browsingApplication.load;
  const { query: browsingQuery, commands: browsingCommands } = browsingWorkspace;
  const searchActive = browsingQuery.active;
  const operationContextInput = { accountId: activeAccount?.id, accountName: activeAccountName, token, capabilities, currentPath, cacheOnlyMode, explicitOffline: explicitOfflineMode, browserOffline: offline, workerUnavailable, isNarrowScreen };
  const operationsApplication = useOperationsApplicationWorkspace({
    context: operationContextInput,
    selection: { focused: focusedSelection, batch: batchSelection },
    selectionEpoch: selectionStateWorkspace.epoch,
    searchActive,
    ports: {
      createAbortHandle: services.operationRuntime.request.createAbortHandle,
      timer: browserSelectionTimerPorts,
      chrome: {
        isNarrowScreen: () => isNarrowScreen,
        isMobileDetailsOpen: () => chromeSurfaces.mobileDetailsOpen,
        openMobileDetails: (options) => chromeSurfaces.openChrome("mobile-details", options),
        closeMobileDetails: () => chromeSurfaces.closeChrome("mobile-details")
      },
      preview: { get: () => previewWorkspaceBridgeRef.current?.snapshot().modal.selected, set: (updater) => previewWorkspaceBridgeRef.current?.setSelectedPreview(updater), closePreview: () => closePreviewRef.current() },
      session: { resetActiveSession: (message, reconnectRequired) => accountActionsBridgeRef.current.resetSession(message, reconnectRequired) },
      refresh: { setCurrentPath, loadFolder: folderLoadCoordination.loadFolder },
      navigation: { closeNavigation: () => chromeSurfaces.closeChrome("navigation"), pushActionSurface: () => navigation.pushSurface("action") },
      presentation: { clearListError: browsingCommands.clearExternalListError, reportListError: browsingCommands.reportExternalListError, setStatus: workspaceStatus.commands.announce, getAccountName: () => activeAccountName, toDisplayPath },
      transfers,
      runtime: diagnosticsOperationRuntime
    }
  });
  const operationContext = operationsApplication.authority;
  const selectionInteraction = operationsApplication.interaction;
  const operationWorkspace = operationsApplication.execution;
  const isOperationAllowed = operationContext.isOperationAllowed;
  const isCurrentOperationHandler = operationContext.isCurrentOperationHandler;
  const mutationWorkspace = operationWorkspace.mutation;
  const dismissMutationWorkflow = mutationWorkspace.bridge.dismiss;
  dismissMutationWorkflowRef.current = dismissMutationWorkflow;
  const wakeLockPorts = useMemo(
    () => createBrowserScreenWakeLockPort() satisfies ScreenWakeLockPort,
    []
  );

  const closePreview = () => {
    previewWorkspaceBridgeRef.current?.dismiss("preview");
    chromeSurfaces.closeChrome("navigation");
  };
  closePreviewRef.current = closePreview;

  const accountActionsWorkspace = useAccountActionsWorkspace({
    activeRecord,
    activeAccount,
    removeActiveAccount: accountContext.managementActiveAccount,
    healthRootPath,
    unlockRequired,
    settingsOpen: chromeSurfaces.showSettingsDialog,
    connect: {
      ports: {
        connectAccount: (request) => accountBootstrap.accountCommands.connectAccount(request),
        ensureSessionForAccount: (accountId) => ensureSessionForAccount(accountId)
      },
      onStatusChange: workspaceStatus.commands.announce
    },
    remove: {
      command: {
        registry: services.accountRegistry,
        runtime: services.accountRemovalRuntime,
        knownAccounts: accountContext.accounts,
        quiesceAccount: async (target) => {
          transfers.failActiveForAccount(target.id, {
            download: "Account removal stopped active downloads.",
            sync: "Account removal stopped active offline sync.",
            upload: "Account removal stopped active uploads.",
            copy: "Account removal stopped active copies.",
            move: "Account removal stopped active moves."
          });
        }
      },
      onStatusChange: workspaceStatus.commands.announce
    },
    reset: {
      ports: {
        preview: {
          clearAccountContext: () => {
            previewWorkspaceBridgeRef.current?.clearAccountContext();
          }
        },
        selection: {
          clearFocused: focusedSelection.clear,
          clearBatch: clearBatchSelectionState
        },
        browsing: {
          clearQuery: () => browsingQuery.set(""),
          clearListError: browsingCommands.clearExternalListError
        },
        navigation: {
          getLocationSearch: workspaceNavigation.getLocationSearch,
          setPath: setCurrentPath,
          syncPath: (path, accountId) => workspaceNavigation.syncPathToUrl(path, accountId),
          closeMobileDetails: () => workspaceNavigation.closeChrome("mobile-details")
        },
        transfers: {
          failActiveForAccount: (accountId, message) => transfers.failActiveForAccount(accountId, message)
        },
        session: {
          applyTerminal: accountBootstrap.accountCommands.applyTerminal
        },
        bootstrap: {
          setError: setBootstrapError
        },
        presentation: {
          setStatus: workspaceStatus.commands.announce
        }
      }
    },
    navigation: {
      pushAccountSurface: () => navigation.pushSurface("account"),
      pushRemoveAccountSurface: () => navigation.pushSurface("remove-account"),
      closeSettings: () => chromeSurfaces.closeChrome("settings")
    },
    switchActive: accountBootstrap.accountCommands.switchActive
  });
  accountActionsBridgeRef.current = accountActionsWorkspace.bridge;

  const offlineSyncWorkspace = useOfflineSyncWorkspace({
    context: {
      accountId: activeAccount?.id,
      accountName: activeAccountName,
      cacheNamespace,
      token,
      sessionRevision: accountSessionAuthority.revision,
      currentPath,
      folderLabel: browsingWorkspace.presentation.folderLabel,
      searchActive,
      cacheOnlyMode,
      browserOffline: offline
    },
    authority: operationContext,
    selection: {
      currentFocused: focusedSelection.current,
      removeCaptured: batchSelection.removeCaptured
    },
    retention: offlineApplication.retention,
    transfers: {
      controller: transfers,
      tasks: transferTasks
    },
    coordination: {
      resetActiveSession: accountActionsBridgeRef.current.resetSession,
      openTransferTray: () => { chromeSurfaces.openChrome("transfers"); },
      closeMobileDetails: () => chromeSurfaces.closeChrome("mobile-details"),
      showMobileActions: focusedSelection.showMobileActions,
      setStatus: workspaceStatus.commands.announce,
      reportListError: browsingCommands.reportExternalListError,
      writeFolderCache: (namespace, path, items) => { browsingCache.writeFolder(namespace, path, items); },
      formatStorageBytes: (value) => formatFileSize(value, fileSizeDisplayMode)
    },
    runtime: services.offlineSyncRuntime
  });

  const { downloadFocused } = operationWorkspace.download;

  const visibleItems = browsingWorkspace.list.items;

  const previewWorkspace = usePreviewWorkspace({
    context: {
      activeAccount,
      accountName: activeAccountName,
      token,
      cacheNamespace,
      cacheOnlyMode,
      currentPath,
      visibleItems,
      explicitOfflineMode,
      offline,
      workerUnavailable
    },
    settings: {
      experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled,
      previewFreshnessIntervalSeconds,
      maxCacheableFileSizeBytes,
      fileSizeDisplayMode,
      imageFitMode: imagePreviewFitMode,
      videoMuted: uiSettings.videoMuted
    },
    ports: {
      application: {
        runtime: services.previewRuntime,
        session: {
          reset: (message, reconnectRequired) => accountActionsBridgeRef.current.resetSession(message, reconnectRequired),
          markWorkerUnavailable: () => setWorkerUnavailable(true),
          publishCacheSummary: offlineApplication.retention.publishSummary,
          streamCacheReady: (displayPath, accountName) => workspaceStatus.commands.announce(`Streaming ${toDisplayPath(displayPath)} in ${accountName}; offline cache copy is ready.`),
          streamCacheFailed: (displayPath, accountName) => workspaceStatus.commands.announce(`Streaming ${toDisplayPath(displayPath)} in ${accountName}; offline cache copy could not be saved.`)
        },
        navigation: {
          pushPreviewSurface: () => navigation.pushSurface("preview"),
          closeNavigation: () => chromeSurfaces.closeChrome("navigation"),
          closeMobileDetails: () => chromeSurfaces.closeChrome("mobile-details"),
          closePreview: () => closePreviewRef.current()
        },
        operation: {
          isCurrent: () => isCurrentOperationHandler(),
          canDownload: (path) => isOperationAllowed({ kind: "downloadFocused", present: Boolean(path), isFolder: false }),
          download: downloadFocused,
          saveLocal: services.operationRuntime.download.saveDownload
        },
        retention: {
          readPreview: offlineApplication.retention.readPreview,
          isCurrent: offlineApplication.retention.isCurrent,
          refreshSummary: offlineApplication.retention.refreshSummary,
          publishSummary: offlineApplication.retention.publishSummary
        },
        presentation: {
          announce: workspaceStatus.commands.announce,
          reportListError: (error) => {
            if (error) browsingCommands.reportExternalListError(error);
          },
          clearListError: browsingCommands.clearExternalListError,
          markWorkerAvailable: () => setWorkerUnavailable(false),
          onImageFitModeChange: settingsCommands.handleImagePreviewFitModeChange,
          onVideoMutedChange: settingsCommands.handleVideoMutedChange,
          toDisplayPath
        }
      }
    }
  });
  previewWorkspaceBridgeRef.current = previewWorkspace.bridge;

  diagnosticsContextRef.current = {
    accountId: activeAccount?.id,
    sessionState: token ? "active" : "none",
    backendKind: activeAccount?.backend,
    currentPath,
    searchActive,
    searchResultCount: searchActive ? visibleItems.length : undefined,
    browserOffline: offline,
    explicitOfflineMode,
    workerUnavailable,
    themeMode: uiSettings.themeMode,
    chrome: workspaceNavigation.getChromeSnapshot(),
    transferTasks
  };
  const diagnosticsWorkspace = useDiagnosticsWorkspace({
    enabled: uiSettings.diagnosticsEnabled,
    appBuild: APP_BUILD_LABEL,
    sessionToken: token,
    getContext: () => diagnosticsContextRef.current,
    ports: services.diagnostics,
    navigation: {
      reportBugOpen,
      openReportBugSurface: () => {
        navigation.pushSurface("report-bug");
        setReportBugOpen(true);
      },
      closeReportBugSurface: () => setReportBugOpen(false)
    },
    announce: workspaceStatus.commands.announce
  });
  diagnosticsCommandsRef.current = diagnosticsWorkspace.commands;

  const folderShortcutPorts = useMemo((): FolderShortcutPorts => ({
    clipboard: browserClipboardPort,
    manifestLink: browserManifestLinkPort,
    installCapture: {
      isAvailable: () => pwaWorkspace.installCapture.available,
      claim: pwaWorkspace.installCapture.claim,
      release: pwaWorkspace.installCapture.release,
      prompt: pwaWorkspace.installCapture.prompt
    },
    navigation: {
      getBaseHref: () => services.history.getLocation().href,
      pushFolderShortcutSurface: () => navigation.pushSurface("folder-shortcut")
    },
    presentation: {
      setStatus: workspaceStatus.commands.announce
    }
  }), [pwaWorkspace, services.history, navigation, workspaceStatus.commands.announce]);
  const folderShortcutWorkspace = useFolderShortcut({
    account: { id: activeAccount?.id, name: activeAccountName },
    experimentalAppShortcutEnabled: uiSettings.experimentalFolderAppShortcutsEnabled,
    ports: folderShortcutPorts
  });
  const navigationSurfaceWorkspace = useNavigationSurfaceWorkspace({
    surface: {
      port: services.history,
      workflow: {
        preview: { isOpen: () => Boolean(previewWorkspace.bridge.snapshot().modal.previewOpen), dismiss: closePreview },
        action: { isOpen: () => mutationWorkspace.bridge.snapshot().action, dismiss: mutationWorkspace.bridge.dismiss },
        destination: { isOpen: () => mutationWorkspace.bridge.snapshot().destination, dismiss: mutationWorkspace.bridge.dismiss },
        account: { isOpen: () => accountActionsBridgeRef.current.snapshot().surface === "connect", dismiss: () => accountActionsBridgeRef.current.dismiss("connect") },
        removeAccount: { isOpen: () => accountActionsBridgeRef.current.snapshot().surface === "remove", dismiss: () => accountActionsBridgeRef.current.dismiss("remove") },
        folderShortcut: { isOpen: folderShortcutWorkspace.bridge.isOpen, dismiss: folderShortcutWorkspace.bridge.dismiss },
        reportBug: { isOpen: () => reportBugOpenRef.current, dismiss: () => setReportBugOpen(false) }
      },
      navigation: {
        getCurrentPath: workspaceNavigation.getCurrentPath,
        getChromeSnapshot: workspaceNavigation.getChromeSnapshot,
        dismissChrome: workspaceNavigation.dismissChrome,
        applyHistoryPath: workspaceNavigation.applyHistoryPath
      }
    },
    pullToRefresh: {
      cacheOnlyMode,
      getCurrentPath: workspaceNavigation.getCurrentPath,
      getToken: () => accountStateWorkspace.sessionAuthority.capture().token,
      environment: services.pullToRefreshEnvironment,
      refreshPath: folderLoadCoordination.loadFolder
    }
  });
  const wakeLock = useWakeLock({
    keepAwakeEnabled: uiSettings.keepAwakeEnabled,
    previewMediaPlaying: previewWorkspace.mediaActivity.previewPlaying,
    folderAudioPlaying: previewWorkspace.mediaActivity.folderAudioPlaying,
    transferTasks,
    ports: wakeLockPorts
  });
  return useAppWorkspacePresentation({
    account: { context: accountContext, session: accountSessionAuthority, bootstrap: accountBootstrap, actions: accountActionsWorkspace },
    browsing: { workspace: browsingWorkspace, load: folderLoadCoordination },
    navigation: { workspace: workspaceNavigation, surface: navigationSurfaceWorkspace, viewport: responsiveViewport },
    offline: { application: offlineApplication, sync: offlineSyncWorkspace },
    operation: { workspace: operationWorkspace, selection: { focused: focusedSelection, batch: batchSelection }, interaction: selectionInteraction },
    folderShortcut: folderShortcutWorkspace,
    preview: previewWorkspace,
    settings: settingsPreferencesWorkspace,
    diagnostics: diagnosticsWorkspace,
    runtime: { connectivity: browserConnectivity, pwa: pwaWorkspace, wakeLock, transfers, status: workspaceStatus },
    services: { favourites: services.favourites, favouritesPointerEnvironment: services.favouritesPointerEnvironment, favouriteResolveRuntime: services.favouriteResolveRuntime },
    ports: { appBuildLabel: APP_BUILD_LABEL, directoryUploadInputRef: applyBrowserDirectoryUploadAttributes, folderAudioBrowsePanelClassName, toDisplayPath }
  });
}
