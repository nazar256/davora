export type BrowsingCacheStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export interface BrowsingCacheStorage {
  readItem(key: string): BrowsingCacheStorageResult<string | null>;
  writeItem(key: string, value: string): BrowsingCacheStorageResult<void>;
  listKeys(): BrowsingCacheStorageResult<readonly string[]>;
  deleteItem(key: string): BrowsingCacheStorageResult<void>;
}

export interface BrowsingCacheClock {
  nowIso(): string;
}
