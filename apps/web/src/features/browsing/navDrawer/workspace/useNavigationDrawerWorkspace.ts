import { useCallback, useMemo } from "react";

import type { FileEntry } from "@davora/shared";

import { createFavouriteActionsPorts, useFavouriteActions, type FavouriteEntry } from "../../favourites";
import { type NavDrawerStageProps } from "../NavDrawerStage";
import type { NavigationDrawerWorkspaceInput, NavigationDrawerWorkspaceOutput } from "./ports";

export function useNavigationDrawerWorkspace(
  input: NavigationDrawerWorkspaceInput
): NavigationDrawerWorkspaceOutput {
  const { account, session, bootstrap, connectivity, browsing, navigation, offline, operation, status, services } = input.owners;
  const { openPreview, openSettings: openSettingsPort, toDisplayPath, directoryUploadInputRef } = input.ports;
  const { favourites, favouritesPointerEnvironment, favouriteResolveRuntime: resolveRuntime } = services;
  const favouritePorts = useMemo(() => createFavouriteActionsPorts({
    listFiles: resolveRuntime.listFiles,
    cacheFolder: resolveRuntime.cacheFolder,
    toDisplayPath,
    closeNavigationChrome: () => navigation.closeChrome("navigation"),
    navigateToPath: navigation.navigateToPath,
    openFile: openPreview,
    setStatus: status.commands.announce,
    reportListError: (error) => error ? browsing.commands.reportExternalListError(error) : browsing.commands.clearExternalListError()
  }), [browsing, navigation, openPreview, resolveRuntime, status, toDisplayPath]);
  const favouriteActions = useFavouriteActions({
    account: account.operationalActiveAccount,
    service: favourites,
    token: session.token,
    cacheOnlyMode: bootstrap.cacheOnlyMode,
    cacheNamespace: account.activeCacheNamespace,
    ports: favouritePorts
  });

  const openSettings = useCallback(() => {
    navigation.closeChrome("navigation");
    openSettingsPort();
  }, [navigation, openSettingsPort]);
  const uploadFiles = useCallback((files: FileList | File[] | null) => {
    navigation.closeChrome("navigation");
    return operation.upload.uploadFiles(files);
  }, [navigation, operation.upload]);
  const uploadFolder = useCallback((files: FileList | File[] | null) => {
    navigation.closeChrome("navigation");
    return operation.upload.uploadFiles(files);
  }, [navigation, operation.upload]);
  const openFavourite = useCallback((entry: FavouriteEntry) => {
    void favouriteActions.openFavourite(entry);
  }, [favouriteActions]);
  const toggleFavourite = useCallback((entry: FileEntry) => {
    favouriteActions.toggleFavourite(entry);
  }, [favouriteActions]);

  const binding = account.totalAccountCount > 0 && account.operationalActiveAccount
    ? {
      key: account.operationalActiveAccount.id,
      props: {
        accountName: account.activeAccountName,
        breadcrumbs: browsing.presentation.breadcrumbs,
        cacheOnlyMode: bootstrap.cacheOnlyMode,
        canCreateFolder: operation.capabilities.canCreateFolder,
        canUploadFiles: operation.capabilities.canUploadFiles,
        canUploadFolders: operation.capabilities.canUploadFolders,
        currentPath: navigation.currentPath,
        directoryUploadInputRef,
        entries: offline.projectVisibleFavourites(favouriteActions.entries),
        explicitOfflineMode: offline.explicitOfflineMode,
        locationLabel: browsing.presentation.locationLabel,
        mutationBusy: operation.mutation.state.busy,
        offline: connectivity.offline,
        offlineMode: offline.explicitOfflineMode,
        onClose: () => navigation.closeChrome("navigation"),
        onCreateFolder: operation.commands.openCreateFolder,
        onNavigateToPath: navigation.navigateToPath,
        onOpen: openFavourite,
        onOpenSettings: openSettings,
        onRemove: favouriteActions.removeFavourite,
        onReorder: favouriteActions.reorderFavourites,
        onToggleOffline: () => offline.setExplicitOfflineMode(!offline.explicitOfflineMode),
        onUploadFiles: uploadFiles,
        onUploadFolder: uploadFolder,
        open: navigation.navigationDrawerOpen,
        pointerEnvironment: favouritesPointerEnvironment,
        workerUnavailable: bootstrap.workerUnavailable
      } satisfies NavDrawerStageProps
    }
    : undefined;

  return {
    binding,
    favourites: {
      entries: favouriteActions.entries,
      isFavourite: favouriteActions.isFavourite,
      toggle: toggleFavourite
    }
  };
}
