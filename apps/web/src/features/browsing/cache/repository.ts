import type { FileEntry, SearchResult } from "@davora/shared";

import type { BrowsingCacheClock, BrowsingCacheStorage } from "./ports";
import {
  V1_FOLDER_CACHE_PREFIX,
  V1_SEARCH_CACHE_PREFIX,
  V1_PURGE_MARKER_KEY,
  folderCacheKey,
  isValidCacheNamespace,
  isValidCachePath,
  parseFolderCacheEnvelope,
  parseSearchCacheEnvelope,
  planFolderPathCacheClear,
  planNamespaceCacheClear,
  searchCacheKey
} from "./policy";

export type BrowsingCacheWriteResult = { readonly kind: "written" } | { readonly kind: "skipped" };
export type BrowsingCacheClearResult = { readonly kind: "cleared" } | { readonly kind: "failed" };
export type FolderCacheReadResult =
  | { readonly kind: "hit"; readonly cachedAt: string; readonly completeness: "complete" | "partial" | "unknown"; readonly items: FileEntry[] }
  | { readonly kind: "miss" };
export type SearchCacheReadResult =
  | { readonly kind: "hit"; readonly items: SearchResult[] }
  | { readonly kind: "miss" };

export interface BrowsingCacheRepository {
  readFolder(cacheNamespace: string, path: string): FolderCacheReadResult;
  writeFolder(cacheNamespace: string, path: string, items: readonly FileEntry[], completeness: "complete" | "partial"): BrowsingCacheWriteResult;
  readSearch(cacheNamespace: string, path: string, query: string): SearchCacheReadResult;
  writeSearch(cacheNamespace: string, path: string, query: string, items: readonly SearchResult[]): BrowsingCacheWriteResult;
  clearNamespace(cacheNamespace: string, options?: { readonly preserveFolderPaths?: readonly string[] }): BrowsingCacheClearResult;
  clearFolderPath(cacheNamespace: string, path: string): BrowsingCacheClearResult;
  clearNamespaceOrThrow(cacheNamespace: string, options?: { readonly preserveFolderPaths?: readonly string[] }): void;
  clearFolderPathOrThrow(cacheNamespace: string, path: string): void;
}

export class BrowsingCacheClearError extends Error {
  constructor() {
    super("Browsing cache cleanup failed.");
    this.name = "BrowsingCacheClearError";
  }
}

const serialize = (cachedAt: string, value: unknown, completeness?: "complete" | "partial"): string => JSON.stringify({ cachedAt, ...(completeness ? { completeness } : {}), value });

const isLegacyKey = (key: string): boolean =>
  key.startsWith(V1_FOLDER_CACHE_PREFIX) || key.startsWith(V1_SEARCH_CACHE_PREFIX);

