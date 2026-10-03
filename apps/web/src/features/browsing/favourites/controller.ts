import { dirname } from "@davora/shared";
import type { FileEntry } from "@davora/shared";

import { favouriteEntryKey, toFileEntryFromFavourite, type FavouriteEntry } from "./model";
import type { FavouriteActionsPorts } from "./ports";
import type { FavouriteCommandResult, FavouritesController } from "./useFavourites";

export interface FavouriteResolveContext {
  readonly token?: string;
  readonly cacheOnlyMode: boolean;
  readonly cacheNamespace?: string;
  readonly isCurrent?: () => boolean;
}

class UnverifiedFavouriteError extends Error {}

class StaleFavouriteOperationError extends Error {
  constructor() {
    super("Favourite operation superseded.");
    this.name = "StaleFavouriteOperationError";
  }
}

function assertFavouriteOperationCurrent(context: FavouriteResolveContext): void {
  if (context.isCurrent && !context.isCurrent()) {
    throw new StaleFavouriteOperationError();
  }
}

export function reportFavouriteSaveFailure(
  result: FavouriteCommandResult,
  ports: Pick<FavouriteActionsPorts, "surface">
): boolean {
  if (result.kind !== "save-failed") {
    return false;
  }
  ports.surface.reportListError(new Error(`Unable to save Favourites: ${result.error.message}`));
  ports.surface.setStatus("Unable to save Favourites in this browser.");
  return true;
}

export async function resolveFavouriteTarget(
  entry: FavouriteEntry,
  context: FavouriteResolveContext,
  ports: Pick<FavouriteActionsPorts, "resolve">
): Promise<FileEntry> {
  if (!context.token || context.cacheOnlyMode) {
    return toFileEntryFromFavourite(entry);
  }
  const parentPath = entry.path ? dirname(entry.path) : "";
  const response = await ports.resolve.listFiles(parentPath, context.token);
  assertFavouriteOperationCurrent(context);
  if (context.cacheNamespace) {
    assertFavouriteOperationCurrent(context);
    ports.resolve.cacheFolder(context.cacheNamespace, parentPath, response.items, response.completeness);
  }
  const resolved = response.items.find((item) => item.path === entry.path && item.isFolder === entry.isFolder);
  if (!resolved && response.completeness !== "complete") {
    throw new UnverifiedFavouriteError(`${entry.name} could not be verified because only part of its folder is listed.`);
  }
  if (!resolved) {
    throw new Error(`${entry.name} is no longer available at ${ports.resolve.toDisplayPath(entry.path)}.`);
  }
  return resolved;
}

export async function openFavourite(
  entry: FavouriteEntry,
  context: FavouriteResolveContext,
  store: Pick<FavouritesController, "patch">,
  ports: FavouriteActionsPorts
): Promise<void> {
  try {
    const resolved = await resolveFavouriteTarget(entry, context, ports);
    assertFavouriteOperationCurrent(context);
    reportFavouriteSaveFailure(store.patch(favouriteEntryKey(entry), {
      ...resolved,
      unavailableReason: undefined
    }), ports);
    assertFavouriteOperationCurrent(context);
    ports.open.closeNavigationChrome();
    if (resolved.isFolder) {
      assertFavouriteOperationCurrent(context);
      ports.open.navigateToPath(resolved.path);
    } else {
      assertFavouriteOperationCurrent(context);
      await ports.open.openFile(resolved, { preferFolderAudioPlayer: true });
    }
  } catch (error) {
    if (error instanceof StaleFavouriteOperationError || (context.isCurrent && !context.isCurrent())) {
      return;
    }
    const message = error instanceof Error ? error.message : "This favourite is unavailable.";
    if (!(error instanceof UnverifiedFavouriteError)) {
      reportFavouriteSaveFailure(store.patch(favouriteEntryKey(entry), { unavailableReason: message }), ports);
    }
    ports.surface.reportListError(new Error(message));
    ports.surface.setStatus(`Favourite unavailable: ${message}`);
  }
}

export function toggleFavourite(
  entry: FileEntry,
  store: Pick<FavouritesController, "toggle">,
  ports: Pick<FavouriteActionsPorts, "surface">
): void {
  const result = store.toggle(entry);
  if (reportFavouriteSaveFailure(result, ports)) {
    return;
  }
  if (result.kind === "added") {
    ports.surface.setStatus(`Added ${entry.name} to Favourites.`);
  } else if (result.kind === "removed") {
    ports.surface.setStatus(`Removed ${entry.name} from Favourites.`);
  }
}

export function removeFavourite(
  entry: FavouriteEntry,
  store: Pick<FavouritesController, "remove">,
  ports: Pick<FavouriteActionsPorts, "surface">
): void {
  const result = store.remove(entry);
  if (!reportFavouriteSaveFailure(result, ports) && result.kind === "removed") {
    ports.surface.setStatus(`Removed ${entry.name} from Favourites. The original item was not deleted.`);
  }
}

export function reportFavouriteLoadFailure(
  loadFailure: Error | undefined,
  ports: Pick<FavouriteActionsPorts, "surface">
): void {
  if (!loadFailure) {
    return;
  }
  ports.surface.reportListError(new Error(`Unable to load Favourites: ${loadFailure.message}`));
  ports.surface.setStatus("Unable to load Favourites in this browser.");
}
