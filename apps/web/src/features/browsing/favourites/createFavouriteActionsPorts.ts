import type { FileEntry } from "@davora/shared";

import type { FavouriteActionsPorts } from "./ports";

export interface CreateFavouriteActionsPortsInput {
  listFiles(parentPath: string, token: string): Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>;
  cacheFolder(namespace: string, parentPath: string, items: readonly FileEntry[], completeness: "complete" | "partial"): void;
  toDisplayPath(path: string): string;
  closeNavigationChrome(): void;
  navigateToPath(path: string): void;
  openFile(entry: FileEntry, options: { readonly preferFolderAudioPlayer: boolean }): Promise<void>;
  setStatus(message: string): void;
  reportListError(error: Error | undefined): void;
}

export function createFavouriteActionsPorts(input: CreateFavouriteActionsPortsInput): FavouriteActionsPorts {
  return {
    resolve: {
      listFiles: (parentPath, token) => input.listFiles(parentPath, token),
      cacheFolder: (namespace, parentPath, items, completeness) => input.cacheFolder(namespace, parentPath, items, completeness),
      toDisplayPath: (path) => input.toDisplayPath(path)
    },
    open: {
      closeNavigationChrome: () => input.closeNavigationChrome(),
      navigateToPath: (path) => input.navigateToPath(path),
      openFile: (entry, options) => input.openFile(entry, options)
    },
    surface: {
      setStatus: (message) => input.setStatus(message),
      reportListError: (error) => input.reportListError(error)
    }
  };
}
