import { describe, expect, it } from "vitest";

import type { FileEntry, FilePreview } from "@davora/shared";

import { viewerHeading } from "../../preview/shell";

import {
  buildBatchSelectionSizeLabel,
  buildSelectionDetailsContent,
  buildWorkspaceModeLabel,
  buildWorkspaceStaleInfo,
  resolveMatchedSelectedPreview,
  resolveSelectedDetails,
  resolveSelectedTypeLabel
} from "./presentation";
import type { BatchSelectionSummary } from "./selectors";

const testFormatters = {
  formatCacheTimestamp: (value: string) => `at-${value}`
};

function fileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "Projects/report.pdf",
    name: "report.pdf",
    isFolder: false,
    size: 2_621_440,
    lastModified: "2026-01-01T12:00:00.000Z",
    mimeType: "application/pdf",
    ...overrides
  };
}

function filePreview(overrides: Partial<FilePreview> = {}): FilePreview {
  return {
    ...fileEntry(),
    viewer: "pdf",
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    ...overrides
  };
}

function batchSummary(overrides: Partial<BatchSelectionSummary> = {}): BatchSelectionSummary {
  return {
    count: 0,
    fileCount: 0,
    folderCount: 0,
    knownFileSizeBytes: 0,
    unknownSizeCount: 0,
    ...overrides
  };
}

function buildContentInput(overrides: Partial<Parameters<typeof buildSelectionDetailsContent>[0]> = {}) {
  return {
    selectedEntry: undefined,
    selected: undefined,
    batchSelectionCount: 0,
    batchSelectionSummary: batchSummary(),
    isPathInBatchSelection: () => false,
    hasSelectedEntry: false,
    fileSizeDisplayMode: "human" as const,
    workspace: {
      folderLabel: "Plans",
      locationLabel: "/Projects/Plans",
      visibleItemCount: 5,
      searchActive: false,
      searchQuery: "",
      explicitOfflineMode: false,
      offline: false,
      workerUnavailable: false,
      folderCachedAt: undefined
    },
    formatters: testFormatters,
    ...overrides
  };
}

describe("resolveMatchedSelectedPreview", () => {
  it("returns preview only when entry paths match", () => {
    const entry = fileEntry();
    const preview = filePreview();
    expect(resolveMatchedSelectedPreview(entry, preview)).toBe(preview);
    expect(resolveMatchedSelectedPreview(entry, filePreview({ path: "Other/path.pdf" }))).toBeUndefined();
    expect(resolveMatchedSelectedPreview(undefined, preview)).toBeUndefined();
  });
});

describe("resolveSelectedDetails", () => {
  it("suppresses single-item details while batch mode is active", () => {
    const entry = fileEntry();
    expect(resolveSelectedDetails(2, entry, undefined)).toBeUndefined();
  });

  it("prefers preview-backed selected over bare selectedEntry", () => {
    const entry = fileEntry({ mimeType: "application/octet-stream" });
    const preview = filePreview({ viewer: "pdf", mimeType: "application/pdf" });
    expect(resolveSelectedDetails(0, entry, preview)).toBe(preview);
  });

  it("falls back to selectedEntry when preview is absent or mismatched", () => {
    const entry = fileEntry();
    expect(resolveSelectedDetails(0, entry, undefined)).toBe(entry);
    expect(resolveSelectedDetails(0, entry, filePreview({ path: "Other/path.pdf" }))).toBe(entry);
  });
});

describe("resolveSelectedTypeLabel", () => {
  it.each([
    [true, undefined, "application/pdf", "Folder"],
    [false, "pdf" as const, "application/pdf", viewerHeading("pdf").replace(" preview", "")],
    [false, undefined, "text/plain", "text/plain"],
    [false, undefined, undefined, "File"]
  ] as const)("maps folder=%s viewer=%s mime=%s to %s", (isFolder, viewer, mimeType, expected) => {
    const entry = fileEntry({ isFolder, mimeType });
    const preview = viewer ? filePreview({ viewer, mimeType }) : undefined;
    expect(resolveSelectedTypeLabel(entry, preview)).toBe(expected);
  });
});

describe("buildBatchSelectionSizeLabel", () => {
  it("joins known and unknown size copy", () => {
    expect(buildBatchSelectionSizeLabel(batchSummary({
      knownFileSizeBytes: 1_048_576,
      unknownSizeCount: 2
    }), "human")).toBe("1 MB known; 2 items unknown or folder-sized");
  });

  it("uses fallback copy when no sizes are known", () => {
    expect(buildBatchSelectionSizeLabel(batchSummary(), "human")).toBe("No known file size");
  });
});

