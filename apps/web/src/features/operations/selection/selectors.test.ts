import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { createBatchSelectionState, toggleBatchSelection } from "./model";
import { selectBatchArchiveInput, selectBatchEntries, selectBatchSelectionSummary } from "./selectors";

const entry = (path: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false,
  mimeType: "text/plain",
  ...overrides
});

describe("batch selection selectors", () => {
  it("summarizes 0/1/N files, folders, known bytes, and unknown-or-folder sizes", () => {
    let state = createBatchSelectionState("alpha");
    expect(selectBatchSelectionSummary(state)).toEqual({ count: 0, fileCount: 0, folderCount: 0, knownFileSizeBytes: 0, unknownSizeCount: 0 });

    state = toggleBatchSelection(state, "alpha", entry("zero.txt", { size: 0 }), { kind: "browse", folderPath: "" }).state;
    state = toggleBatchSelection(state, "alpha", entry("known.txt", { size: 7 }), { kind: "browse", folderPath: "" }).state;
    state = toggleBatchSelection(state, "alpha", entry("unknown.txt", { size: undefined }), { kind: "browse", folderPath: "" }).state;
    state = toggleBatchSelection(state, "alpha", entry("Folder", { isFolder: true, size: 99 }), { kind: "browse", folderPath: "" }).state;

    expect(selectBatchSelectionSummary(state)).toEqual({ count: 4, fileCount: 3, folderCount: 1, knownFileSizeBytes: 7, unknownSizeCount: 2 });
    expect(selectBatchEntries(state).map((item) => item.path)).toEqual(["zero.txt", "known.txt", "unknown.txt", "Folder"]);
  });

  it("keeps search roots full and browse roots relative to their captured folder after UI context changes", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", entry("Projects/report.txt"), { kind: "search", scopePath: "" }).state;
    state = toggleBatchSelection(state, "alpha", entry("Archive/report.txt"), { kind: "search", scopePath: "Archive" }).state;
    const searchInput = selectBatchArchiveInput(state);

    expect(searchInput.archiveLabel).toBe("search-results");
    expect(searchInput.roots.map((root) => root.archiveRoot)).toEqual(["Projects/report.txt", "Archive/report.txt"]);

    state = toggleBatchSelection(state, "alpha", entry("Archive/local.txt"), { kind: "browse", folderPath: "Archive" }).state;
    const mixedInput = selectBatchArchiveInput(state);
    expect(mixedInput.archiveLabel).toBe("selection");
    expect(mixedInput.roots.map((root) => root.archiveRoot)).toEqual(["Projects/report.txt", "Archive/report.txt", "local.txt"]);
  });

  it("uses Home or one captured browse folder for multi-item archive naming", () => {
    let rootState = createBatchSelectionState("alpha");
    rootState = toggleBatchSelection(rootState, "alpha", entry("one.txt"), { kind: "browse", folderPath: "" }).state;
    rootState = toggleBatchSelection(rootState, "alpha", entry("two.txt"), { kind: "browse", folderPath: "" }).state;
    expect(selectBatchArchiveInput(rootState).archiveLabel).toBe("home");

    let nestedState = createBatchSelectionState("alpha");
    nestedState = toggleBatchSelection(nestedState, "alpha", entry("Projects/one.txt"), { kind: "browse", folderPath: "Projects" }).state;
    nestedState = toggleBatchSelection(nestedState, "alpha", entry("Projects/two.txt"), { kind: "browse", folderPath: "Projects" }).state;
    expect(selectBatchArchiveInput(nestedState).archiveLabel).toBe("Projects");
  });
});
