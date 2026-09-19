import { useCallback, useMemo, useState } from "react";
import type { FileEntry, SearchResult } from "@davora/shared";

import { buildFileListEmptyPresentation } from "../fileList/emptyPresentation";
import { buildFolderInlineBanner, classifyListState } from "../folder/listBanner";
import { hasKnownFolderContents, isFolderInitialLoading, isFolderRefreshing, isFolderStale, selectFolderError, selectFolderItems } from "../folder/selectors";
import { useFolder, useFolderStatus } from "../folder";
import { selectSearchResults } from "../search/selectors";
import { useSearch } from "../search";
import { buildBreadcrumbs, buildBrowseStatusLabel, getFolderLabel, getLocationLabel, isSearchActive } from "../presentation";
import { selectVisibleItems } from "../selectors";
import type { FolderState } from "../folder/model";
import type { SearchState } from "../search/model";
import type { BrowsingWorkspaceInput } from "./ports";

export interface BrowsingWorkspaceQuery {
  readonly raw: string;
  readonly active: boolean;
  set(value: string): void;
  clear(): void;
}

export interface BrowsingWorkspaceOutput {
  readonly context: BrowsingWorkspaceInput["context"];
  readonly mode: BrowsingWorkspaceInput["mode"];
  readonly query: BrowsingWorkspaceQuery;
  readonly folder: {
    readonly state: FolderState;
    readonly items: FileEntry[];
    readonly error?: Error;
    readonly loading: boolean;
    readonly refreshing: boolean;
    readonly stale: boolean;
    readonly hasKnownContents: boolean;
    readonly cachedAt?: string;
  };
  readonly search: {
    readonly state: SearchState;
    readonly results: SearchResult[];
  };
  readonly list: {
    readonly items: FileEntry[];
    readonly stale: boolean;
    readonly visibleError?: Error;
  };
  readonly presentation: {
    readonly breadcrumbs: ReturnType<typeof buildBreadcrumbs>;
    readonly showBreadcrumbs: boolean;
    readonly folderLabel: string;
    readonly locationLabel: string;
    readonly browseStatusLabel: string;
    readonly inlineBanner: ReturnType<typeof buildFolderInlineBanner>["banner"];
    readonly showRoutineCachedRefresh: boolean;
    readonly empty: ReturnType<typeof buildFileListEmptyPresentation>;
    readonly folderCachedAt?: string;
  };
  readonly commands: {
    reload(options?: { preferCache?: boolean; announceStatus?: boolean }): Promise<"session-terminated" | undefined>;
    reportExternalListError(error: Error): void;
    clearExternalListError(): void;
  };
}

