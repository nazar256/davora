import { describe, expect, it } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  planBatchSelectionToggle,
  planClearBatchSelection,
  planEntrySelectionToggle,
  planSelectAllEntries,
  resolveBatchSelectionOrigin
} from "./interaction";

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isFolder: path.endsWith("/") || overrides.isFolder === true,
    ...overrides
  };
}

describe("planEntrySelectionToggle", () => {
  it("opens mobile details when re-tapping the same entry on narrow with details closed", () => {
    const projects = entry("Projects", { isFolder: true });

    expect(planEntrySelectionToggle({
      entry: projects,
      selectedEntryPath: "Projects",
      isNarrowScreen: true,
      mobileDetailsOpen: false
    })).toEqual({
      focused: [],
      chrome: [{ kind: "openMobileDetails" }]
    });
  });

  it("clears focused selection and collapses mobile chrome when re-tapping the same entry with details open", () => {
    const projects = entry("Projects", { isFolder: true });

    expect(planEntrySelectionToggle({
      entry: projects,
      selectedEntryPath: "Projects",
      isNarrowScreen: true,
      mobileDetailsOpen: true
    })).toEqual({
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }]
    });
  });

  it("clears focused selection on wide when re-tapping the same entry", () => {
    const projects = entry("Projects", { isFolder: true });

    expect(planEntrySelectionToggle({
      entry: projects,
      selectedEntryPath: "Projects",
      isNarrowScreen: false,
      mobileDetailsOpen: false
    })).toEqual({
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }]
    });
  });

  it("selects a different entry on narrow with history push and collapsed sheet", () => {
    const roadmap = entry("roadmap.txt", { isFolder: false });

    expect(planEntrySelectionToggle({
      entry: roadmap,
      selectedEntryPath: "Projects",
      isNarrowScreen: true,
      mobileDetailsOpen: false
    })).toEqual({
      focused: [{ kind: "select", entry: roadmap }],
      chrome: [{ kind: "openMobileDetails", pushHistory: true }]
    });
  });

  it("selects a different entry on wide and closes mobile details", () => {
    const roadmap = entry("roadmap.txt", { isFolder: false });

    expect(planEntrySelectionToggle({
      entry: roadmap,
      selectedEntryPath: "Projects",
      isNarrowScreen: false,
      mobileDetailsOpen: true
    })).toEqual({
      focused: [{ kind: "select", entry: roadmap }],
      chrome: [{ kind: "closeMobileDetails" }]
    });
  });
});

describe("planBatchSelectionToggle", () => {
  it("uses search scope when search is active", () => {
    const item = entry("Projects/report.pdf");

    expect(planBatchSelectionToggle({
      entry: item,
      selectedEntryPath: undefined,
      wasBatchSelected: false,
      searchActive: true,
      currentPath: "Projects"
    }).batchToggle?.origin).toEqual({ kind: "search", scopePath: "Projects" });
  });

  it("uses browse scope when search is inactive", () => {
    expect(resolveBatchSelectionOrigin(false, "Projects")).toEqual({
      kind: "browse",
      folderPath: "Projects"
    });
  });

  it("clears focused selection when deselecting the currently focused batch item", () => {
    const item = entry("Projects/report.pdf");

    expect(planBatchSelectionToggle({
      entry: item,
      selectedEntryPath: "Projects/report.pdf",
      wasBatchSelected: true,
      searchActive: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }],
      batchToggle: {
        entry: item,
        origin: { kind: "browse", folderPath: "Projects" }
      }
    });
  });

  it("focuses a different entry and closes mobile details when adding to batch", () => {
    const item = entry("Projects/report.pdf");

    expect(planBatchSelectionToggle({
      entry: item,
      selectedEntryPath: "Projects",
      wasBatchSelected: false,
      searchActive: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [{ kind: "select", entry: item }],
      chrome: [{ kind: "closeMobileDetails" }],
      batchToggle: {
        entry: item,
        origin: { kind: "browse", folderPath: "Projects" }
      }
    });
  });

  it("only toggles batch membership when focused entry already matches", () => {
    const item = entry("Projects/report.pdf");

    expect(planBatchSelectionToggle({
      entry: item,
      selectedEntryPath: "Projects/report.pdf",
      wasBatchSelected: false,
      searchActive: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [],
      chrome: [],
      batchToggle: {
        entry: item,
        origin: { kind: "browse", folderPath: "Projects" }
      }
    });
  });
});

describe("planSelectAllEntries", () => {
  it("selects every entry with a browse origin without touching focused selection", () => {
    const entries = [entry("Projects/a.txt"), entry("Projects/Docs", { isFolder: true })];

    expect(planSelectAllEntries({
      entries,
      allSelected: false,
      selectedEntryPath: "Projects/a.txt",
      hasSelectedPreview: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [],
      chrome: [],
      batchSelectAll: {
        entries,
        origin: { kind: "browse", folderPath: "Projects" }
      }
    });
  });

  it("deselects the listed paths and clears a focused member when all are selected", () => {
    const entries = [entry("Projects/a.txt"), entry("Projects/b.txt")];

    expect(planSelectAllEntries({
      entries,
      allSelected: true,
      selectedEntryPath: "Projects/a.txt",
      hasSelectedPreview: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }],
      batchDeselectPaths: { paths: ["Projects/a.txt", "Projects/b.txt"] }
    });
  });

  it("keeps a focused selection outside the deselected paths", () => {
    const entries = [entry("Projects/a.txt")];

    expect(planSelectAllEntries({
      entries,
      allSelected: true,
      selectedEntryPath: "Other/focused.txt",
      hasSelectedPreview: false,
      currentPath: "Projects"
    })).toEqual({
      focused: [],
      chrome: [],
      batchDeselectPaths: { paths: ["Projects/a.txt"] }
    });
  });

  it("keeps the focused member while a selected preview is open", () => {
    const entries = [entry("Projects/a.txt")];

    expect(planSelectAllEntries({
      entries,
      allSelected: true,
      selectedEntryPath: "Projects/a.txt",
      hasSelectedPreview: true,
      currentPath: "Projects"
    })).toEqual({
      focused: [],
      chrome: [],
      batchDeselectPaths: { paths: ["Projects/a.txt"] }
    });
  });
});

describe("planClearBatchSelection", () => {
  it("clears batch and focused entry when preview is absent", () => {
    expect(planClearBatchSelection({
      hasSelectedEntry: true,
      hasSelectedPreview: false
    })).toEqual({
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }],
      batchClear: true
    });
  });

  it("clears batch only when preview-backed selection exists", () => {
    expect(planClearBatchSelection({
      hasSelectedEntry: true,
      hasSelectedPreview: true
    })).toEqual({
      focused: [],
      chrome: [],
      batchClear: true
    });
  });
});
