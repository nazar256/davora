import { ApiRequestError } from "../../../lib/api";

export type ListBannerKind = "loading" | "error" | "offline" | "stale" | "permission" | "idle";

export interface ListBanner {
  readonly kind: ListBannerKind;
  readonly message: string;
}

export interface ClassifyListStateInput {
  readonly error?: Error;
  readonly cacheOnlyMode: boolean;
  readonly stale: boolean;
  readonly refreshing: boolean;
  readonly offline: boolean;
}

export function classifyListState(input: ClassifyListStateInput): ListBanner {
  const { error, cacheOnlyMode, stale, refreshing, offline } = input;

  if (cacheOnlyMode && stale) {
    return {
      kind: "stale",
      message: offline
        ? "Showing cached data while offline."
        : "Showing cached data while the local server is unavailable."
    };
  }
  if (refreshing && stale) {
    return { kind: "stale", message: "Showing cached data while checking for changes in the background." };
  }
  if (stale) {
    return { kind: "stale", message: "Showing cached data because live refresh did not replace it." };
  }
  if (cacheOnlyMode) {
    return {
      kind: "offline",
      message: offline
        ? "Offline mode: cached reads are available, mutations stay disabled until you reconnect."
        : "Local server unavailable: cached reads are available, mutations stay disabled until Davora can reach the server again."
    };
  }
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.code === "permission_denied")) {
    return { kind: "permission", message: error.message };
  }
  if (error) {
    return { kind: "error", message: error.message };
  }
  return { kind: "idle", message: "" };
}

export interface BuildFolderInlineBannerInput {
  readonly explicitOfflineMode: boolean;
  readonly loadingFolder: boolean;
  readonly folderBanner: ListBanner;
  readonly refreshingFolder: boolean;
  readonly staleFolder: boolean;
  readonly cacheOnlyMode: boolean;
  readonly visibleListError?: Error;
}

export interface FolderInlineBannerPresentation {
  readonly banner: ListBanner;
  readonly showRoutineCachedRefresh: boolean;
}

export function buildFolderInlineBanner(input: BuildFolderInlineBannerInput): FolderInlineBannerPresentation {
  const {
    explicitOfflineMode,
    loadingFolder,
    folderBanner,
    refreshingFolder,
    staleFolder,
    cacheOnlyMode,
    visibleListError
  } = input;
  const showRoutineCachedRefresh = refreshingFolder && staleFolder && !cacheOnlyMode && !visibleListError;

  if (explicitOfflineMode) {
    return {
      banner: { kind: "offline", message: "Explicit offline mode is active. Only files stored on this device are shown." },
      showRoutineCachedRefresh
    };
  }
  if (loadingFolder) {
    return {
      banner: { kind: "loading", message: "Loading folder..." },
      showRoutineCachedRefresh
    };
  }
  if (folderBanner.kind === "stale" && showRoutineCachedRefresh) {
    return {
      banner: { kind: "idle", message: "" },
      showRoutineCachedRefresh
    };
  }
  return {
    banner: folderBanner,
    showRoutineCachedRefresh
  };
}
