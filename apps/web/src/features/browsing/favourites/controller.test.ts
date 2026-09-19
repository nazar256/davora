import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  openFavourite,
  removeFavourite,
  reportFavouriteLoadFailure,
  reportFavouriteSaveFailure,
  resolveFavouriteTarget,
  toggleFavourite
} from "./controller";
import type { FavouriteEntry } from "./model";
import type { FavouriteActionsPorts } from "./ports";
import type { FavouriteCommandResult, FavouritesController } from "./useFavourites";

function favourite(overrides: Partial<FavouriteEntry> = {}): FavouriteEntry {
  return {
    accountId: "alpha",
    accountBackend: "nextcloud",
    accountRootPath: "Files",
    cacheNamespace: "alpha-cache",
    path: "Projects",
    name: "Projects",
    isFolder: true,
    addedAt: "2026-07-16T20:00:00.000Z",
    ...overrides
  };
}

function createPorts(overrides: Partial<FavouriteActionsPorts> = {}): FavouriteActionsPorts {
  return {
    resolve: {
      listFiles: vi.fn(async () => ({ items: [] as FileEntry[] })),
      cacheFolder: vi.fn(),
      toDisplayPath: (path) => (path ? `/${path}` : "/"),
      ...overrides.resolve
    },
    open: {
      closeNavigationChrome: vi.fn(),
      navigateToPath: vi.fn(),
      openFile: vi.fn(async () => undefined),
      ...overrides.open
    },
    surface: {
      setStatus: vi.fn(),
      reportListError: vi.fn(),
      ...overrides.surface
    }
  };
}

function createStore(overrides: Partial<FavouritesController> = {}): FavouritesController {
  return {
    entries: [],
    isFavourite: vi.fn(() => false),
    toggle: vi.fn((): FavouriteCommandResult => ({ kind: "added", entries: [] })),
    remove: vi.fn((): FavouriteCommandResult => ({ kind: "removed", entries: [] })),
    patch: vi.fn((): FavouriteCommandResult => ({ kind: "patched", entries: [] })),
    reorder: vi.fn((): FavouriteCommandResult => ({ kind: "reordered", entries: [] })),
    ...overrides
  };
}

