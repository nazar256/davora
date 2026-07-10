import { afterEach, describe, expect, it } from "vitest";

import {
  cacheFolder,
  cacheSearch,
  clearFolderAndSearchCache,
  readFolderCache,
  readSearchCache
} from "./lib/cache";

describe("folder and search cache", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("preserves explicitly kept offline folder snapshots while clearing normal cache", () => {
    cacheFolder("ns-alpha", "Projects", [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }]);
    cacheFolder("ns-alpha", "Projects/Nested", [{ path: "Projects/Nested/notes.txt", name: "notes.txt", isFolder: false }]);
    cacheFolder("ns-alpha", "Archive", [{ path: "Archive/photo.png", name: "photo.png", isFolder: false }]);
    cacheSearch("ns-alpha", "", "road", [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }]);

    clearFolderAndSearchCache("ns-alpha", { preserveFolderPaths: ["Projects"] });

    expect(readFolderCache("ns-alpha", "Projects")).toEqual([{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }]);
    expect(readFolderCache("ns-alpha", "Projects/Nested")).toEqual([{ path: "Projects/Nested/notes.txt", name: "notes.txt", isFolder: false }]);
    expect(readFolderCache("ns-alpha", "Archive")).toBeUndefined();
    expect(readSearchCache("ns-alpha", "", "road")).toBeUndefined();
  });
});
