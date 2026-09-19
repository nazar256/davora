import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { buildAccount } from "../../../test/accounts";
import {
  createFavouriteEntry,
  favouriteEntryKey,
  isFavouriteAvailableOffline,
  normalizeFavouriteEntries,
  reorderFavouriteEntries,
  toFileEntryFromFavourite
} from "./model";

const NOW = "2026-07-16T20:00:00.000Z";
const account = buildAccount("alpha", {
  backend: "mock",
  rootPath: "Team",
  cacheNamespace: "account:alpha"
});
const file = (path: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  isFolder: false,
  ...overrides
});

describe("favourites model", () => {
  it("normalizes untrusted entries, rebinds account metadata, and preserves valid fields", () => {
    expect(normalizeFavouriteEntries([{
      accountId: "other",
      accountBackend: "nextcloud",
      accountRootPath: "Old",
      cacheNamespace: "old",
      path: "Docs/readme.txt",
      name: "readme.txt",
      isFolder: false,
      size: 42,
      mimeType: "text/plain",
      lastModified: "2026-01-01",
      etag: "etag",
      addedAt: "2026-01-02",
      unavailableReason: "missing"
    }], account, NOW)).toEqual([{
      accountId: account.id,
      accountBackend: account.backend,
      accountRootPath: account.rootPath,
      cacheNamespace: account.cacheNamespace,
      path: "Docs/readme.txt",
      name: "readme.txt",
      isFolder: false,
      size: 42,
      mimeType: "text/plain",
      lastModified: "2026-01-01",
      etag: "etag",
      addedAt: "2026-01-02",
      unavailableReason: "missing"
    }]);
  });

  it("ignores malformed entries and uses basename, Home, and the injected time for missing values", () => {
    expect(normalizeFavouriteEntries([
      null,
      { path: 4, isFolder: false },
      { path: "Docs/report.txt", name: " ", isFolder: false },
      { path: "", isFolder: true }
    ], account, NOW).map(({ path, name, addedAt }) => ({ path, name, addedAt }))).toEqual([
      { path: "Docs/report.txt", name: "report.txt", addedAt: NOW },
      { path: "", name: "Home", addedAt: NOW }
    ]);
  });

  it("rejects unsafe persisted paths without discarding valid siblings", () => {
    const normalized = normalizeFavouriteEntries([
      { path: "safe/file.txt", name: "safe", isFolder: false },
      { path: "../private", name: "named traversal", isFolder: true },
      { path: "../private", name: "", isFolder: true },
      { path: "encoded%2Fseparator", name: "encoded", isFolder: false },
      { path: "back\\slash", name: "backslash", isFolder: false },
      { path: "control\u0000char", name: "control", isFolder: false }
    ], account, NOW);

    expect(normalized.map((entry) => entry.path)).toEqual(["safe/file.txt"]);
  });

  it("deduplicates first-wins while keeping file and folder identities at the same path distinct", () => {
    const normalized = normalizeFavouriteEntries([
      { path: "Shared", name: "First file", isFolder: false, addedAt: "one" },
      { path: "Shared", name: "Duplicate file", isFolder: false, addedAt: "two" },
      { path: "Shared", name: "Folder", isFolder: true, addedAt: "three" }
    ], account, NOW);

    expect(normalized.map((entry) => entry.name)).toEqual(["First file", "Folder"]);
    expect(normalized.map(favouriteEntryKey)).toEqual(["file:Shared", "folder:Shared"]);
  });

  it("creates deterministic entries and converts them back to transport-neutral file entries", () => {
    const favourite = createFavouriteEntry(file("Docs/a.txt", { size: 3 }), account, NOW);

    expect(favourite.addedAt).toBe(NOW);
    expect(toFileEntryFromFavourite(favourite)).toEqual(file("Docs/a.txt", { size: 3 }));
  });

  it("reorders immutably and keeps the original reference for identical or missing keys", () => {
    const entries = normalizeFavouriteEntries([
      { path: "a", name: "a", isFolder: false },
      { path: "b", name: "b", isFolder: false },
      { path: "c", name: "c", isFolder: false }
    ], account, NOW);

    expect(reorderFavouriteEntries(entries, "file:c", "file:a").map((entry) => entry.name)).toEqual(["c", "a", "b"]);
    expect(entries.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(reorderFavouriteEntries(entries, "file:a", "file:a")).toBe(entries);
    expect(reorderFavouriteEntries(entries, "file:missing", "file:a")).toBe(entries);
  });

  it("requires exact retained files and allows retained descendants for folders", () => {
    const [folder, retainedFile] = normalizeFavouriteEntries([
      { path: "/Docs/", name: "Docs", isFolder: true },
      { path: "/Docs/readme.txt/", name: "readme.txt", isFolder: false }
    ], account, NOW);
    const retained = [{ path: "Docs/child.txt" }, { path: "Docs/readme.txt" }];
    if (!folder || !retainedFile) {
      throw new Error("Expected normalized folder and file favourites.");
    }

    expect(isFavouriteAvailableOffline(folder, retained)).toBe(true);
    expect(isFavouriteAvailableOffline(retainedFile, retained)).toBe(true);
    expect(isFavouriteAvailableOffline(retainedFile, [{ path: "Docs/readme.txt/child" }])).toBe(false);
  });
});
