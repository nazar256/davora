import type { ConnectedAccount } from "@davora/shared";

import type { AppServices } from "./AppServices";
import type { AppShellProps } from "./AppShell";
import { projectAppShellComposition } from "./projectAppShellComposition";
import {
  projectBrowsingSurfaceBindings,
  useAppBarWorkspace,
  useNavigationDrawerWorkspace,
  useQuickActionsWorkspace,
  type BrowsingWorkspaceOutput,
  type FolderLoadCoordination
} from "../features/browsing";
import type {
  AccountActionsWorkspaceOutput,
  AccountBootstrapWorkspaceOutput,
  AccountStateWorkspaceOutput
} from "../features/accounts";
import type { useWorkspaceStatus } from "../features/workspace";
import type { useBrowserConnectivity } from "../features/offline/connectivity";
import type { OfflineApplicationWorkspaceResult } from "../features/offline/workspace";
import type { useOfflineSyncWorkspace } from "../features/offline/sync/workspace";
import type { useWakeLock } from "../features/offline/wakeLock";
import type { useWorkspaceNavigation, useResponsiveViewport, NavigationSurfaceWorkspace } from "../features/navigation";
import type { usePwaWorkspace } from "../features/pwa";
import type { useTransfers } from "../features/transfers";
import type { usePreviewWorkspace } from "../features/preview/workspace";
import type { useSettingsPreferencesWorkspace } from "../features/settings";
import type { FolderShortcutWorkspace } from "../features/folderShortcut";
import {
  projectFileListSelectionBindings,
  projectSelectionWorkspacePresentation,
  type SelectionInteractionWorkspaceCommands,
  type SelectionStateBindings,
  type OperationExecutionWorkspaceOutput
} from "../features/operations";

type AccountSession = ReturnType<AccountStateWorkspaceOutput["sessionAuthority"]["capture"]>;
type Connectivity = ReturnType<typeof useBrowserConnectivity>;
type Navigation = ReturnType<typeof useWorkspaceNavigation>;
type OfflineSync = ReturnType<typeof useOfflineSyncWorkspace>;
type Preview = ReturnType<typeof usePreviewWorkspace>;
type Pwa = ReturnType<typeof usePwaWorkspace>;
type ResponsiveViewport = ReturnType<typeof useResponsiveViewport>;
type Settings = ReturnType<typeof useSettingsPreferencesWorkspace>;
type Transfers = ReturnType<typeof useTransfers>;
type WakeLock = ReturnType<typeof useWakeLock>;
type WorkspaceStatus = ReturnType<typeof useWorkspaceStatus>;

export interface AppWorkspacePresentationInput {
  readonly account: {
    readonly context: AccountStateWorkspaceOutput["snapshot"];
    readonly session: AccountSession;
    readonly bootstrap: AccountBootstrapWorkspaceOutput;
    readonly actions: AccountActionsWorkspaceOutput;
  };
  readonly browsing: { readonly workspace: BrowsingWorkspaceOutput; readonly load: FolderLoadCoordination };
  readonly navigation: { readonly workspace: Navigation; readonly surface: NavigationSurfaceWorkspace; readonly viewport: ResponsiveViewport };
  readonly offline: { readonly application: OfflineApplicationWorkspaceResult; readonly sync: OfflineSync };
  readonly operation: { readonly workspace: OperationExecutionWorkspaceOutput; readonly selection: SelectionStateBindings; readonly interaction: SelectionInteractionWorkspaceCommands };
  readonly folderShortcut: FolderShortcutWorkspace;
  readonly preview: Preview;
  readonly settings: Settings;
  readonly runtime: { readonly connectivity: Connectivity; readonly pwa: Pwa; readonly wakeLock: WakeLock; readonly transfers: Transfers; readonly status: WorkspaceStatus };
  readonly services: Pick<AppServices, "favourites" | "favouritesPointerEnvironment" | "favouriteResolveRuntime">;
  readonly ports: {
    readonly appBuildLabel: string;
    readonly buildStaleInfo: Parameters<typeof projectBrowsingSurfaceBindings>[0]["ports"]["buildStaleInfo"];
    readonly directoryUploadInputRef: Parameters<typeof projectBrowsingSurfaceBindings>[0]["ports"]["directoryUploadInputRef"];
    readonly folderAudioBrowsePanelClassName: (hasPlayer: boolean) => string;
    readonly toDisplayPath: (path: string) => string;
  };
}