describe("buildWorkspaceModeLabel", () => {
  it.each([
    [{ explicitOfflineMode: true, offline: false, workerUnavailable: false }, "Offline mode"],
    [{ explicitOfflineMode: false, offline: true, workerUnavailable: false }, "Offline"],
    [{ explicitOfflineMode: false, offline: false, workerUnavailable: true }, "Server unavailable"],
    [{ explicitOfflineMode: false, offline: false, workerUnavailable: false }, "Online"]
  ] as const)("maps %j to %s", (input, expected) => {
    expect(buildWorkspaceModeLabel(input)).toBe(expected);
  });
});

describe("buildWorkspaceStaleInfo", () => {
  it("omits stale info in explicit offline mode or without cache timestamp", () => {
    expect(buildWorkspaceStaleInfo(true, "2026-01-01T00:00:00.000Z", testFormatters)).toBeUndefined();
    expect(buildWorkspaceStaleInfo(false, undefined, testFormatters)).toBeUndefined();
  });

  it("prefixes formatted cache timestamp", () => {
    expect(buildWorkspaceStaleInfo(false, "2026-01-01T00:00:00.000Z", testFormatters))
      .toBe("Cached at-2026-01-01T00:00:00.000Z");
  });
});

describe("buildSelectionDetailsContent", () => {
  it("builds single-item details with metadata, inclusion, and aria", () => {
    const entry = fileEntry();
    const content = buildSelectionDetailsContent(buildContentInput({
      selectedEntry: entry,
      hasSelectedEntry: true,
      isPathInBatchSelection: () => true
    }));

    expect(content).toEqual({
      kind: "single",
      item: {
        name: "report.pdf",
        displayPath: "/Projects/report.pdf",
        typeLabel: "application/pdf",
        modifiedLabel: "Jan 1, 2026, 12:00",
        sizeLabel: "2.5 MB",
        includedInSelection: true,
        isFolder: false,
        canOpen: true,
        panelHeading: "Selected file",
        ariaLabel: "Details for report.pdf"
      }
    });
  });

  it("uses preview viewer heading for type label when preview matches", () => {
    const entry = fileEntry({ mimeType: "application/octet-stream" });
    const preview = filePreview({ viewer: "pdf", mimeType: "application/pdf" });
    const content = buildSelectionDetailsContent(buildContentInput({
      selectedEntry: entry,
      selected: preview,
      hasSelectedEntry: true
    }));

    expect(content.kind).toBe("single");
    if (content.kind === "single") {
      expect(content.item.typeLabel).toBe("PDF");
    }
  });

  it("builds batch summary content when batch mode is active", () => {
    const content = buildSelectionDetailsContent(buildContentInput({
      selectedEntry: fileEntry(),
      batchSelectionCount: 3,
      batchSelectionSummary: batchSummary({
        count: 3,
        fileCount: 2,
        folderCount: 1,
        knownFileSizeBytes: 4_194_304,
        unknownSizeCount: 1
      })
    }));

    expect(content).toEqual({
      kind: "batch",
      batch: {
        count: 3,
        countLabel: "3 items selected",
        selectionLabel: "2 files and 1 folder",
        fileCount: 2,
        folderCount: 1,
        sizeLabel: "4 MB known; 1 item unknown or folder-sized",
        ariaLabel: "Selection details for 3 items"
      }
    });
  });

  it("builds workspace fallback with browse and search labels", () => {
    const browseContent = buildSelectionDetailsContent(buildContentInput({
      workspace: {
        folderLabel: "Plans",
        locationLabel: "/Projects/Plans",
        visibleItemCount: 5,
        searchActive: false,
        searchQuery: "",
        explicitOfflineMode: false,
        offline: false,
        workerUnavailable: false,
        folderCachedAt: "2026-01-01T00:00:00.000Z"
      }
    }));

    expect(browseContent).toEqual({
      kind: "workspace",
      workspace: {
        folderLabel: "Plans",
        locationLabel: "/Projects/Plans",
        itemsLabel: "5 items",
        itemsHeading: "Items",
        searchActive: false,
        searchQuery: "",
        modeLabel: "Online",
        staleInfo: "Cached at-2026-01-01T00:00:00.000Z"
      }
    });

    const searchContent = buildSelectionDetailsContent(buildContentInput({
      workspace: {
        folderLabel: "Plans",
        locationLabel: "/Projects/Plans",
        visibleItemCount: 2,
        searchActive: true,
        searchQuery: "  budget  ",
        explicitOfflineMode: true,
        offline: true,
        workerUnavailable: false,
        folderCachedAt: "2026-01-01T00:00:00.000Z"
      }
    }));

    expect(searchContent).toEqual({
      kind: "workspace",
      workspace: {
        folderLabel: "Plans",
        locationLabel: "/Projects/Plans",
        itemsLabel: "2 results",
        itemsHeading: "Results",
        searchActive: true,
        searchQuery: "budget",
        modeLabel: "Offline mode",
        staleInfo: undefined
      }
    });
  });
});
