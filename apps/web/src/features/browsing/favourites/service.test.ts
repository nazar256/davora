import { describe, expect, it } from "vitest";

import { buildAccount } from "../../../test/accounts";
import { createFakeFavouritesStorage } from "./testing/fakeStorage";
import { createFavouritesService, favouritesStorageKey } from "./service";

const NOW = "2026-07-16T20:00:00.000Z";
const account = buildAccount("alpha");

describe("favourites service", () => {
  it("loads only the active account namespace and normalizes stored entries", () => {
    const storage = createFakeFavouritesStorage({
      [favouritesStorageKey(account.id)]: JSON.stringify([
        { path: "Docs", name: "Docs", isFolder: true },
        { path: "Docs", name: "duplicate", isFolder: true }
      ]),
      [favouritesStorageKey("beta")]: JSON.stringify([{ path: "Other", name: "Other", isFolder: true }])
    });

    const result = createFavouritesService(storage, { nowIso: () => NOW }).load(account);

    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.entries.map((entry) => entry.name)).toEqual(["Docs"]);
    }
    expect(storage.readKeys).toEqual([favouritesStorageKey(account.id)]);
  });

  it("removes corrupt JSON and returns an empty loaded result", () => {
    const storage = createFakeFavouritesStorage({ [favouritesStorageKey(account.id)]: "{" });

    expect(createFavouritesService(storage, { nowIso: () => NOW }).load(account)).toEqual({ kind: "loaded", entries: [] });
    expect(storage.deletedKeys).toEqual([favouritesStorageKey(account.id)]);
  });

  it("never throws for unsafe persisted paths and retains valid siblings", () => {
    const storage = createFakeFavouritesStorage({
      [favouritesStorageKey(account.id)]: JSON.stringify([
        { path: "../private", name: "private", isFolder: true },
        { path: "Docs/report.txt", name: "report.txt", isFolder: false }
      ])
    });

    const result = createFavouritesService(storage, { nowIso: () => NOW }).load(account);

    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.entries.map((entry) => entry.path)).toEqual(["Docs/report.txt"]);
    }
  });

  it("reports read and corrupt-cleanup failures explicitly", () => {
    const readFailure = createFakeFavouritesStorage({}, { failRead: true });
    const deleteFailure = createFakeFavouritesStorage({ [favouritesStorageKey(account.id)]: "{" }, { failDelete: true });

    expect(createFavouritesService(readFailure, { nowIso: () => NOW }).load(account).kind).toBe("load-failed");
    expect(createFavouritesService(deleteFailure, { nowIso: () => NOW }).load(account).kind).toBe("load-failed");
  });

  it("normalizes and saves in order, or reports failure without claiming saved state", () => {
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const entries = [
      service.create({ path: "b", name: "b", isFolder: false }, account),
      service.create({ path: "a", name: "a", isFolder: false }, account)
    ];

    const saved = service.save(account, entries);
    expect(saved.kind).toBe("saved");
    expect(JSON.parse(storage.values.get(favouritesStorageKey(account.id)) ?? "null")).toEqual(entries);

    storage.failWrite = true;
    expect(service.save(account, entries).kind).toBe("save-failed");
  });

  it("reports clear failure so callers can ignore it without blocking account removal", () => {
    const storage = createFakeFavouritesStorage({}, { failDelete: true });

    expect(createFavouritesService(storage, { nowIso: () => NOW }).clear(account.id).kind).toBe("clear-failed");
  });
});
