import type { ConnectedAccount, FileEntry } from "@davora/shared";
import { basename, parseNormalizedPath } from "@davora/shared";

export interface FavouriteEntry extends FileEntry {
  accountId: string;
  accountBackend: ConnectedAccount["backend"];
  accountRootPath: string;
  cacheNamespace: string;
  addedAt: string;
  unavailableReason?: string;
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const favouriteEntryKey = (entry: Pick<FileEntry, "path" | "isFolder">): string =>
  `${entry.isFolder ? "folder" : "file"}:${entry.path}`;

export const normalizeFavouriteEntry = (
  candidate: unknown,
  account: ConnectedAccount,
  fallbackAddedAt: string
): FavouriteEntry | undefined => {
  if (!isUnknownRecord(candidate) || typeof candidate.path !== "string" || typeof candidate.isFolder !== "boolean") {
    return undefined;
  }
  let path: string;
  try {
    path = parseNormalizedPath(candidate.path);
  } catch {
    return undefined;
  }
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name
    : basename(path) || "Home";
  return {
    accountId: account.id,
    accountBackend: account.backend,
    accountRootPath: account.rootPath,
    cacheNamespace: account.cacheNamespace,
    path,
    name,
    isFolder: candidate.isFolder,
    size: typeof candidate.size === "number" ? candidate.size : undefined,
    mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
    lastModified: typeof candidate.lastModified === "string" ? candidate.lastModified : undefined,
    etag: typeof candidate.etag === "string" ? candidate.etag : undefined,
    addedAt: typeof candidate.addedAt === "string" ? candidate.addedAt : fallbackAddedAt,
    unavailableReason: typeof candidate.unavailableReason === "string" ? candidate.unavailableReason : undefined
  };
};

export const normalizeFavouriteEntries = (
  candidates: readonly unknown[],
  account: ConnectedAccount,
  fallbackAddedAt: string
): FavouriteEntry[] => {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const entry = normalizeFavouriteEntry(candidate, account, fallbackAddedAt);
    if (!entry) {
      return [];
    }
    const key = favouriteEntryKey(entry);
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [entry];
  });
};

export const createFavouriteEntry = (
  entry: FileEntry,
  account: ConnectedAccount,
  addedAt: string
): FavouriteEntry => ({
  accountId: account.id,
  accountBackend: account.backend,
  accountRootPath: account.rootPath,
  cacheNamespace: account.cacheNamespace,
  path: entry.path,
  name: entry.name,
  isFolder: entry.isFolder,
  size: entry.size,
  mimeType: entry.mimeType,
  lastModified: entry.lastModified,
  etag: entry.etag,
  addedAt
});

export const toFileEntryFromFavourite = (entry: FavouriteEntry): FileEntry => ({
  path: entry.path,
  name: entry.name,
  isFolder: entry.isFolder,
  size: entry.size,
  mimeType: entry.mimeType,
  lastModified: entry.lastModified,
  etag: entry.etag
});

export const reorderFavouriteEntries = (
  entries: FavouriteEntry[],
  draggedKey: string,
  targetKey: string
): FavouriteEntry[] => {
  if (draggedKey === targetKey) {
    return entries;
  }
  const fromIndex = entries.findIndex((entry) => favouriteEntryKey(entry) === draggedKey);
  const toIndex = entries.findIndex((entry) => favouriteEntryKey(entry) === targetKey);
  if (fromIndex < 0 || toIndex < 0) {
    return entries;
  }
  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return entries;
  }
  next.splice(toIndex, 0, moved);
  return next;
};

export const isFavouriteAvailableOffline = (
  favourite: FavouriteEntry,
  entries: readonly { path: string }[]
): boolean => {
  const path = favourite.path.replace(/^\/+|\/+$/g, "");
  return favourite.isFolder
    ? entries.some((entry) => entry.path === path || entry.path.startsWith(`${path}/`))
    : entries.some((entry) => entry.path === path);
};
