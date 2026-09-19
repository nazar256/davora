import { createBrowsingCacheRepository, createFavouritesService, createFolderSortService } from "../features/browsing";
import { createAccountRegistryService } from "../features/accounts/registry";
import { createSettingsService } from "../features/settings";
import { createBrowserAccountSessionPorts } from "./browserAccountSessionPorts";
import { createBrowserFolderPorts } from "../platform/api/browserFolderPorts";
import { createBrowserSearchPorts } from "../platform/api/browserSearchPorts";
import { createBrowserConnectivityPort } from "../platform/network/browserConnectivityPort";
import type { ConnectivityPort } from "../features/offline/connectivity";
import type { HistoryPort } from "../features/navigation/ports";
import type { ResponsiveViewportPort } from "../features/navigation/viewport";
import { parseLocationSearch } from "../features/navigation";
import { createBrowserHistoryPort } from "../platform/browser/browserHistoryAdapter";
import { createBrowserResponsiveViewportPort } from "../platform/browser/browserResponsiveViewportPort";
import { createBrowserPullToRefreshEnvironmentPort } from "../platform/browser/browserPullToRefreshEnvironmentPort";
import { createBrowserFavouritesPointerEnvironment } from "../platform/browser/browserFavouritesPointerEnvironment";
import { createBrowserStringStorage } from "../platform/storage/browserStringStorage";
import { createBrowserOwnershipStoragePort } from "../platform/security/browserOwnershipStoragePort";
import { createBrowserOwnershipEnvironmentPort } from "../platform/security/browserOwnershipEnvironmentPort";
import { createBrowserOwnershipIdentityService } from "../features/accounts";
import { createBrowserAccountTransport } from "../platform/api/browserAccountTransport";
import { createSystemClock } from "../platform/time/systemClock";
import { createBrowserAccountRegistryClock } from "../platform/time/browserAccountRegistryClock";
import type { AppServices } from "./AppServices";
import { createBrowserOperationRuntime } from "../platform/api/browserOperationRuntime";
import { createBrowserOfflineSyncRuntime } from "../platform/offline/browserOfflineSyncRuntime";
import { createOpenedFileRepository } from "../platform/storage/openedFileRepository";
import { createPreviewComposition } from "./createPreviewComposition";
import { createAccountRemovalRuntime } from "./createAccountRemovalRuntime";
import { createBrowserBackendNetworkGate } from "../platform/network/browserBackendNetworkGate";
import { createBrowserExplicitOfflineModeStorage } from "../platform/storage/browserExplicitOfflineModeStorage";
import { createBrowserFavouriteResolveRuntime } from "../platform/api/browserFavouriteResolveRuntime";
import { createBrowserDiagnosticsStore } from "../platform/storage/browserDiagnosticsStore";
import { createBrowserDiagnosticsEnvironment } from "../platform/diagnostics/browserDiagnosticsEnvironment";
import { createBrowserDiagnosticsErrorCapture } from "../platform/diagnostics/browserDiagnosticsErrorCapture";
import { createBrowserDiagnosticsLifecycle } from "../platform/diagnostics/browserDiagnosticsLifecycle";
import { createBrowserDiagnosticsExport } from "../platform/diagnostics/browserDiagnosticsExport";
import { createBrowserDiagnosticsClock, createBrowserDiagnosticsIds } from "../platform/diagnostics/browserDiagnosticsClock";
import { setBackendRequestObserver } from "../lib/networkPolicy";
import { APP_BUILD_LABEL } from "../lib/appBuild";
import type { DiagnosticsRuntimePorts } from "../features/diagnostics";

export const createBrowserAppServices = (): AppServices => {
  const storage = createBrowserStringStorage();
  const ownershipStorage = createBrowserOwnershipStoragePort(storage);
  const ownership = createBrowserOwnershipIdentityService({
    storage: ownershipStorage,
    environment: createBrowserOwnershipEnvironmentPort()
  });
  const accountTransport = createBrowserAccountTransport(ownership);
  const clock = createSystemClock();
  const browsingCache = createBrowsingCacheRepository(storage, clock);
  const favouriteResolveRuntime = createBrowserFavouriteResolveRuntime(browsingCache);
  const retentionRepository = createOpenedFileRepository();
  const explicitOfflineRuntime = {
    storage: createBrowserExplicitOfflineModeStorage(),
    network: createBrowserBackendNetworkGate()
  };
  const previewRuntime = createPreviewComposition({ retentionRepository });
  const history = createBrowserHistoryPort() satisfies HistoryPort;
  const accountRegistry = createAccountRegistryService(storage, createBrowserAccountRegistryClock(), {
    preferredActiveAccountId: parseLocationSearch(history.getLocation().search).accountId
  });
  const favourites = createFavouritesService(storage, clock);
  const folderSorts = createFolderSortService(storage);
  const accountRemovalRuntime = createAccountRemovalRuntime({
    accountTransport,
    retentionRepository,
    browsingCache,
    favourites,
    folderSorts
  });
  const diagnostics: DiagnosticsRuntimePorts = {
    store: createBrowserDiagnosticsStore(),
    environment: createBrowserDiagnosticsEnvironment(APP_BUILD_LABEL),
    errorCapture: createBrowserDiagnosticsErrorCapture(),
    lifecycle: createBrowserDiagnosticsLifecycle(),
    exportPort: createBrowserDiagnosticsExport(),
    network: { setObserver: setBackendRequestObserver },
    clock: createBrowserDiagnosticsClock(),
    ids: createBrowserDiagnosticsIds()
  };
  return {
    accountRegistry,
    accountTransport,
    accountSession: createBrowserAccountSessionPorts(accountRegistry, accountTransport),
    browsingCache,
    favouriteResolveRuntime,
    connectivity: createBrowserConnectivityPort() satisfies ConnectivityPort,
    explicitOfflineRuntime,
    clock,
    favourites,
    favouritesPointerEnvironment: createBrowserFavouritesPointerEnvironment(),
    folder: createBrowserFolderPorts(browsingCache),
    folderSorts,
    history,
    pullToRefreshEnvironment: createBrowserPullToRefreshEnvironmentPort(),
    responsiveViewport: createBrowserResponsiveViewportPort() satisfies ResponsiveViewportPort,
    search: createBrowserSearchPorts(browsingCache),
    settings: createSettingsService(storage),
    operationRuntime: createBrowserOperationRuntime(),
    offlineSyncRuntime: createBrowserOfflineSyncRuntime(),
    retentionRepository,
    previewRuntime,
    accountRemovalRuntime,
    diagnostics
  };
};
