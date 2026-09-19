import { describe, expect, it } from "vitest";

import { folderSortStorageKey } from "./policy";
import { createFolderSortService } from "./service";
import { createFakeFolderSortStorage } from "./testing/fakeStorage";

describe("createFolderSortService", () => {
  it("round-trips folder sort overrides within a namespace", () => {
    const service = createFolderSortService(createFakeFolderSortStorage());

    expect(service.write("ns-a", "Docs", "size-desc")).toEqual({ kind: "saved" });
    expect(service.write("ns-a", "Docs/Sub", "modified-asc")).toEqual({ kind: "saved" });
    expect(service.write("ns-b", "Docs", "name-desc")).toEqual({ kind: "saved" });

    const listed = service.listNamespace("ns-a");
    expect(listed.kind).toBe("listed");
    expect(listed.kind === "listed" ? [...listed.entries] : []).toEqual([
      ["Docs", "size-desc"],
      ["Docs/Sub", "modified-asc"]
    ]);
  });

  it("treats corrupt stored values as absent and removes the bad key", () => {
    const badKey = folderSortStorageKey("ns-a", "Broken");
    const goodKey = folderSortStorageKey("ns-a", "Docs");
    const storage = createFakeFolderSortStorage({ [badKey]: "{not-a-mode", [goodKey]: "size-asc" });
    const service = createFolderSortService(storage);

    const listed = service.listNamespace("ns-a");
    expect(listed.kind).toBe("listed");
    expect(listed.kind === "listed" ? [...listed.entries] : []).toEqual([["Docs", "size-asc"]]);
    expect(storage.deletedKeys).toEqual([badKey]);
    expect(storage.values.has(badKey)).toBe(false);
  });

  it("clears only the target namespace and preserves unrelated keys", () => {
    const storage = createFakeFolderSortStorage({
      [folderSortStorageKey("ns-a", "Docs")]: "size-desc",
      [folderSortStorageKey("ns-a", "Pics")]: "name-desc",
      [folderSortStorageKey("ns-b", "Docs")]: "modified-desc",
      "davora-folder-sort:corrupt": "size-asc",
      "davora-favourites:acc-1": "[]",
      "davora-ui-settings": "{}"
    });
    const service = createFolderSortService(storage);

    expect(service.clearNamespace("ns-a")).toEqual({ kind: "cleared", removedCount: 2 });
    expect([...storage.values.keys()]).toEqual([
      folderSortStorageKey("ns-b", "Docs"),
      "davora-folder-sort:corrupt",
      "davora-favourites:acc-1",
      "davora-ui-settings"
    ]);
  });

  it("reports write, list, and clear failures without claiming success", () => {
    const writeFailure = createFolderSortService(createFakeFolderSortStorage({}, { failWrite: true }));
    expect(writeFailure.write("ns-a", "Docs", "name-asc").kind).toBe("save-failed");

    const listFailure = createFolderSortService(createFakeFolderSortStorage({}, { failList: true }));
    expect(listFailure.listNamespace("ns-a").kind).toBe("list-failed");
    expect(listFailure.clearNamespace("ns-a").kind).toBe("clear-failed");

    const deleteFailure = createFolderSortService(createFakeFolderSortStorage(
      { [folderSortStorageKey("ns-a", "Docs")]: "name-asc" },
      { failDelete: true }
    ));
    expect(deleteFailure.clearNamespace("ns-a").kind).toBe("clear-failed");
  });
});