export function useBrowsingWorkspace(input: BrowsingWorkspaceInput): BrowsingWorkspaceOutput {
  const [rawQuery, setRawQuery] = useState("");
  const [externalListError, setExternalListError] = useState<Error | undefined>();
  const reportExternalListError = useCallback((error: Error) => {
    setExternalListError(error);
  }, []);
  const clearExternalListError = useCallback(() => {
    setExternalListError(undefined);
  }, []);
  const active = isSearchActive(rawQuery);
  const folderKey = input.context.accountId && input.context.cacheNamespace
    ? {
        accountId: input.context.accountId,
        cacheNamespace: input.context.cacheNamespace,
        path: input.context.path
      }
    : undefined;
  const searchKey = active && input.context.accountId && input.context.cacheNamespace
    ? {
        accountId: input.context.accountId,
        cacheNamespace: input.context.cacheNamespace,
        path: input.context.path,
        query: rawQuery
      }
    : undefined;
  const explicitOfflineSearchItems = useMemo(
    () => [...input.offlineSource.searchItemsFor(rawQuery)],
    [input.offlineSource, rawQuery]
  );
  const explicitOfflineFolderItems = useMemo(
    () => [...input.offlineSource.folderItems],
    [input.offlineSource]
  );
  const folder = useFolder({
    key: folderKey,
    token: input.context.token,
    mode: input.mode.folder,
    explicitOfflineItems: explicitOfflineFolderItems,
    ports: input.ports.folder,
    onSessionTerminated: (reason) => input.ports.session.terminate("folder", reason),
    onWorkerUnavailable: () => input.ports.availability.setWorkerUnavailable(true),
    onWorkerAvailable: () => input.ports.availability.setWorkerUnavailable(false)
  });
  const search = useSearch({
    key: searchKey,
    token: input.context.token,
    mode: input.mode.search,
    explicitOfflineItems: explicitOfflineSearchItems,
    ports: input.ports.search,
    onSessionTerminated: (reason) => input.ports.session.terminate("search", reason)
  });
  const folderStatusPorts = useMemo(() => ({
    setStatus: (message: string) => {
      if (!externalListError) {
        input.ports.presentation.setStatus(message);
      }
    },
    clearListError: () => {
      if (!externalListError) {
        clearExternalListError();
      }
    }
  }), [clearExternalListError, externalListError, input.ports.presentation]);
  useFolderStatus({
    state: folder.state,
    path: input.context.path,
    accountName: input.context.accountName,
    token: input.context.token,
    ports: folderStatusPorts
  });

  const folderItems = selectFolderItems(folder.state);
  const searchResults = selectSearchResults(search.state);
  const folderError = selectFolderError(folder.state);
  const folderLoading = isFolderInitialLoading(folder.state);
  const folderRefreshing = isFolderRefreshing(folder.state);
  const folderStale = isFolderStale(folder.state);
  const visibleError = active ? externalListError : folderError ?? externalListError;
  const visibleItems = useMemo(() => selectVisibleItems({
    browseEntries: folderItems,
    searchActive: active,
    searchResults,
    showHiddenFiles: input.settings.showHiddenFiles,
    sortMode: input.settings.sortMode
  }), [active, folderItems, input.settings.showHiddenFiles, input.settings.sortMode, searchResults]);
  const cachedAt = folder.state.kind === "refreshing" || folder.state.kind === "stale"
    ? folder.state.cachedAt
    : undefined;
  const banner = buildFolderInlineBanner({
    explicitOfflineMode: input.mode.explicitOffline,
    loadingFolder: folderLoading,
    folderBanner: classifyListState({
      error: visibleError,
      cacheOnlyMode: input.mode.cacheOnly,
      stale: folderStale,
      refreshing: folderRefreshing,
      offline: input.mode.browserOffline
    }),
    refreshingFolder: folderRefreshing,
    staleFolder: folderStale,
    cacheOnlyMode: input.mode.cacheOnly,
    visibleListError: visibleError
  });
  const locationLabel = getLocationLabel(input.context.path);
  const empty = buildFileListEmptyPresentation({
    visibleItemCount: visibleItems.length,
    searchActive: active,
    loadingFolder: folderLoading,
    hasEverCachedFolder: hasKnownFolderContents(folder.state),
    visibleListError: visibleError,
    locationLabel,
    folderError,
    cacheOnlyMode: input.mode.cacheOnly
  });
  const reloadFolder = folder.reload;
  const reload = useCallback(
    (options?: { preferCache?: boolean; announceStatus?: boolean }) => reloadFolder(options),
    [reloadFolder]
  );
  const commands = useMemo(
    () => ({ reload, reportExternalListError, clearExternalListError }),
    [clearExternalListError, reload, reportExternalListError]
  );
  return {
    context: input.context,
    mode: input.mode,
    query: {
      raw: rawQuery,
      active,
      set: setRawQuery,
      clear: () => setRawQuery("")
    },
    folder: {
      state: folder.state,
      items: folderItems,
      error: folderError,
      loading: folderLoading,
      refreshing: folderRefreshing,
      stale: folderStale,
      hasKnownContents: hasKnownFolderContents(folder.state),
      cachedAt
    },
    search: { state: search.state, results: searchResults },
    list: { items: visibleItems, stale: folderStale, visibleError },
    presentation: {
      breadcrumbs: buildBreadcrumbs(input.context.path),
      showBreadcrumbs: input.context.path !== "",
      folderLabel: getFolderLabel(input.context.path),
      locationLabel,
      browseStatusLabel: buildBrowseStatusLabel({ count: visibleItems.length, path: input.context.path, rawSearchQuery: rawQuery }),
      inlineBanner: banner.banner,
      showRoutineCachedRefresh: banner.showRoutineCachedRefresh,
      empty,
      folderCachedAt: cachedAt
    },
    commands
  };
}
