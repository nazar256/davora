import { del, get, keys, set } from "idb-keyval";

import type { FilePreview } from "@davora/shared";

const CACHE_PREFIX = "davora-opened-file:";
const INDEX_PREFIX = "davora-opened-file:index:";
const envLimit = Number.parseInt(import.meta.env.VITE_OPENED_FILE_CACHE_LIMIT_BYTES ?? "", 10);
export const MIN_OPENED_FILE_CACHE_LIMIT = 1024 * 1024;
export const MAX_OPENED_FILE_CACHE_LIMIT = 8 * 1024 * 1024 * 1024;
export const DEFAULT_OPENED_FILE_CACHE_LIMIT = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 24 * 1024 * 1024;

export interface OpenedFileCacheEntry {
  path: string;
  preview: FilePreview;
  mimeType: string;
  filename: string;
  blobKey?: string;
  blobSize: number;
  cachedAt: string;
  lastAccessedAt: string;
  keepOffline?: boolean;
  keepOfflineRoot?: string;
  keepOfflineRootName?: string;
  keepOfflineRootKind?: "file" | "folder" | "batch";
  keepOfflineAddedAt?: string;
}

interface CacheIndex {
  limitBytes: number;
  entries: Record<string, OpenedFileCacheEntry>;
}

function blobStorageKey(cacheNamespace: string, path: string): string {
  return `${CACHE_PREFIX}${cacheNamespace}:${path}:blob`;
}

function indexKey(cacheNamespace: string): string {
  return `${INDEX_PREFIX}${cacheNamespace}`;
}

function createEmptyIndex(limitBytes = DEFAULT_OPENED_FILE_CACHE_LIMIT): CacheIndex {
  return {
    limitBytes: clampCacheLimit(limitBytes),
    entries: {}
  };
}

function clampCacheLimit(limitBytes: number): number {
  if (!Number.isFinite(limitBytes)) {
    return MIN_OPENED_FILE_CACHE_LIMIT;
  }

  return Math.min(MAX_OPENED_FILE_CACHE_LIMIT, Math.max(MIN_OPENED_FILE_CACHE_LIMIT, Math.round(limitBytes)));
}

async function readIndex(cacheNamespace: string): Promise<CacheIndex> {
  return (await get<CacheIndex>(indexKey(cacheNamespace))) ?? createEmptyIndex();
}

async function writeIndex(cacheNamespace: string, index: CacheIndex): Promise<void> {
  await set(indexKey(cacheNamespace), index);
}

function evictableSize(index: CacheIndex): number {
  return Object.values(index.entries).filter((entry) => !entry.keepOffline).reduce((total, entry) => total + entry.blobSize, 0);
}

async function removeEntry(cacheNamespace: string, path: string, index: CacheIndex): Promise<void> {
  const existing = index.entries[path];
  if (!existing) {
    return;
  }
  if (existing.blobKey) {
    await del(existing.blobKey);
  }
  delete index.entries[path];
}

async function enforceLimit(cacheNamespace: string, index: CacheIndex): Promise<void> {
  const orderedEntries = Object.values(index.entries).filter((entry) => !entry.keepOffline).sort((left, right) => {
    return Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt) || left.path.localeCompare(right.path);
  });

  while (evictableSize(index) > index.limitBytes && orderedEntries.length > 0) {
    const oldest = orderedEntries.shift();
    if (!oldest) {
      break;
    }
    await removeEntry(cacheNamespace, oldest.path, index);
  }
}

export async function configureOpenedFileCache(cacheNamespace: string, limitBytes: number): Promise<void> {
  const index = await readIndex(cacheNamespace);
  index.limitBytes = clampCacheLimit(limitBytes);
  await enforceLimit(cacheNamespace, index);
  await writeIndex(cacheNamespace, index);
}

export async function clearOpenedFileCache(cacheNamespace?: string): Promise<void> {
  if (!cacheNamespace) {
    const allKeys = await keys();
    await Promise.all(allKeys.filter((key): key is string => typeof key === "string" && key.startsWith(CACHE_PREFIX)).map((key) => del(key)));
    await Promise.all(allKeys.filter((key): key is string => typeof key === "string" && key.startsWith(INDEX_PREFIX)).map((key) => del(key)));
    return;
  }

  const index = await readIndex(cacheNamespace);
  const keptOfflineEntries: Record<string, OpenedFileCacheEntry> = {};
  await Promise.all(Object.values(index.entries).map((entry) => {
    if (entry.keepOffline) {
      keptOfflineEntries[entry.path] = entry;
      return Promise.resolve();
    }
    return entry.blobKey ? del(entry.blobKey) : Promise.resolve();
  }));
  if (Object.keys(keptOfflineEntries).length > 0) {
    index.entries = keptOfflineEntries;
    await writeIndex(cacheNamespace, index);
  } else {
    await del(indexKey(cacheNamespace));
  }
}

