import type { ConnectedAccount, FileEntry } from "@davora/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  openFavourite,
  removeFavourite,
  reportFavouriteLoadFailure,
  reportFavouriteSaveFailure,
  toggleFavourite
} from "./controller";
import type { FavouriteEntry } from "./model";
import type { FavouriteActionsPorts, FavouritesService } from "./ports";
import { useFavourites } from "./useFavourites";

export interface UseFavouriteActionsInput {
  readonly account: ConnectedAccount | undefined;
  readonly service: FavouritesService;
  readonly token?: string;
  readonly cacheOnlyMode: boolean;
  readonly cacheNamespace?: string;
  readonly ports: FavouriteActionsPorts;
}

export function useFavouriteActions(input: UseFavouriteActionsInput) {
  const controller = useFavourites(input.account, input.service);
  const inputRef = useRef(input);
  const ownerAccountId = input.account?.id;
  const ownerCacheNamespace = input.account?.cacheNamespace;
  const ownerToken = input.token;
  const ownerEpoch = useMemo(() => ({ ownerAccountId, ownerCacheNamespace, ownerToken }), [ownerAccountId, ownerCacheNamespace, ownerToken]);
  const committedOwnerRef = useRef({ epoch: ownerEpoch, input });
  useLayoutEffect(() => {
    inputRef.current = input;
    committedOwnerRef.current = { epoch: ownerEpoch, input };
  }, [input, ownerEpoch]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    reportFavouriteLoadFailure(controller.loadFailure, inputRef.current.ports);
  }, [controller.loadFailure]);

  const resolveContext = useCallback((source: UseFavouriteActionsInput = inputRef.current) => ({
    token: source.token,
    cacheOnlyMode: source.cacheOnlyMode,
    cacheNamespace: source.cacheNamespace
  }), []);

  const open = useCallback(async (entry: FavouriteEntry) => {
    const committedOwner = committedOwnerRef.current;
    await openFavourite(entry, {
      ...resolveContext(committedOwner.input),
      isCurrent: () => mountedRef.current && committedOwnerRef.current.epoch === committedOwner.epoch
    }, controller, committedOwner.input.ports);
  }, [controller, resolveContext]);

  const toggle = useCallback((entry: FileEntry) => {
    toggleFavourite(entry, controller, inputRef.current.ports);
  }, [controller]);

  const remove = useCallback((entry: FavouriteEntry) => {
    removeFavourite(entry, controller, inputRef.current.ports);
  }, [controller]);

  const reorder = useCallback((fromKey: string, toKey: string) => {
    reportFavouriteSaveFailure(controller.reorder(fromKey, toKey), inputRef.current.ports);
  }, [controller]);

  return {
    entries: controller.entries,
    loadFailure: controller.loadFailure,
    isFavourite: controller.isFavourite,
    openFavourite: open,
    toggleFavourite: toggle,
    removeFavourite: remove,
    reorderFavourites: reorder
  };
}
