import { describe, expect, it } from "vitest";
import fc from "fast-check";

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
  folderCacheKey,
  searchCacheKey
} from "./policy";

const PROPERTY_OPTIONS = { seed: 20260901, numRuns: 250 } as const;
const textArbitrary = fc.stringMatching(/^[a-z0-9_-]{1,10}$/u);
const pathArbitrary = fc.array(textArbitrary, { maxLength: 3 }).map((segments) => segments.join("/"));
const nonEmptyPathArbitrary = textArbitrary;
const namespacePairArbitrary = fc.tuple(textArbitrary, textArbitrary)
  .filter(([first, second]) => first !== second);

function createStorage(initial: Readonly<Record<string, string>> = {}): {
  readonly storage: BrowsingCacheStorage;
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      readItem: (key) => ({ ok: true, value: values.get(key) ?? null }),
      writeItem: (key, value) => {
        values.set(key, value);
        return { ok: true, value: undefined };
      },
      listKeys: () => ({ ok: true, value: [...values.keys()] }),
      deleteItem: (key) => {
        values.delete(key);
        return { ok: true, value: undefined };
      }
    }
  };
}

function createRepository(storage: BrowsingCacheStorage) {
  return createBrowsingCacheRepository(storage, { nowIso: () => "2026-09-01T00:00:00.000Z" });
}

function folderItem(path: string, suffix: string): FileEntry {
  const itemPath = path ? `${path}/${suffix}.txt` : `${suffix}.txt`;
  return buildFileEntry(itemPath);
}

function searchItem(path: string, suffix: string, score: number): SearchResult {
  return { ...folderItem(path, suffix), score };
}

