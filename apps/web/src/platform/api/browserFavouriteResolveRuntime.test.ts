import { describe, expect, it, vi } from "vitest";

import { buildFileEntry } from "../../test/files";
import { createBrowsingCacheRepository, type BrowsingCacheStorage } from "../../features/browsing/cache";
import { createBrowserFavouriteResolveRuntime } from "./browserFavouriteResolveRuntime";

describe("createBrowserFavouriteResolveRuntime", () => {
  it("keeps the authorized list request and shared cache identity", async () => {
    const storage = createStorage();
    const cache = createBrowsingCacheRepository(storage, { nowIso: () => "2026-08-05T00:00:00.000Z" });
    const items = [buildFileEntry("Projects/readme.txt")];
    const listFiles = vi.fn(async (path: string, token: string) => {
      expect(path).toBe("Projects");
      expect(token).toBe("runtime-token");
      return { completeness: "complete" as const, items };
    });
    const runtime = createBrowserFavouriteResolveRuntime(cache, { listFiles });

    await expect(runtime.listFiles("Projects", "runtime-token")).resolves.toEqual({ completeness: "complete" as const, items });
    runtime.cacheFolder("ns-alpha", "Projects", items, "complete");

    expect(cache.readFolder("ns-alpha", "Projects")).toMatchObject({ completeness: "complete" as const, kind: "hit", items });
    expect(listFiles).toHaveBeenCalledWith("Projects", "runtime-token");
  });

  it("normalizes resolve failures without persisting their details", async () => {
    const cache = createBrowsingCacheRepository(createStorage(), { nowIso: () => "2026-08-05T00:00:00.000Z" });
    const runtime = createBrowserFavouriteResolveRuntime(cache, {
      listFiles: vi.fn(async () => { throw new Error("raw secret"); })
    });

    await expect(runtime.listFiles("", "token")).rejects.toThrow("Unable to resolve this favourite.");
    await expect(runtime.listFiles("", "token")).rejects.not.toThrow("raw secret");
  });
});

function createStorage(): BrowsingCacheStorage {
  const values = new Map<string, string>();
  return {
    readItem: (key) => ({ ok: true, value: values.get(key) ?? null }),
    writeItem: (key, value) => { values.set(key, value); return { ok: true, value: undefined }; },
    listKeys: () => ({ ok: true, value: [...values.keys()] }),
    deleteItem: (key) => { values.delete(key); return { ok: true, value: undefined }; }
  };
}