export function useAppWorkspacePresentation(input: AppWorkspacePresentationInput): AppShellProps {
  const { account, browsing, navigation, offline, operation, folderShortcut, preview, settings, runtime, services, ports } = input;
  const { context: accountContext, session, bootstrap, actions } = account;
  const { workspace: browsingWorkspace, load: folderLoadCoordination } = browsing;
  const { workspace: workspaceNavigation, surface: navigationSurfaceWorkspace, viewport } = navigation;
  const { application: offlineApplication, sync: offlineSyncWorkspace } = offline;
  const { workspace: operationWorkspace, selection, interaction: selectionInteraction } = operation;
  const { focused: focusedSelection, batch: batchSelection } = selection;
  const { connectivity, pwa, wakeLock, transfers, status } = runtime;
  const activeAccount: ConnectedAccount | undefined = accountContext.operationalActiveAccount;

  const navigationDrawerWorkspace = useNavigationDrawerWorkspace({
    owners: {
      account: accountContext,
      session,
      bootstrap,
      connectivity,
      browsing: browsingWorkspace,
      navigation: workspaceNavigation,
      offline: offlineApplication,
      operation: operationWorkspace,
      status,
      services
    },
    ports: {
      openPreview: (entry, options) => preview.bridge.openFile(entry, options),
      openSettings: () => workspaceNavigation.openChrome("settings"),
      toDisplayPath: ports.toDisplayPath,
      directoryUploadInputRef: ports.directoryUploadInputRef
    }
  });
  const fileListSelectionBindings = projectFileListSelectionBindings({
    focusedEntry: focusedSelection.selectedEntry,
    batchCount: batchSelection.summary.count,
    isBatchSelected: batchSelection.isSelected,
    interaction: selectionInteraction,
    isNarrowScreen: viewport.isNarrowScreen
  });
  const selectionPresentation = projectSelectionWorkspacePresentation({
    selection: {
      focusedEntry: focusedSelection.selectedEntry,
      focusedMobileSubview: focusedSelection.mobileSubview,
      batchSummary: batchSelection.summary,
      isBatchSelected: batchSelection.isSelected
    },
    preview: { selected: preview.bridge.snapshot().modal.selected },
    workspace: {
      folderLabel: browsingWorkspace.presentation.folderLabel,
      locationLabel: browsingWorkspace.presentation.locationLabel,
      visibleItemCount: browsingWorkspace.list.items.length,
      searchActive: browsingWorkspace.query.active,
      searchQuery: browsingWorkspace.query.raw,
      explicitOfflineMode: offlineApplication.explicitOfflineMode,
      offline: connectivity.offline,
      workerUnavailable: bootstrap.workerUnavailable,
      folderCachedAt: browsingWorkspace.presentation.folderCachedAt
    },
    view: {
      fileSizeDisplayMode: settings.preferences.fileSizeDisplayMode,
      isNarrowScreen: viewport.isNarrowScreen,
      mobileDetailsOpen: workspaceNavigation.mobileDetailsOpen,
      mutationBusy: operationWorkspace.mutation.state.busy
    },
    capabilities: operationWorkspace.capabilities,
    favourite: {
      selected: navigationDrawerWorkspace.favourites.isFavourite(focusedSelection.selectedEntry),
      toggle: navigationDrawerWorkspace.favourites.toggle
    },
    commands: {
      clearFocused: focusedSelection.clear,
      clearBatch: batchSelection.clear,
      showMobileActions: focusedSelection.showMobileActions,
      showMobileDetails: focusedSelection.showMobileDetails,
      closeMobileDetails: () => workspaceNavigation.closeChrome("mobile-details"),
      navigateToFolder: workspaceNavigation.navigateToPath,
      openFile: (entry) => { void preview.bridge.openFile(entry, { preferFolderAudioPlayer: true }); },
      openFolderShortcut: folderShortcut.commands.open,
      downloadFocused: (path, label) => { void operationWorkspace.download.downloadFocused(path, label); },
      downloadBatch: () => { void operationWorkspace.download.downloadBatch(); },
      keepOfflineFocused: (entry) => { void offlineSyncWorkspace.commands.open([entry]); },
      keepOfflineBatch: () => void offlineSyncWorkspace.commands.open(
        batchSelection.entries,
        batchSelection.archiveInput,
        batchSelection.capture()
      ),
      renameFocused: operationWorkspace.commands.openMove,
      copyMoveFocused: operationWorkspace.commands.openCopyMove,
      copyMoveBatch: operationWorkspace.commands.openCopyMoveSelection,
      deleteFocused: operationWorkspace.commands.openDelete,
      deleteBatch: operationWorkspace.commands.openDeleteSelection
    }
  });
  const quickActionsWorkspace = useQuickActionsWorkspace({
    owners: {
      account: accountContext,
      navigation: workspaceNavigation,
      operation: operationWorkspace,
      viewport,
      surfaces: {
        navigationDrawerOpen: workspaceNavigation.navigationDrawerOpen,
        mobileSearchOpen: workspaceNavigation.mobileSearchOpen,
        mobileDetailsOpen: workspaceNavigation.mobileDetailsOpen,
        settingsOpen: workspaceNavigation.showSettingsDialog,
        transfersOpen: workspaceNavigation.transferOpen,
        mutationSurfaceOpen: operationWorkspace.mutation.state.surface.kind !== "none",
        previewOpen: preview.modal.previewOpen,
        accountSurfaceOpen: actions.snapshot.surface !== "none",
        offlineSyncOpen: offlineSyncWorkspace.snapshot.dialog !== undefined,
        selectionModeActive: selectionPresentation.selectionModeActive
      }
    },
    ports: { directoryUploadInputRef: ports.directoryUploadInputRef }
  });
  const browsingSurface = projectBrowsingSurfaceBindings({
    owners: {
      browse: browsingWorkspace,
      selection: { fileList: fileListSelectionBindings, presentation: selectionPresentation, interaction: selectionInteraction, batch: batchSelection },
      operation: operationWorkspace,
      offline: offlineApplication,
      navigation: workspaceNavigation,
      settings,
      status: status.snapshot,
      pullToRefresh: navigationSurfaceWorkspace.pullToRefresh
    },
    ports: {
      directoryUploadInputRef: ports.directoryUploadInputRef,
      loadFolder: folderLoadCoordination.loadFolder,
      openFile: (entry) => { void preview.bridge.openFile(entry, { preferFolderAudioPlayer: true }); },
      openOfflineSync: (entries, archiveInput, capture) => { void offlineSyncWorkspace.commands.open(entries, archiveInput, capture); },
      buildStaleInfo: ports.buildStaleInfo
    }
  });
  const appBarWorkspace = useAppBarWorkspace({
    owners: {
      account: accountContext,
      session,
      bootstrap,
      connectivity,
      viewport,
      browsing: browsingWorkspace,
      navigation: workspaceNavigation,
      offline: offlineApplication,
      pwa,
      wakeLock,
      transfers,
      offlineSync: offlineSyncWorkspace
    }
  });

  return projectAppShellComposition({
    showDetailsRail: selectionPresentation.showDetailsRail,
    common: {
      reloadPrompt: pwa.reloadPrompt,
      appBar: appBarWorkspace.binding,
      navigationDrawer: navigationDrawerWorkspace.binding,
      removeAccount: actions.stages.removeDialog
    },
    bootstrap: {
      registryNotice: accountContext.registryNotice,
      accountBootstrapError: bootstrap.gateError,
      connectStage: actions.stages.bootstrapConnect,
      gate: bootstrap.gate,
      restoreStage: bootstrap.restoreStage,
      unlockStage: bootstrap.unlockStage
    },
    status: {
      banner: browsingWorkspace.presentation.inlineBanner,
      browserOffline: connectivity.offline,
      workerUnavailable: bootstrap.workerUnavailable,
      shellToggle: offlineApplication.shellToggle
    },
    workspace: {
      pullToRefresh: navigationSurfaceWorkspace.pullToRefresh.shell,
      browsePanelClassName: ports.folderAudioBrowsePanelClassName(preview.folderAudio.hasPlayer),
      browseHeader: browsingSurface.browseHeader,
      folderAudio: { interaction: preview.folderAudio.interaction },
      fileList: browsingSurface.fileList,
      selectionDetails: selectionPresentation.detailsStage,
      quickActions: quickActionsWorkspace.binding?.props
    },
    settings: {
      preferences: settings.preferences,
      commands: settings.commands,
      open: workspaceNavigation.showSettingsDialog,
      isNarrowScreen: viewport.isNarrowScreen,
      closeChrome: workspaceNavigation.closeChrome,
      accounts: {
        accounts: accountContext.operationalAccounts,
        activeAccount,
        managementActiveAccount: accountContext.managementActiveAccount,
        pendingRemovalAccounts: accountContext.pendingRemovalAccounts,
        activeAccountId: activeAccount?.id,
        connectedAccountCount: accountContext.totalAccountCount,
        commands: actions.commands
      },
      cache: offlineApplication.settingsCache,
      runtime: {
        appBuildLabel: ports.appBuildLabel,
        offline: connectivity.offline,
        explicitOfflineMode: offlineApplication.explicitOfflineMode,
        keepAwakeState: wakeLock.state
      }
    },
    overlays: {
      folderShortcut: folderShortcut.stage,
      offlineSync: offlineSyncWorkspace.stage,
      connectAccount: actions.stages.connectDialog,
      mutation: operationWorkspace.mutation.stage,
      preview: preview.stage
    }
  });
}
