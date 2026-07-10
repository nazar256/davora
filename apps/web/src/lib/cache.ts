export const FOLDER_PREFIX = "davora-cache:folder:";
export const SEARCH_PREFIX = "davora-cache:search:";

interface CacheEnvelope<T> {
  cachedAt: string;
  value: T;
}

function accountKey(prefix: string, cacheNamespace: string, suffix: string): string {
  return `${prefix}${cacheNamespace}:${suffix}`;
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify({ cachedAt: new Date().toISOString(), value } satisfies CacheEnvelope<T>));
}

function readEnvelope<T>(key: string): CacheEnvelope<T> | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return undefined;
  }
}

export function cacheFolder(cacheNamespace: string, path: string, value: unknown) {
  write(accountKey(FOLDER_PREFIX, cacheNamespace, path), value);
}

export function readFolderCache<T>(cacheNamespace: string, path: string): T | undefined {
  return readEnvelope<T>(accountKey(FOLDER_PREFIX, cacheNamespace, path))?.value;
}

export function readFolderCacheEnvelope<T>(cacheNamespace: string, path: string): CacheEnvelope<T> | undefined {
  return readEnvelope<T>(accountKey(FOLDER_PREFIX, cacheNamespace, path));
}

export function cacheSearch(cacheNamespace: string, path: string, query: string, value: unknown) {
  write(accountKey(SEARCH_PREFIX, cacheNamespace, `${path}:${query.toLowerCase()}`), value);
}

export function readSearchCache<T>(cacheNamespace: string, path: string, query: string): T | undefined {
  return readEnvelope<T>(accountKey(SEARCH_PREFIX, cacheNamespace, `${path}:${query.toLowerCase()}`))?.value;
}

interface ClearFolderAndSearchCacheOptions {
  preserveFolderPaths?: string[];
}

function shouldPreserveFolderKey(key: string, cacheNamespace: string | undefined, preserveFolderPaths: string[]): boolean {
  if (!cacheNamespace || preserveFolderPaths.length === 0) {
    return false;
  }

  return preserveFolderPaths.some((path) => {
    const preservedKey = accountKey(FOLDER_PREFIX, cacheNamespace, path);
    return key === preservedKey || key.startsWith(`${preservedKey}/`);
  });
}

export function clearFolderAndSearchCache(cacheNamespace?: string, options: ClearFolderAndSearchCacheOptions = {}): void {
  const preserveFolderPaths = options.preserveFolderPaths ?? [];
  Object.keys(localStorage)
    .filter((key) => {
      if (cacheNamespace) {
        const isFolderKey = key.startsWith(`${FOLDER_PREFIX}${cacheNamespace}:`);
        const isSearchKey = key.startsWith(`${SEARCH_PREFIX}${cacheNamespace}:`);
        return (isFolderKey && !shouldPreserveFolderKey(key, cacheNamespace, preserveFolderPaths)) || isSearchKey;
      }
      return key.startsWith(FOLDER_PREFIX) || key.startsWith(SEARCH_PREFIX);
    })
    .forEach((key) => localStorage.removeItem(key));
}

export function clearFolderCacheForPath(cacheNamespace: string, path: string): void {
  const key = accountKey(FOLDER_PREFIX, cacheNamespace, path);
  const descendantPrefix = `${key}/`;
  Object.keys(localStorage)
    .filter((storedKey) => storedKey === key || storedKey.startsWith(descendantPrefix))
    .forEach((storedKey) => localStorage.removeItem(storedKey));
}