describe("favourites controller", () => {
  it("returns the favourite entry without listing when cache-only or token is missing", async () => {
    const ports = createPorts();
    const entry = favourite({ path: "roadmap.txt", name: "roadmap.txt", isFolder: false });

    await expect(resolveFavouriteTarget(entry, { cacheOnlyMode: true, token: "session" }, ports)).resolves.toEqual({
      path: "roadmap.txt",
      name: "roadmap.txt",
      isFolder: false
    });
    await expect(resolveFavouriteTarget(entry, { cacheOnlyMode: false }, ports)).resolves.toEqual({
      path: "roadmap.txt",
      name: "roadmap.txt",
      isFolder: false
    });
    expect(ports.resolve.listFiles).not.toHaveBeenCalled();
  });

  it("lists the parent folder, caches namespaced results, and resolves live entries", async () => {
    const ports = createPorts({
      resolve: {
        listFiles: vi.fn(async () => ({
          items: [{ path: "Projects", name: "Projects", isFolder: true }]
        })),
        cacheFolder: vi.fn(),
        toDisplayPath: (path) => `/${path}`
      }
    });
    const entry = favourite();

    await expect(resolveFavouriteTarget(entry, {
      token: "session",
      cacheOnlyMode: false,
      cacheNamespace: "alpha-cache"
    }, ports)).resolves.toEqual({ path: "Projects", name: "Projects", isFolder: true });

    expect(ports.resolve.listFiles).toHaveBeenCalledWith("", "session");
    expect(ports.resolve.cacheFolder).toHaveBeenCalledWith("alpha-cache", "", [{ path: "Projects", name: "Projects", isFolder: true }]);
  });

  it("fails live resolve with unavailable copy when the entry is missing", async () => {
    const ports = createPorts({
      resolve: {
        listFiles: vi.fn(async () => ({ items: [] })),
        cacheFolder: vi.fn(),
        toDisplayPath: () => "/Projects"
      }
    });

    await expect(resolveFavouriteTarget(favourite(), {
      token: "session",
      cacheOnlyMode: false
    }, ports)).rejects.toThrow("Projects is no longer available at /Projects.");
  });

  it("clears unavailableReason, closes navigation chrome, and navigates folders on successful open", async () => {
    const ports = createPorts({
      resolve: {
        listFiles: vi.fn(async () => ({
          items: [{ path: "Projects", name: "Projects", isFolder: true }]
        })),
        cacheFolder: vi.fn(),
        toDisplayPath: (path) => `/${path}`
      }
    });
    const store = createStore();
    const entry = favourite();

    await openFavourite(entry, { token: "session", cacheOnlyMode: false, cacheNamespace: "alpha-cache" }, store, ports);

    expect(store.patch).toHaveBeenCalledWith("folder:Projects", expect.objectContaining({
      path: "Projects",
      unavailableReason: undefined
    }));
    expect(ports.open.closeNavigationChrome).toHaveBeenCalled();
    expect(ports.open.navigateToPath).toHaveBeenCalledWith("Projects");
    expect(ports.open.openFile).not.toHaveBeenCalled();
  });

  it("opens files with preferFolderAudioPlayer on successful open", async () => {
    const resolved = { path: "roadmap.txt", name: "roadmap.txt", isFolder: false };
    const ports = createPorts({
      resolve: {
        listFiles: vi.fn(async () => ({ items: [resolved] })),
        cacheFolder: vi.fn(),
        toDisplayPath: (path) => `/${path}`
      }
    });
    const store = createStore();
    const entry = favourite({ path: "roadmap.txt", name: "roadmap.txt", isFolder: false });

    await openFavourite(entry, { token: "session", cacheOnlyMode: false }, store, ports);

    expect(ports.open.openFile).toHaveBeenCalledWith(resolved, { preferFolderAudioPlayer: true });
    expect(ports.open.navigateToPath).not.toHaveBeenCalled();
  });

  it("patches unavailableReason, sets list error, and reports status on failed open", async () => {
    const ports = createPorts({
      resolve: {
        listFiles: vi.fn(async () => ({ items: [] })),
        cacheFolder: vi.fn(),
        toDisplayPath: () => "/Projects"
      }
    });
    const store = createStore();
    const entry = favourite();

    await openFavourite(entry, { token: "session", cacheOnlyMode: false }, store, ports);

    expect(store.patch).toHaveBeenCalledWith("folder:Projects", { unavailableReason: "Projects is no longer available at /Projects." });
    expect(ports.surface.reportListError).toHaveBeenCalledWith(new Error("Projects is no longer available at /Projects."));
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Favourite unavailable: Projects is no longer available at /Projects.");
  });

  it("reports save failures without success status strings for toggle and remove", () => {
    const ports = createPorts();
    const saveFailed: FavouriteCommandResult = { kind: "save-failed", error: new Error("Quota exceeded") };
    const store = createStore({
      toggle: vi.fn(() => saveFailed),
      remove: vi.fn(() => saveFailed)
    });
    const entry = favourite({ path: "roadmap.txt", name: "roadmap.txt", isFolder: false });

    toggleFavourite(entry, store, ports);
    removeFavourite(entry, store, ports);

    expect(ports.surface.reportListError).toHaveBeenCalledWith(new Error("Unable to save Favourites: Quota exceeded"));
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Unable to save Favourites in this browser.");
    expect(ports.surface.setStatus).not.toHaveBeenCalledWith(expect.stringMatching(/^Added /));
    expect(ports.surface.setStatus).not.toHaveBeenCalledWith(expect.stringMatching(/^Removed /));
  });

  it("keeps exact success status strings for toggle and remove", () => {
    const ports = createPorts();
    const store = createStore({
      toggle: vi.fn((entry: FileEntry): FavouriteCommandResult => ({
        kind: entry.path === "new.txt" ? "added" : "removed",
        entries: []
      })),
      remove: vi.fn((): FavouriteCommandResult => ({ kind: "removed", entries: [] }))
    });
    const added = favourite({ path: "new.txt", name: "new.txt", isFolder: false });
    const removed = favourite({ path: "old.txt", name: "old.txt", isFolder: false });

    toggleFavourite(added, store, ports);
    toggleFavourite(removed, store, ports);
    removeFavourite(removed, store, ports);

    expect(ports.surface.setStatus).toHaveBeenCalledWith("Added new.txt to Favourites.");
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Removed old.txt from Favourites.");
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Removed old.txt from Favourites. The original item was not deleted.");
  });

  it("reports browser load failures through list error and status", () => {
    const ports = createPorts();

    reportFavouriteLoadFailure(undefined, ports);
    reportFavouriteLoadFailure(new Error("read failed"), ports);

    expect(ports.surface.reportListError).toHaveBeenCalledTimes(1);
    expect(ports.surface.reportListError).toHaveBeenCalledWith(new Error("Unable to load Favourites: read failed"));
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Unable to load Favourites in this browser.");
  });

  it("returns whether a command result was a save failure", () => {
    const ports = createPorts();

    expect(reportFavouriteSaveFailure({ kind: "added", entries: [] }, ports)).toBe(false);
    expect(reportFavouriteSaveFailure({ kind: "save-failed", error: new Error("blocked") }, ports)).toBe(true);
    expect(ports.surface.setStatus).toHaveBeenCalledWith("Unable to save Favourites in this browser.");
  });
});
