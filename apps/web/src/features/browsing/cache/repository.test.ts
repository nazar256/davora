import { describe, expect, it } from "vitest";
import type { FileEntry, SearchResult } from "@davora/shared";

import { buildFileEntry } from "../../../test/files";
import {
  createBrowsingCacheRepository,
  type BrowsingCacheStorage
} from "./index";
import {
  FOLDER_CACHE_PREFIX,
  SEARCH_CACHE_PREFIX,
  V1_FOLDER_CACHE_PREFIX,
  V1_SEARCH_CACHE_PREFIX,
  V1_PURGE_MARKER_KEY,
  decodeV2CacheKey,
  folderCacheKey,
  searchCacheKey
} from "./policy";

function item(path: string): FileEntry;
function item(path: string, score: number): SearchResult;
function item(path: string, score?: number): FileEntry | SearchResult {
  return { ...buildFileEntry(path), ...(score === undefined ? {} : { score }) };
}

const createStorage = (initial: Readonly<Record<string, string>> = {}) => {
  const values = new Map(Object.entries(initial));
  const failures = new Set<"read" | "write" | "list" | "delete">();
  const error = new Error("credential-shaped storage detail");
  const storage: BrowsingCacheStorage = {
    readItem: (key) => failures.has("read")
      ? { ok: false, error }
      : { ok: true, value: values.get(key) ?? null },
    writeItem: (key, value) => {
      if (failures.has("write")) return { ok: false, error };
      values.set(key, value);
      return { ok: true, value: undefined };
    },
    listKeys: () => failures.has("list")
      ? { ok: false, error }
      : { ok: true, value: [...values.keys()] },
    deleteItem: (key) => {
      if (failures.has("delete")) return { ok: false, error };
      values.delete(key);
      return { ok: true, value: undefined };
    }
  };
  return { storage, values, failures };
};

const createRepository = (storage: BrowsingCacheStorage) =>
  createBrowsingCacheRepository(storage, { nowIso: () => "2026-07-23T12:34:56.000Z" });

