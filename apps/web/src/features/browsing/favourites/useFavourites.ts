import type { ConnectedAccount, FileEntry } from "@davora/shared";
import { useEffect, useRef, useState } from "react";

import { favouriteEntryKey, reorderFavouriteEntries, type FavouriteEntry } from "./model";
import type { FavouritesService } from "./ports";

export type FavouriteCommandResult =
  | { readonly kind: "added" | "removed" | "patched" | "reordered"; readonly entries: FavouriteEntry[] }
  | { readonly kind: "unchanged" | "no-account" }
  | { readonly kind: "save-failed"; readonly error: Error };

interface FavouritesHookState {
  readonly accountContextKey?: string;
  readonly entries: FavouriteEntry[];
  readonly loadFailure?: Error;
}

export interface FavouritesController {
  readonly entries: FavouriteEntry[];
  readonly loadFailure?: Error;
  isFavourite(entry: FileEntry | undefined): boolean;
  toggle(entry: FileEntry): FavouriteCommandResult;
  remove(entry: FavouriteEntry): FavouriteCommandResult;
  patch(key: string, patch: Partial<FavouriteEntry>): FavouriteCommandResult;
  reorder(draggedKey: string, targetKey: string): FavouriteCommandResult;
}

export const useFavourites = (
  account: ConnectedAccount | undefined,
  service: FavouritesService
): FavouritesController => {
  const [state, setState] = useState<FavouritesHookState>({ entries: [] });
  const accountContextKey = account
    ? JSON.stringify([account.id, account.backend, account.rootPath, account.cacheNamespace])
    : undefined;
  const accountRef = useRef(account);
  accountRef.current = account;
  const entries = state.accountContextKey === accountContextKey ? state.entries : [];
  const loadFailure = state.accountContextKey === accountContextKey ? state.loadFailure : undefined;

  useEffect(() => {
    const currentAccount = accountRef.current;
    if (!currentAccount) {
      setState({ accountContextKey: undefined, entries: [] });
      return;
    }
    const loaded = service.load(currentAccount);
    setState(loaded.kind === "loaded"
      ? { accountContextKey, entries: loaded.entries }
      : { accountContextKey, entries: [], loadFailure: loaded.error });
  }, [accountContextKey, service]);

  const save = (nextEntries: FavouriteEntry[], successKind: "added" | "removed" | "patched" | "reordered"): FavouriteCommandResult => {
    if (!account) {
      return { kind: "no-account" };
    }
    const saved = service.save(account, nextEntries);
    if (saved.kind === "save-failed") {
      return saved;
    }
    setState({ accountContextKey, entries: saved.entries });
    return { kind: successKind, entries: saved.entries };
  };

  return {
    entries,
    loadFailure,
    isFavourite(entry) {
      return Boolean(entry && entries.some((favourite) => favouriteEntryKey(favourite) === favouriteEntryKey(entry)));
    },
    toggle(entry) {
      if (!account) {
        return { kind: "no-account" };
      }
      const key = favouriteEntryKey(entry);
      const exists = entries.some((favourite) => favouriteEntryKey(favourite) === key);
      return exists
        ? save(entries.filter((favourite) => favouriteEntryKey(favourite) !== key), "removed")
        : save([...entries, service.create(entry, account)], "added");
    },
    remove(entry) {
      return save(entries.filter((favourite) => favouriteEntryKey(favourite) !== favouriteEntryKey(entry)), "removed");
    },
    patch(key, patch) {
      const next = entries.map((entry) => favouriteEntryKey(entry) === key ? { ...entry, ...patch } : entry);
      return save(next, "patched");
    },
    reorder(draggedKey, targetKey) {
      const next = reorderFavouriteEntries(entries, draggedKey, targetKey);
      return next === entries ? { kind: "unchanged" } : save(next, "reordered");
    }
  };
};
