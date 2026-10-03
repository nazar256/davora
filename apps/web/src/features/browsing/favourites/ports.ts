import type { ConnectedAccount, FileEntry } from "@davora/shared";

import type { FavouriteEntry } from "./model";

export type StorageOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export interface FavouritesStorage {
  readItem(key: string): StorageOperationResult<string | null>;
  writeItem(key: string, value: string): StorageOperationResult<void>;
  deleteItem(key: string): StorageOperationResult<void>;
}

export interface FavouritesClock {
  nowIso(): string;
}

export type FavouritesLoadResult =
  | { readonly kind: "loaded"; readonly entries: FavouriteEntry[] }
  | { readonly kind: "load-failed"; readonly error: Error };

export type FavouritesSaveResult =
  | { readonly kind: "saved"; readonly entries: FavouriteEntry[] }
  | { readonly kind: "save-failed"; readonly error: Error };

export type FavouritesClearResult =
  | { readonly kind: "cleared" }
  | { readonly kind: "clear-failed"; readonly error: Error };

export interface FavouritesService {
  load(account: ConnectedAccount): FavouritesLoadResult;
  save(account: ConnectedAccount, entries: readonly FavouriteEntry[]): FavouritesSaveResult;
  clear(accountId: string): FavouritesClearResult;
  create(entry: FileEntry, account: ConnectedAccount): FavouriteEntry;
}

export interface FavouritesPointerEnvironment {
  elementFromPoint(x: number, y: number): Element | null;
  addWindowListener(
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ): () => void;
}

export interface FavouriteResolvePorts {
  listFiles(parentPath: string, token: string): Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>;
  cacheFolder(namespace: string, parentPath: string, items: readonly FileEntry[], completeness: "complete" | "partial"): void;
  toDisplayPath(path: string): string;
}

export interface FavouriteOpenPorts {
  closeNavigationChrome(): void;
  navigateToPath(path: string): void;
  openFile(entry: FileEntry, options: { readonly preferFolderAudioPlayer: boolean }): Promise<void>;
}

export interface FavouriteSurfacePorts {
  setStatus(message: string): void;
  reportListError(error: Error | undefined): void;
}

export interface FavouriteActionsPorts {
  readonly resolve: FavouriteResolvePorts;
  readonly open: FavouriteOpenPorts;
  readonly surface: FavouriteSurfacePorts;
}
