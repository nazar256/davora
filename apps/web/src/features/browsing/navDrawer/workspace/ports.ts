import type { ConnectedAccount, FileEntry } from "@davora/shared";

import type { FavouriteEntry, FavouritesPointerEnvironment, FavouritesService } from "../../favourites";
import type { NavDrawerStageProps } from "../NavDrawerStage";

interface BreadcrumbItem {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
}

interface OfflineFavouriteLike {
  readonly path: string;
  readonly isFolder: boolean;
}

export interface FavouriteResolveRuntimePort {
  listFiles(parentPath: string, token: string): Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>;
  cacheFolder(namespace: string, parentPath: string, items: readonly FileEntry[], completeness: "complete" | "partial"): void;
}

export interface NavigationDrawerWorkspaceInput {
  readonly owners: {
    readonly account: {
      readonly operationalActiveAccount?: ConnectedAccount;
      readonly activeAccountName: string;
      readonly activeCacheNamespace?: string;
      readonly totalAccountCount: number;
    };
    readonly session: { readonly token?: string };
    readonly bootstrap: { readonly cacheOnlyMode: boolean; readonly workerUnavailable: boolean };
    readonly connectivity: { readonly offline: boolean };
    readonly browsing: {
      readonly presentation: { readonly breadcrumbs: readonly BreadcrumbItem[]; readonly locationLabel: string };
      readonly commands: { reportExternalListError(error: Error): void; clearExternalListError(): void };
    };
    readonly navigation: {
      readonly currentPath: string;
      readonly navigationDrawerOpen: boolean;
      closeChrome(surface: "navigation"): void;
      navigateToPath(path: string): void;
    };
    readonly offline: {
      readonly explicitOfflineMode: boolean;
      setExplicitOfflineMode(enabled: boolean): void;
      projectVisibleFavourites<T extends OfflineFavouriteLike>(entries: readonly T[]): readonly T[];
    };
    readonly operation: {
      readonly capabilities: { readonly canCreateFolder: boolean; readonly canUploadFiles: boolean; readonly canUploadFolders: boolean };
      readonly mutation: { readonly state: { readonly busy: boolean } };
      readonly commands: { openCreateFolder(): void };
      readonly upload: { uploadFiles(files: FileList | File[] | null): Promise<void> };
    };
    readonly status: { readonly commands: { announce(message: string): void } };
    readonly services: {
      readonly favourites: FavouritesService;
      readonly favouritesPointerEnvironment: FavouritesPointerEnvironment;
      readonly favouriteResolveRuntime: FavouriteResolveRuntimePort;
    };
  };
  readonly ports: {
    openPreview(entry: FileEntry, options: { readonly preferFolderAudioPlayer: boolean }): Promise<void>;
    openSettings(): void;
    toDisplayPath(path: string): string;
    readonly directoryUploadInputRef: NavDrawerStageProps["directoryUploadInputRef"];
  };
}

export interface NavigationDrawerWorkspaceOutput {
  readonly binding?: { readonly key?: string; readonly props: NavDrawerStageProps };
  readonly favourites: {
    readonly entries: readonly FavouriteEntry[];
    isFavourite(entry?: FileEntry): boolean;
    toggle(entry: FileEntry): void;
  };
}
