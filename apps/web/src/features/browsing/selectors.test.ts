import type { FileEntry, SearchResult } from "@davora/shared";
import { describe, expect, it } from "vitest";

import type { SortMode } from "./model";
import { selectVisibleItems, sortAndGroupEntries } from "./selectors";

const entry = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path: name,
  name,
  isFolder: false,
  ...overrides
});

const names = (entries: readonly FileEntry[]): string[] => entries.map((item) => item.name);

describe("browsing selectors", () => {
  const entries = [
    entry("z-folder", { isFolder: true, size: 100, lastModified: "2024-01-01" }),
    entry("beta.txt", { size: 20, lastModified: "2023-01-01" }),
    entry("a-folder", { isFolder: true, size: 1, lastModified: "2022-01-01" }),
    entry("alpha.txt")
  ];

  it.each<[SortMode, string[]]>([
    ["name-asc", ["a-folder", "z-folder", "alpha.txt", "beta.txt"]],
    ["name-desc", ["z-folder", "a-folder", "beta.txt", "alpha.txt"]],
    ["modified-desc", ["z-folder", "a-folder", "beta.txt", "alpha.txt"]],
    ["modified-asc", ["a-folder", "z-folder", "alpha.txt", "beta.txt"]],
    ["size-desc", ["z-folder", "a-folder", "beta.txt", "alpha.txt"]],
    ["size-asc", ["a-folder", "z-folder", "alpha.txt", "beta.txt"]]
  ])("keeps folders first and applies %s within each group", (mode, expected) => {
    expect(names(sortAndGroupEntries(entries, mode))).toEqual(expected);
  });

  it("treats missing size as zero and missing modification time as empty", () => {
    const missing = entry("missing.txt");
    const zero = entry("zero.txt", { size: 0, lastModified: "" });

    expect(names(sortAndGroupEntries([missing, zero], "size-asc"))).toEqual(["missing.txt", "zero.txt"]);
    expect(names(sortAndGroupEntries([missing, zero], "modified-asc"))).toEqual(["missing.txt", "zero.txt"]);
  });

  it("does not mutate input and preserves the input order of ties", () => {
    const first = entry("first.txt", { size: 5, lastModified: "2024-01-01" });
    const second = entry("second.txt", { size: 5, lastModified: "2024-01-01" });
    const input = [first, second];

    expect(sortAndGroupEntries(input, "size-asc")).toEqual([first, second]);
    expect(input).toEqual([first, second]);
  });

  it("filters hidden browse entries before folder-first sorting", () => {
    expect(names(selectVisibleItems({
      browseEntries: [entry("visible.txt"), entry(".hidden"), entry("Folder", { isFolder: true })],
      searchActive: false,
      searchResults: [],
      showHiddenFiles: false,
      sortMode: "name-asc"
    }))).toEqual(["Folder", "visible.txt"]);
  });

  it("filters hidden search results without changing backend relevance order", () => {
    const results: SearchResult[] = [
      { ...entry("third.txt"), score: 0.1 },
      { ...entry(".hidden"), score: 1 },
      { ...entry("first.txt"), score: 0.9 }
    ];

    expect(names(selectVisibleItems({
      browseEntries: [],
      searchActive: true,
      searchResults: results,
      showHiddenFiles: false,
      sortMode: "name-asc"
    }))).toEqual(["third.txt", "first.txt"]);
  });

  it("includes hidden entries in their otherwise unchanged browse/search ordering when enabled", () => {
    expect(names(selectVisibleItems({
      browseEntries: [entry("visible.txt"), entry(".hidden")],
      searchActive: false,
      searchResults: [],
      showHiddenFiles: true,
      sortMode: "name-asc"
    }))).toEqual([".hidden", "visible.txt"]);
  });
});