describe("browsing cache repository", () => {
  it("uses collision-safe v2 keys and preserves the envelope format", () => {
    expect(folderCacheKey("ns:alpha", "Projects:Q3/% done")).toBe(
      `${FOLDER_CACHE_PREFIX}8:ns:alpha18:Projects:Q3/% done`
    );
    expect(searchCacheKey("ns:alpha", "Projects:Q3/% done", "RÉSUMÉ: 100%" )).toBe(
      `${SEARCH_CACHE_PREFIX}8:ns:alpha18:Projects:Q3/% done12:résumé: 100%`
    );

    const { storage, values } = createStorage();
    const repository = createRepository(storage);
    const entry = item("Projects/report.txt");
    expect(repository.writeFolder("ns-alpha", "Projects", [entry])).toEqual({ kind: "written" });
    expect(JSON.parse(values.get(folderCacheKey("ns-alpha", "Projects")) ?? "")).toEqual({
      cachedAt: "2026-07-23T12:34:56.000Z",
      value: [entry]
    });
  });

  it("strictly decodes v2 keys and rejects malformed or noncanonical keys", () => {
    expect(decodeV2CacheKey(folderCacheKey("a:b", "x/%"))).toEqual({ kind: "folder", cacheNamespace: "a:b", path: "x/%" });
    expect(decodeV2CacheKey(searchCacheKey("ns", "", "RÉSUMÉ"))).toEqual({ kind: "search", cacheNamespace: "ns", path: "", query: "résumé" });
    for (const malformed of [
      `${FOLDER_CACHE_PREFIX}1:a1:btrailing`,
      `${FOLDER_CACHE_PREFIX}01:a1:b`,
      `${FOLDER_CACHE_PREFIX}999999999999999999999999999:a`,
      `${FOLDER_CACHE_PREFIX}1:a2:..`,
      `${SEARCH_CACHE_PREFIX}1:a1:b3:Abc`,
      `${SEARCH_CACHE_PREFIX}1:a1:b1:xtrailing`
    ]) {
      expect(decodeV2CacheKey(malformed)).toBeUndefined();
    }
  });

  it("purges every legacy v1 key at construction and preserves unrelated keys", () => {
    const legacyFolder = `${V1_FOLDER_CACHE_PREFIX}ns:old`;
    const legacySearch = `${V1_SEARCH_CACHE_PREFIX}other:query`;
    const { storage, values } = createStorage({
      [legacyFolder]: "old",
      [legacySearch]: "old",
      [folderCacheKey("ns", "Docs")]: "v2",
      unrelated: "keep"
    });
    createRepository(storage);
    expect(values.has(legacyFolder)).toBe(false);
    expect(values.has(legacySearch)).toBe(false);
    expect(values.has(folderCacheKey("ns", "Docs"))).toBe(true);
    expect(values.has("unrelated")).toBe(true);
    expect(values.has(V1_PURGE_MARKER_KEY)).toBe(true);
  });

  it("reruns the global v1 janitor for both clear methods, including entries added later", () => {
    const { storage, values } = createStorage();
    const repository = createRepository(storage);
    const lateFolder = `${V1_FOLDER_CACHE_PREFIX}late:Docs`;
    values.set(lateFolder, "old");
    expect(repository.clearFolderPath("ns", "Docs")).toEqual({ kind: "cleared" });
    expect(values.has(lateFolder)).toBe(false);

    const lateSearch = `${V1_SEARCH_CACHE_PREFIX}late:query`;
    values.set(lateSearch, "old");
    expect(repository.clearNamespace("ns")).toEqual({ kind: "cleared" });
    expect(values.has(lateSearch)).toBe(false);
  });

  it("does not let the marker suppress later scans and attempts every v1 deletion", () => {
    const first = createStorage();
    createRepository(first.storage);
    expect(first.values.has(V1_PURGE_MARKER_KEY)).toBe(true);
    const late = `${V1_FOLDER_CACHE_PREFIX}late:Docs`;
    first.values.set(late, "old");
    createRepository(first.storage);
    expect(first.values.has(late)).toBe(false);

    const firstKey = `${V1_FOLDER_CACHE_PREFIX}ns:first`;
    const secondKey = `${V1_SEARCH_CACHE_PREFIX}ns:second`;
    const tracked = createStorage({ [firstKey]: "old", [secondKey]: "old" });
    const attempted: string[] = [];
    const originalDelete = tracked.storage.deleteItem;
    tracked.storage.deleteItem = (key) => {
      attempted.push(key);
      if (key === firstKey) return { ok: false, error: new Error("delete failed") };
      return originalDelete(key);
    };
    createRepository(tracked.storage);
    expect(new Set(attempted)).toEqual(new Set([firstKey, secondKey]));
    expect(tracked.values.has(V1_PURGE_MARKER_KEY)).toBe(false);
  });

  it("treats marker write failure as audit-only and still clears successfully", () => {
    const tracked = createStorage();
    const originalWrite = tracked.storage.writeItem;
    tracked.storage.writeItem = (key, value) => key === V1_PURGE_MARKER_KEY
      ? { ok: false, error: new Error("marker unavailable") }
      : originalWrite(key, value);
    const repository = createRepository(tracked.storage);
    expect(tracked.values.has(V1_PURGE_MARKER_KEY)).toBe(false);
    expect(repository.clearFolderPath("ns", "Docs")).toEqual({ kind: "cleared" });
  });

  it("purges v1 entries even when a clear request is invalid", () => {
    const { storage, values } = createStorage();
    const repository = createRepository(storage);
    const late = `${V1_SEARCH_CACHE_PREFIX}late:query`;
    values.set(late, "old");
    expect(repository.clearNamespace("", { preserveFolderPaths: ["../invalid"] })).toEqual({ kind: "failed" });
    expect(values.has(late)).toBe(false);
  });

  it("validates legacy folder envelopes before returning trusted values", () => {
    const key = folderCacheKey("ns", "Docs");
    const valid = JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [item("Docs/a.txt")] });
    const { storage, values } = createStorage({ [key]: valid });
    const repository = createRepository(storage);
    expect(repository.readFolder("ns", "Docs")).toEqual({
      kind: "hit",
      cachedAt: "2026-01-01T00:00:00.000Z",
      items: [item("Docs/a.txt")]
    });

    for (const malformed of [
      "{",
      JSON.stringify(null),
      JSON.stringify({ cachedAt: "not-a-date", value: [] }),
      JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: "nope" }),
      JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [item("Docs")] }),
      JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [item("Elsewhere/a.txt")] }),
      JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [{ ...item("Docs/a.txt"), name: "wrong.txt" }] }),
      JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [item("Docs//a.txt")] })
    ]) {
      values.set(key, malformed);
      expect(repository.readFolder("ns", "Docs")).toEqual({ kind: "miss" });
    }
  });

  it("validates search scope, names, finite scores, order, and case-folded identity", () => {
    const { storage, values } = createStorage();
    const repository = createRepository(storage);
    const ordered = [item("Docs/z.txt", 2), item("Docs/a.txt", 1)];
    expect(repository.writeSearch("ns", "Docs", "Report", ordered)).toEqual({ kind: "written" });
    expect(repository.readSearch("ns", "Docs", "report")).toEqual({ kind: "hit", items: ordered });

    const key = searchCacheKey("ns", "Docs", "report");
    for (const value of [
      [item("Elsewhere/a.txt", 1)],
      [{ ...item("Docs/a.txt", 1), name: "wrong.txt" }],
      [{ ...item("Docs/a.txt", 1), score: Number.POSITIVE_INFINITY }]
    ]) {
      values.set(key, JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value }));
      expect(repository.readSearch("ns", "Docs", "REPORT")).toEqual({ kind: "miss" });
    }
  });

  it("keeps encoded search components and exact namespaces isolated", () => {
    const { storage } = createStorage();
    const repository = createRepository(storage);
    repository.writeSearch("alpha", "a:b", "c", [item("a:b/first.txt", 1)]);
    repository.writeSearch("alpha", "a", "b:c", [item("a/second.txt", 1)]);
    repository.writeFolder("alpha-extra", "Docs", [item("Docs/peer.txt")]);
    expect(repository.readSearch("alpha", "a:b", "c")).toMatchObject({ kind: "hit", items: [item("a:b/first.txt", 1)] });
    expect(repository.readSearch("alpha", "a", "b:c")).toMatchObject({ kind: "hit", items: [item("a/second.txt", 1)] });
    expect(repository.clearNamespace("alpha")).toEqual({ kind: "cleared" });
    expect(repository.readFolder("alpha-extra", "Docs")).toMatchObject({ kind: "hit" });
  });

  it("preserves exact roots and descendants while clearing other folders and every search", () => {
    const { storage } = createStorage();
    const repository = createRepository(storage);
    repository.writeFolder("ns", "Projects", [item("Projects/a.txt")]);
    repository.writeFolder("ns", "Projects/Nested", [item("Projects/Nested/a.txt")]);
    repository.writeFolder("ns", "Projects-old", [item("Projects-old/a.txt")]);
    repository.writeFolder("ns", "Archive", [item("Archive/a.txt")]);
    repository.writeSearch("ns", "", "project", [item("Projects/a.txt", 1)]);
    expect(repository.clearNamespace("ns", { preserveFolderPaths: ["Projects"] })).toEqual({ kind: "cleared" });
    expect(repository.readFolder("ns", "Projects")).toMatchObject({ kind: "hit" });
    expect(repository.readFolder("ns", "Projects/Nested")).toMatchObject({ kind: "hit" });
    expect(repository.readFolder("ns", "Projects-old")).toEqual({ kind: "miss" });
    expect(repository.readFolder("ns", "Archive")).toEqual({ kind: "miss" });
    expect(repository.readSearch("ns", "", "project")).toEqual({ kind: "miss" });
  });

  it("clears only an exact folder path and descendants", () => {
    const { storage } = createStorage();
    const repository = createRepository(storage);
    repository.writeFolder("ns", "A:B/%", [item("A:B/%/a.txt")]);
    repository.writeFolder("ns", "A:B/%/Nested", [item("A:B/%/Nested/a.txt")]);
    repository.writeFolder("ns", "A:B/%-peer", [item("A:B/%-peer/a.txt")]);
    expect(repository.clearFolderPath("ns", "A:B/%")).toEqual({ kind: "cleared" });
    expect(repository.readFolder("ns", "A:B/%")).toEqual({ kind: "miss" });
    expect(repository.readFolder("ns", "A:B/%/Nested")).toEqual({ kind: "miss" });
    expect(repository.readFolder("ns", "A:B/%-peer")).toMatchObject({ kind: "hit" });
  });

  it("maps unavailable operations to redacted misses, skipped writes, or failed clears", () => {
    const { storage, failures } = createStorage();
    const repository = createRepository(storage);
    failures.add("read");
    expect(repository.readFolder("ns", "Docs")).toEqual({ kind: "miss" });
    failures.add("write");
    expect(repository.writeFolder("ns", "Docs", [item("Docs/a.txt")])).toEqual({ kind: "skipped" });
    failures.add("list");
    expect(repository.clearNamespace("ns")).toEqual({ kind: "failed" });
    failures.delete("list");
    failures.delete("write");
    repository.writeFolder("ns", "Docs", [item("Docs/a.txt")]);
    failures.add("delete");
    expect(repository.clearFolderPath("ns", "Docs")).toEqual({ kind: "failed" });
    expect(() => repository.clearFolderPathOrThrow("ns", "Docs")).toThrow("Browsing cache cleanup failed.");
  });
});