export const createBrowsingCacheRepository = (
  storage: BrowsingCacheStorage,
  clock: BrowsingCacheClock
): BrowsingCacheRepository => {
  const safeListKeys = (): readonly string[] | undefined => {
    try {
      const result = storage.listKeys();
      return result.ok ? result.value : undefined;
    } catch {
      return undefined;
    }
  };

  const safeDelete = (key: string): boolean => {
    try {
      return storage.deleteItem(key).ok;
    } catch {
      return false;
    }
  };

  const safeRead = (key: string): string | null | undefined => {
    try {
      const result = storage.readItem(key);
      return result.ok ? result.value : undefined;
    } catch {
      return undefined;
    }
  };

  const safeWrite = (key: string, value: string): boolean => {
    try {
      return storage.writeItem(key, value).ok;
    } catch {
      return false;
    }
  };

  const runV1Janitor = (): boolean => {
    const listed = safeListKeys();
    if (!listed) return false;
    let deletionsSucceeded = true;
    for (const key of listed) {
      if (isLegacyKey(key) && !safeDelete(key)) deletionsSucceeded = false;
    }
    const verified = safeListKeys();
    if (!verified || !deletionsSucceeded || verified.some(isLegacyKey)) return false;
    // Marker writes are an audit hint only; a failed marker does not undo a proven purge.
    try { safeWrite(V1_PURGE_MARKER_KEY, clock.nowIso()); } catch { /* best effort */ }
    return true;
  };

  // Purge stale v1 entries synchronously at construction. Reads and writes remain v2-only
  // even when storage enumeration or deletion is unavailable.
  runV1Janitor();

  const deleteAndVerify = (keys: readonly string[]): boolean => {
    let deletionsSucceeded = true;
    for (const key of keys) {
      if (!safeDelete(key)) deletionsSucceeded = false;
    }
    const verified = safeListKeys();
    if (!verified) return false;
    return deletionsSucceeded && !verified.some((key) => keys.includes(key));
  };

  const repository: BrowsingCacheRepository = {
    readFolder(cacheNamespace, path) {
      if (!isValidCacheNamespace(cacheNamespace) || !isValidCachePath(path)) return { kind: "miss" };
      const read = safeRead(folderCacheKey(cacheNamespace, path));
      if (read === undefined || read === null) return { kind: "miss" };
      const parsed = parseFolderCacheEnvelope(read, path);
      return parsed ? { kind: "hit", ...parsed } : { kind: "miss" };
    },

    writeFolder(cacheNamespace, path, items, completeness) {
      if (!isValidCacheNamespace(cacheNamespace) || !isValidCachePath(path)) return { kind: "skipped" };
      try {
        const write = storage.writeItem(folderCacheKey(cacheNamespace, path), serialize(clock.nowIso(), items, completeness));
        return write.ok ? { kind: "written" } : { kind: "skipped" };
      } catch {
        return { kind: "skipped" };
      }
    },

    readSearch(cacheNamespace, path, query) {
      if (!isValidCacheNamespace(cacheNamespace) || !isValidCachePath(path) || typeof query !== "string") {
        return { kind: "miss" };
      }
      const read = safeRead(searchCacheKey(cacheNamespace, path, query));
      if (read === undefined || read === null) return { kind: "miss" };
      const parsed = parseSearchCacheEnvelope(read, path);
      return parsed ? { kind: "hit", ...parsed } : { kind: "miss" };
    },

    writeSearch(cacheNamespace, path, query, items) {
      if (!isValidCacheNamespace(cacheNamespace) || !isValidCachePath(path) || typeof query !== "string") {
        return { kind: "skipped" };
      }
      try {
        const write = storage.writeItem(searchCacheKey(cacheNamespace, path, query), serialize(clock.nowIso(), items));
        return write.ok ? { kind: "written" } : { kind: "skipped" };
      } catch {
        return { kind: "skipped" };
      }
    },

    clearNamespace(cacheNamespace, options = {}) {
      if (options === null || typeof options !== "object" || Array.isArray(options)) {
        runV1Janitor();
        return { kind: "failed" };
      }
      const preserveFolderPaths = options.preserveFolderPaths;
      if (!isValidCacheNamespace(cacheNamespace)
        || (preserveFolderPaths !== undefined
          && (!Array.isArray(preserveFolderPaths) || preserveFolderPaths.some((path) => !isValidCachePath(path))))) {
        runV1Janitor();
        return { kind: "failed" };
      }
      const listed = safeListKeys();
      const v2Cleared = listed
        ? deleteAndVerify(planNamespaceCacheClear(listed, cacheNamespace, preserveFolderPaths))
        : false;
      const v1Cleared = runV1Janitor();
      return v2Cleared && v1Cleared ? { kind: "cleared" } : { kind: "failed" };
    },

    clearFolderPath(cacheNamespace, path) {
      if (!isValidCacheNamespace(cacheNamespace) || !isValidCachePath(path)) {
        runV1Janitor();
        return { kind: "failed" };
      }
      const listed = safeListKeys();
      const v2Cleared = listed
        ? deleteAndVerify(planFolderPathCacheClear(listed, cacheNamespace, path))
        : false;
      const v1Cleared = runV1Janitor();
      return v2Cleared && v1Cleared ? { kind: "cleared" } : { kind: "failed" };
    },

    clearNamespaceOrThrow(cacheNamespace, options) {
      if (repository.clearNamespace(cacheNamespace, options).kind === "failed") throw new BrowsingCacheClearError();
    },

    clearFolderPathOrThrow(cacheNamespace, path) {
      if (repository.clearFolderPath(cacheNamespace, path).kind === "failed") throw new BrowsingCacheClearError();
    }
  };
  return repository;
};
