import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildAccount } from "../../../test/accounts";
import { createFavouritesService } from "./service";
import { createFakeFavouritesStorage } from "./testing/fakeStorage";
import { useFavourites } from "./useFavourites";

const NOW = "2026-07-16T20:00:00.000Z";

describe("useFavourites", () => {
  it("loads atomically by account and never exposes the previous account entries", () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "alpha.txt", name: "alpha.txt", isFolder: false }]),
      "davora-favourites:beta": JSON.stringify([{ path: "beta.txt", name: "beta.txt", isFolder: false }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const { result, rerender } = renderHook(({ account }) => useFavourites(account, service), {
      initialProps: { account: alpha }
    });

    expect(result.current.entries.map((entry) => entry.name)).toEqual(["alpha.txt"]);
    rerender({ account: beta });
    expect(result.current.entries.map((entry) => entry.name)).toEqual(["beta.txt"]);
  });

  it("reloads and rebinds entries when same-ID account metadata changes", () => {
    const initial = buildAccount("alpha", { rootPath: "Old", cacheNamespace: "old-cache" });
    const updated = buildAccount("alpha", { rootPath: "New", cacheNamespace: "new-cache" });
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "Docs", name: "Docs", isFolder: true }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const { result, rerender } = renderHook(({ account }) => useFavourites(account, service), {
      initialProps: { account: initial }
    });

    expect(result.current.entries[0]?.accountRootPath).toBe("Old");
    rerender({ account: updated });
    expect(result.current.entries[0]).toMatchObject({ accountRootPath: "New", cacheNamespace: "new-cache" });
  });

  it("contains unsafe persisted paths instead of throwing from the load effect", () => {
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "../private", name: "private", isFolder: true }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const { result } = renderHook(() => useFavourites(buildAccount("alpha"), service));

    expect(result.current.entries).toEqual([]);
    expect(result.current.loadFailure).toBeUndefined();
  });

  it("adds, patches, reorders, and removes through explicit successful results", () => {
    const account = buildAccount("alpha");
    const service = createFavouritesService(createFakeFavouritesStorage(), { nowIso: () => NOW });
    const { result } = renderHook(() => useFavourites(account, service));

    act(() => expect(result.current.toggle({ path: "a", name: "a", isFolder: false }).kind).toBe("added"));
    act(() => expect(result.current.toggle({ path: "b", name: "b", isFolder: false }).kind).toBe("added"));
    act(() => expect(result.current.patch("file:a", { unavailableReason: "missing" }).kind).toBe("patched"));
    expect(result.current.entries[0]?.unavailableReason).toBe("missing");
    act(() => expect(result.current.reorder("file:b", "file:a").kind).toBe("reordered"));
    expect(result.current.entries.map((entry) => entry.name)).toEqual(["b", "a"]);
    const firstEntry = result.current.entries[0];
    if (!firstEntry) {
      throw new Error("Expected a favourite to remove.");
    }
    act(() => expect(result.current.remove(firstEntry).kind).toBe("removed"));
    expect(result.current.entries.map((entry) => entry.name)).toEqual(["a"]);
  });

  it("keeps current state intact and returns an explicit save failure", () => {
    const account = buildAccount("alpha");
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const { result } = renderHook(() => useFavourites(account, service));

    act(() => { result.current.toggle({ path: "kept", name: "kept", isFolder: false }); });
    storage.failWrite = true;
    let outcome: ReturnType<typeof result.current.toggle> | undefined;
    act(() => { outcome = result.current.toggle({ path: "lost", name: "lost", isFolder: false }); });

    expect(outcome?.kind).toBe("save-failed");
    expect(result.current.entries.map((entry) => entry.name)).toEqual(["kept"]);
  });

  it("reports load failures without exposing entries", () => {
    const service = createFavouritesService(createFakeFavouritesStorage({}, { failRead: true }), { nowIso: () => NOW });
    const { result } = renderHook(() => useFavourites(buildAccount("alpha"), service));

    expect(result.current.entries).toEqual([]);
    expect(result.current.loadFailure?.message).toBe("read failed");
  });
});