describe("browsing cache repository properties", () => {
  it("generates injective folder and search keys for distinct normalized inputs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({ namespace: textArbitrary, path: pathArbitrary }),
          { minLength: 1, maxLength: 50, selector: ({ namespace, path }) => `${namespace}\u0000${path}` }
        ),
        fc.uniqueArray(
          fc.record({ namespace: textArbitrary, path: pathArbitrary, query: textArbitrary }),
          { minLength: 1, maxLength: 50, selector: ({ namespace, path, query }) => `${namespace}\u0000${path}\u0000${query}` }
        ),
        (folderInputs, searchInputs) => {
          const folderKeys = folderInputs.map(({ namespace, path }) => folderCacheKey(namespace, path));
          const searchKeys = searchInputs.map(({ namespace, path, query }) => searchCacheKey(namespace, path, query));
          expect(new Set(folderKeys).size).toBe(folderInputs.length);
          expect(new Set(searchKeys).size).toBe(searchInputs.length);
          expect(folderKeys.every((key) => key.startsWith(FOLDER_CACHE_PREFIX))).toBe(true);
          expect(searchKeys.every((key) => key.startsWith(SEARCH_CACHE_PREFIX))).toBe(true);
        }
      ),
      PROPERTY_OPTIONS
    );
  });

  it("keeps namespace A clears from changing or revealing namespace B", async () => {
    await fc.assert(
      fc.asyncProperty(namespacePairArbitrary, pathArbitrary, textArbitrary, async ([namespaceA, namespaceB], path, query) => {
        const { storage, values } = createStorage();
        const repository = createRepository(storage);
        const aFolder = [folderItem(path, "a")];
        const bFolder = [folderItem(path, "b")];
        const aSearch = [searchItem(path, "a", 10)];
        const bSearch = [searchItem(path, "b", 20)];
        expect(repository.writeFolder(namespaceA, path, aFolder, "complete")).toEqual({ kind: "written" });
        expect(repository.writeFolder(namespaceB, path, bFolder, "complete")).toEqual({ kind: "written" });
        expect(repository.writeSearch(namespaceA, path, query, aSearch)).toEqual({ kind: "written" });
        expect(repository.writeSearch(namespaceB, path, query, bSearch)).toEqual({ kind: "written" });
        const bKeys = [folderCacheKey(namespaceB, path), searchCacheKey(namespaceB, path, query)];
        const bValuesBefore = bKeys.map((key) => values.get(key));

        expect(repository.clearNamespace(namespaceA)).toEqual({ kind: "cleared" });

        expect(repository.readFolder(namespaceA, path)).toEqual({ kind: "miss" });
        expect(repository.readSearch(namespaceA, path, query)).toEqual({ kind: "miss" });
        expect(repository.readFolder(namespaceB, path)).toEqual({ completeness: "complete" as const, kind: "hit", cachedAt: "2026-09-01T00:00:00.000Z", items: bFolder });
        expect(repository.readSearch(namespaceB, path, query)).toEqual({ kind: "hit", items: bSearch });
        expect(bKeys.map((key) => values.get(key))).toEqual(bValuesBefore);
      }),
      PROPERTY_OPTIONS
    );
  });

  it("clears only the requested folder scope while preserving prefix peers and other accounts", () => {
    fc.assert(
      fc.property(namespacePairArbitrary, nonEmptyPathArbitrary, ( [namespaceA, namespaceB], scope) => {
        const { storage } = createStorage();
        const repository = createRepository(storage);
        const descendant = `${scope}/child`;
        const peer = `${scope}-peer`;
        repository.writeFolder(namespaceA, scope, [folderItem(scope, "root")], "complete");
        repository.writeFolder(namespaceA, descendant, [folderItem(descendant, "child")], "complete");
        repository.writeFolder(namespaceA, peer, [folderItem(peer, "peer")], "complete");
        repository.writeFolder(namespaceB, scope, [folderItem(scope, "foreign")], "complete");

        expect(repository.clearFolderPath(namespaceA, scope)).toEqual({ kind: "cleared" });
        expect(repository.readFolder(namespaceA, scope)).toEqual({ kind: "miss" });
        expect(repository.readFolder(namespaceA, descendant)).toEqual({ kind: "miss" });
        expect(repository.readFolder(namespaceA, peer)).toMatchObject({ kind: "hit" });
        expect(repository.readFolder(namespaceB, scope)).toMatchObject({ kind: "hit" });
      }),
      PROPERTY_OPTIONS
    );
  });

  it("does not mutate caller-owned folder or search arrays during writes", () => {
    fc.assert(
      fc.property(
        pathArbitrary,
        textArbitrary,
        fc.array(textArbitrary, { minLength: 1, maxLength: 8 }),
        (path, query, suffixes) => {
          const { storage } = createStorage();
          const repository = createRepository(storage);
          const folders = suffixes.map((suffix) => folderItem(path, suffix));
          const searches = suffixes.map((suffix, index) => searchItem(path, suffix, index));
          const foldersBefore = structuredClone(folders);
          const searchesBefore = structuredClone(searches);

          expect(repository.writeFolder("owner", path, folders, "complete")).toEqual({ kind: "written" });
          expect(repository.writeSearch("owner", path, query, searches)).toEqual({ kind: "written" });
          expect(folders).toEqual(foldersBefore);
          expect(searches).toEqual(searchesBefore);
        }
      ),
      PROPERTY_OPTIONS
    );
  });

  it("repairs malformed or legacy entries deterministically without touching unrelated data", () => {
    fc.assert(
      fc.property(textArbitrary, fc.string({ maxLength: 80 }), (namespace, malformed) => {
        const legacyKey = `${V1_FOLDER_CACHE_PREFIX}${namespace}`;
        const legacySearchKey = `${V1_SEARCH_CACHE_PREFIX}${namespace}`;
        const initial = { [legacyKey]: malformed, [legacySearchKey]: malformed, unrelated: "preserve" };
        const first = createStorage(initial);
        createRepository(first.storage);
        const firstValues = [...first.values.entries()];

        createRepository(first.storage);
        expect([...first.values.entries()]).toEqual(firstValues);
        expect(first.values.get("unrelated")).toBe("preserve");
        expect(first.values.has(legacyKey)).toBe(false);
        expect(first.values.has(legacySearchKey)).toBe(false);
      }),
      PROPERTY_OPTIONS
    );
  });
});
