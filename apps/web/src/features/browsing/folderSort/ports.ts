import type { SortMode } from "../model";

export type FolderSortStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export interface FolderSortStorage {
  readItem(key: string): FolderSortStorageResult<string | null>;
  writeItem(key: string, value: string): FolderSortStorageResult<void>;
  deleteItem(key: string): FolderSortStorageResult<void>;
  listKeys(): FolderSortStorageResult<readonly string[]>;
}

export type FolderSortListResult =
  | { readonly kind: "listed"; readonly entries: ReadonlyMap<string, SortMode> }
  | { readonly kind: "list-failed"; readonly error: Error };

export type FolderSortWriteResult =
  | { readonly kind: "saved" }
  | { readonly kind: "save-failed"; readonly error: Error };

export type FolderSortClearResult =
  | { readonly kind: "cleared"; readonly removedCount: number }
  | { readonly kind: "clear-failed"; readonly error: Error };

export interface FolderSortService {
  listNamespace(namespace: string): FolderSortListResult;
  write(namespace: string, path: string, mode: SortMode): FolderSortWriteResult;
  clearNamespace(namespace: string): FolderSortClearResult;
}