export async function cacheOpenedFile(cacheNamespace: string, input: {
  path: string;
  preview: FilePreview;
  blob?: Blob;
  mimeType: string;
  filename: string;
  maxBlobBytes?: number;
  keepOffline?: boolean;
  keepOfflineRoot?: string;
  keepOfflineRootName?: string;
  keepOfflineRootKind?: "file" | "folder" | "batch";
}): Promise<OpenedFileCacheEntry> {
  const index = await readIndex(cacheNamespace);
  const now = new Date().toISOString();
  const existingEntry = index.entries[input.path];
  const shouldStoreBlob = Boolean(input.blob) && (!Number.isFinite(input.maxBlobBytes) || (input.blob?.size ?? 0) <= (input.maxBlobBytes ?? Number.POSITIVE_INFINITY));
  const preserveExistingOfflineBlob = Boolean(existingEntry?.keepOffline && existingEntry.blobKey && !input.keepOffline && !shouldStoreBlob);
  const blobKey = shouldStoreBlob && input.blob ? blobStorageKey(cacheNamespace, input.path) : preserveExistingOfflineBlob ? existingEntry?.blobKey : undefined;
  const blobSize = shouldStoreBlob ? input.blob?.size ?? 0 : preserveExistingOfflineBlob ? existingEntry?.blobSize ?? 0 : 0;

  if (existingEntry?.blobKey && existingEntry.blobKey !== blobKey) {
    await del(existingEntry.blobKey);
  }

  if (shouldStoreBlob && blobKey && input.blob) {
    await set(blobKey, input.blob);
  }

  index.entries[input.path] = {
    path: input.path,
    preview: input.preview,
    mimeType: input.mimeType,
    filename: input.filename,
    ...(blobKey ? { blobKey } : {}),
    blobSize,
    cachedAt: existingEntry?.cachedAt ?? now,
    lastAccessedAt: now,
    ...(input.keepOffline || existingEntry?.keepOffline ? { keepOffline: true } : {}),
    ...(input.keepOfflineRoot ?? existingEntry?.keepOfflineRoot ? { keepOfflineRoot: input.keepOfflineRoot ?? existingEntry?.keepOfflineRoot } : {}),
    ...(input.keepOfflineRootName ?? existingEntry?.keepOfflineRootName ? { keepOfflineRootName: input.keepOfflineRootName ?? existingEntry?.keepOfflineRootName } : {}),
    ...(input.keepOfflineRootKind ?? existingEntry?.keepOfflineRootKind ? { keepOfflineRootKind: input.keepOfflineRootKind ?? existingEntry?.keepOfflineRootKind } : {}),
    ...(input.keepOffline || existingEntry?.keepOfflineAddedAt ? { keepOfflineAddedAt: existingEntry?.keepOfflineAddedAt ?? now } : {})
  };

  await enforceLimit(cacheNamespace, index);
  await writeIndex(cacheNamespace, index);
  return index.entries[input.path]!;
}

export async function getCachedOpenedFile(cacheNamespace: string, path: string): Promise<{ entry: OpenedFileCacheEntry; blob?: Blob } | undefined> {
  const index = await readIndex(cacheNamespace);
  const entry = index.entries[path];
  if (!entry) {
    return undefined;
  }

  entry.lastAccessedAt = new Date().toISOString();
  index.entries[path] = entry;
  await writeIndex(cacheNamespace, index);
  const blob = entry.blobKey ? await get<Blob>(entry.blobKey) : undefined;
  return { entry, ...(blob ? { blob } : {}) };
}

export async function listOpenedFileCacheEntries(cacheNamespace: string): Promise<OpenedFileCacheEntry[]> {
  const index = await readIndex(cacheNamespace);
  return Object.values(index.entries).sort((left, right) => Date.parse(right.lastAccessedAt) - Date.parse(left.lastAccessedAt));
}

export async function listOfflineFileCacheEntries(cacheNamespace: string): Promise<OpenedFileCacheEntry[]> {
  const index = await readIndex(cacheNamespace);
  return Object.values(index.entries)
    .filter((entry) => entry.keepOffline)
    .sort((left, right) => Date.parse(right.keepOfflineAddedAt ?? right.cachedAt) - Date.parse(left.keepOfflineAddedAt ?? left.cachedAt));
}

export async function removeOpenedFileCacheEntry(cacheNamespace: string, path: string): Promise<void> {
  const index = await readIndex(cacheNamespace);
  await removeEntry(cacheNamespace, path, index);
  await writeIndex(cacheNamespace, index);
}

function isOfflineRootMatch(entry: OpenedFileCacheEntry, rootPath: string): boolean {
  const root = rootPath.replace(/^\/+|\/+$/g, "");
  const entryRoot = (entry.keepOfflineRoot ?? entry.path).replace(/^\/+|\/+$/g, "");
  return entryRoot === root || entryRoot.startsWith(`${root}/`) || entry.path === root || entry.path.startsWith(`${root}/`);
}

export async function removeOfflineRoot(cacheNamespace: string, rootPath: string): Promise<void> {
  const index = await readIndex(cacheNamespace);
  const paths = Object.values(index.entries)
    .filter((entry) => entry.keepOffline && isOfflineRootMatch(entry, rootPath))
    .map((entry) => entry.path);
  for (const path of paths) {
    await removeEntry(cacheNamespace, path, index);
  }
  await writeIndex(cacheNamespace, index);
}

export async function getOpenedFileCacheSummary(cacheNamespace: string): Promise<{ itemCount: number; totalBytes: number; limitBytes: number }> {
  const index = await readIndex(cacheNamespace);
  const evictableEntries = Object.values(index.entries).filter((entry) => !entry.keepOffline);
  return {
    itemCount: evictableEntries.length,
    totalBytes: evictableEntries.reduce((total, entry) => total + entry.blobSize, 0),
    limitBytes: index.limitBytes
  };
}

export async function debugListBlobKeys(): Promise<string[]> {
  return (await keys()).filter((key): key is string => typeof key === "string" && key.startsWith(CACHE_PREFIX));
}
