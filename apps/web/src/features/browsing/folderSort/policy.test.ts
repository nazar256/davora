import { describe, expect, it } from "vitest";

import {
  buildFolderSortClearedMessage,
  buildFolderSortResetQuestion,
  decodeFolderSortStorageKey,
  folderSortStorageKey,
  planFolderSortNamespaceClear
} from "./policy";

describe("folderSort policy", () => {
  it("round-trips namespace and path including separators and colons", () => {
    const cases: readonly { namespace: string; path: string }[] = [
      { namespace: "ns-alpha", path: "Docs" },
      { namespace: "https://cloud.example:8443|user|root|nextcloud", path: "A/B:C/D" },
      { namespace: "ns:with:colons", path: "deep:path/with:colons" },
      { namespace: "ns-alpha", path: "" }
    ];
    for (const { namespace, path } of cases) {
      expect(decodeFolderSortStorageKey(folderSortStorageKey(namespace, path)))
        .toEqual({ namespace, path });
    }
  });

  it("keeps keys collision-free for ambiguous namespace/path splits", () => {
    const first = folderSortStorageKey("a:b", "c");
    const second = folderSortStorageKey("a", "b:c");
    expect(first).not.toBe(second);
    expect(decodeFolderSortStorageKey(first)).toEqual({ namespace: "a:b", path: "c" });
    expect(decodeFolderSortStorageKey(second)).toEqual({ namespace: "a", path: "b:c" });
  });

  it("rejects malformed or noncanonical keys without touching them", () => {
    const malformed = [
      "davora-folder-sort:",
      "davora-folder-sort:3:abc",
      "davora-folder-sort:3:abc4:Docs:extra",
      "davora-folder-sort:x:abc4:Docs",
      "davora-folder-sort:3:abc5:Docs/",  // noncanonical trailing slash
      "davora-folder-sort:3:abc7:../evil",
      "davora-folder-sort:0:4:Docs",       // empty namespace
      "davora-folder-sort:3:abc9:Do",      // declared length exceeds available bytes
      "davora-ui-settings",
      "davora-cache:v2:folder:3:abc4:Docs",
      ""
    ];
    for (const key of malformed) {
      expect(decodeFolderSortStorageKey(key), key).toBeUndefined();
    }
  });

  it("plans namespace clears that keep other namespaces and unrelated keys", () => {
    const keys = [
      folderSortStorageKey("ns-a", "Docs"),
      folderSortStorageKey("ns-a", "Docs/Sub"),
      folderSortStorageKey("ns-b", "Docs"),
      "davora-folder-sort:corrupt",
      "davora-favourites:acc-1",
      "davora-ui-settings"
    ];
    expect(planFolderSortNamespaceClear(keys, "ns-a")).toEqual([keys[0], keys[1]]);
    expect(planFolderSortNamespaceClear(keys, "ns-missing")).toEqual([]);
  });

  it("builds count-aware cleared and confirm copy", () => {
    expect(buildFolderSortClearedMessage(0)).toBe("Folder sort settings cleared.");
    expect(buildFolderSortClearedMessage(1)).toBe("Folder sort settings cleared for 1 folder.");
    expect(buildFolderSortClearedMessage(3)).toBe("Folder sort settings cleared for 3 folders.");
    expect(buildFolderSortResetQuestion(1)).toBe("Clear saved sort for 1 folder?");
    expect(buildFolderSortResetQuestion(2)).toBe("Clear saved sort for 2 folders?");
  });
});
