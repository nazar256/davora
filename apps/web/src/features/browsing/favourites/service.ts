import type { FavouritesClock, FavouritesService, FavouritesStorage } from "./ports";
import { createFavouriteEntry, normalizeFavouriteEntries } from "./model";

export const FAVOURITES_STORAGE_PREFIX = "davora-favourites";

export const favouritesStorageKey = (accountId: string): string => `${FAVOURITES_STORAGE_PREFIX}:${accountId}`;

export const createFavouritesService = (
  storage: FavouritesStorage,
  clock: FavouritesClock
): FavouritesService => ({
  load(account) {
    const key = favouritesStorageKey(account.id);
    const read = storage.readItem(key);
    if (!read.ok) {
      return { kind: "load-failed", error: read.error };
    }
    if (!read.value) {
      return { kind: "loaded", entries: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.value);
    } catch {
      const removed = storage.deleteItem(key);
      return removed.ok
        ? { kind: "loaded", entries: [] }
        : { kind: "load-failed", error: removed.error };
    }
    if (!Array.isArray(parsed)) {
      const removed = storage.deleteItem(key);
      return removed.ok
        ? { kind: "loaded", entries: [] }
        : { kind: "load-failed", error: removed.error };
    }
    return { kind: "loaded", entries: normalizeFavouriteEntries(parsed, account, clock.nowIso()) };
  },

  save(account, entries) {
    const normalized = normalizeFavouriteEntries(entries, account, clock.nowIso());
    const written = storage.writeItem(favouritesStorageKey(account.id), JSON.stringify(normalized));
    return written.ok
      ? { kind: "saved", entries: normalized }
      : { kind: "save-failed", error: written.error };
  },

  clear(accountId) {
    const removed = storage.deleteItem(favouritesStorageKey(accountId));
    return removed.ok ? { kind: "cleared" } : { kind: "clear-failed", error: removed.error };
  },

  create(entry, account) {
    return createFavouriteEntry(entry, account, clock.nowIso());
  }
});
