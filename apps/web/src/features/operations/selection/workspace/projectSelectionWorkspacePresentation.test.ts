import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { buildFileEntry, buildFilePreview } from "../../../../test/files";
import type {
  SelectionWorkspacePresentationInput,
  SelectionActionCapabilities
} from "./ports";
import { projectSelectionWorkspacePresentation } from "./projectSelectionWorkspacePresentation";

function batchSummary(overrides: Partial<SelectionWorkspacePresentationInput["selection"]["batchSummary"]> = {}) {
  return {
    count: 0,
    fileCount: 0,
    folderCount: 0,
    knownFileSizeBytes: 0,
    unknownSizeCount: 0,
    ...overrides
  };
}

function capabilities(overrides: Partial<SelectionActionCapabilities> = {}): SelectionActionCapabilities {
  return {
    canDownloadSelected: true,
    canSyncSelectedOffline: true,
    canMoveSelected: true,
    canCopySelected: true,
    canDeleteSelected: true,
    canDownloadBatchSelection: true,
    canSyncBatchOffline: true,
    canCopyMoveBatchSelection: true,
    canDeleteBatchSelection: true,
    ...overrides
  };
}

function buildInput(
  overrides: Partial<SelectionWorkspacePresentationInput> = {}
): SelectionWorkspacePresentationInput {
  const commands = {
    clearFocused: vi.fn(),
    clearBatch: vi.fn(),
    showMobileActions: vi.fn(),
    showMobileDetails: vi.fn(),
    closeMobileDetails: vi.fn(),
    navigateToFolder: vi.fn(),
    openFile: vi.fn(),
    downloadFocused: vi.fn(),
    downloadBatch: vi.fn(),
    keepOfflineFocused: vi.fn(),
    keepOfflineBatch: vi.fn(),
    renameFocused: vi.fn(),
    copyMoveFocused: vi.fn(),
    copyMoveBatch: vi.fn(),
    deleteFocused: vi.fn(),
    deleteBatch: vi.fn()
  };
  return {
    selection: {
      focusedEntry: undefined,
      focusedMobileSubview: "actions",
      batchSummary: batchSummary(),
      isBatchSelected: () => false
    },
    preview: { selected: undefined },
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
    view: {
      fileSizeDisplayMode: "human",
      isNarrowScreen: false,
      mobileDetailsOpen: false,
      mutationBusy: false
    },
    capabilities: capabilities(),
    favourite: { selected: false, toggle: vi.fn() },
    commands,
    ...overrides
  };
}

describe("projectSelectionWorkspacePresentation", () => {
  it("projects raw selection, preview, workspace, and viewport input into the stage bundle", () => {
    const entry = buildFileEntry("Projects/report.pdf", {
      mimeType: "application/pdf",
      size: 1024
    });
    const input = buildInput({
      selection: {
        focusedEntry: entry,
        focusedMobileSubview: "details",
        batchSummary: batchSummary({ count: 2, fileCount: 2, knownFileSizeBytes: 1024 }),
        isBatchSelected: (path) => path === entry.path
      },
      preview: { selected: buildFilePreview(entry.path, { viewer: "pdf" }) },
      view: {
        fileSizeDisplayMode: "human",
        isNarrowScreen: true,
        mobileDetailsOpen: true,
        mutationBusy: true
      },
      favourite: { selected: true, toggle: vi.fn() },
      capabilities: capabilities({ canDeleteBatchSelection: false })
    });

    const result = projectSelectionWorkspacePresentation(input);

    expect(result.selectionModeActive).toBe(true);
    expect(result.selectionSummaryLabel).toBe("2 items selected (2 files)");
    expect(result.selectedDetails).toBeUndefined();
    expect(result.selectedFilePath).toBeUndefined();
    expect(result.showDetailsRail).toBe(true);
    expect(result.showMobileSelectionSheet).toBe(false);
    expect(result.showMobileBatchBar).toBe(true);
    expect(result.favouriteActionLabel).toBe("Remove from Favourites");
    expect(result.detailsStage).toMatchObject({
      visible: true,
      content: { kind: "batch" },
      showMobileBatchBar: true,
      showMobileSelectionSheet: false,
      mobileSheetDetailsExpanded: true,
      offline: false,
      mutationBusy: true,
      selectedIsFavourite: true,
      selectedFavouriteActionLabel: "Remove from Favourites",
      canDeleteBatchSelection: false
    });
  });

  it("keeps desktop surfaces closed for an empty workspace and forwards each capability independently", () => {
    const entry = buildFileEntry("Projects/report.pdf");
    const mixedCapabilities = capabilities({
      canDownloadSelected: true,
      canSyncSelectedOffline: false,
      canMoveSelected: true,
      canCopySelected: false,
      canDeleteSelected: true,
      canDownloadBatchSelection: false,
      canSyncBatchOffline: true,
      canCopyMoveBatchSelection: false,
      canDeleteBatchSelection: true
    });
    const favouriteToggle = vi.fn();
    const emptyResult = projectSelectionWorkspacePresentation(buildInput({
      favourite: { selected: false, toggle: favouriteToggle },
      view: { fileSizeDisplayMode: "human", isNarrowScreen: false, mobileDetailsOpen: true, mutationBusy: false }
    }));

    expect(emptyResult.showDetailsRail).toBe(false);
    expect(emptyResult.showMobileSelectionSheet).toBe(false);
    expect(emptyResult.showMobileBatchBar).toBe(false);
    emptyResult.detailsStage.onToggleFavourite();
    expect(favouriteToggle).not.toHaveBeenCalled();

    const result = projectSelectionWorkspacePresentation(buildInput({
      selection: {
        focusedEntry: entry,
        focusedMobileSubview: "actions",
        batchSummary: batchSummary(),
        isBatchSelected: () => false
      },
      capabilities: mixedCapabilities,
      view: { fileSizeDisplayMode: "human", isNarrowScreen: false, mobileDetailsOpen: false, mutationBusy: false }
    }));

    expect(result.showDetailsRail).toBe(true);
    expect(result.showMobileSelectionSheet).toBe(false);
    expect(result.showMobileBatchBar).toBe(false);
    expect(result.detailsStage).toMatchObject(mixedCapabilities);
  });

  it("routes focused, batch, favourite, and mobile commands without requiring an App-shaped content object", () => {
    const calls: string[] = [];
    const entry = buildFileEntry("Projects/report.pdf");
    const commands = {
      clearFocused: vi.fn(() => calls.push("clear-focused")),
      clearBatch: vi.fn(() => calls.push("clear-batch")),
      showMobileActions: vi.fn(() => calls.push("mobile-actions")),
      showMobileDetails: vi.fn(() => calls.push("mobile-details")),
      closeMobileDetails: vi.fn(() => calls.push("close-mobile-details")),
      navigateToFolder: vi.fn(() => calls.push("navigate-folder")),
      openFile: vi.fn(() => calls.push("open-file")),
      downloadFocused: vi.fn(() => calls.push("download-focused")),
      downloadBatch: vi.fn(() => calls.push("download-batch")),
      keepOfflineFocused: vi.fn(() => calls.push("keep-offline-focused")),
      keepOfflineBatch: vi.fn(() => calls.push("keep-offline-batch")),
      renameFocused: vi.fn(() => calls.push("rename-focused")),
      copyMoveFocused: vi.fn(() => calls.push("copy-move-focused")),
      copyMoveBatch: vi.fn(() => calls.push("copy-move-batch")),
      deleteFocused: vi.fn(() => calls.push("delete-focused")),
      deleteBatch: vi.fn(() => calls.push("delete-batch"))
    };
    const input = buildInput({
      selection: {
        focusedEntry: entry,
        focusedMobileSubview: "actions",
        batchSummary: batchSummary(),
        isBatchSelected: () => false
      },
      view: { fileSizeDisplayMode: "human", isNarrowScreen: true, mobileDetailsOpen: true, mutationBusy: false },
      commands,
      favourite: { selected: false, toggle: vi.fn((_selectedEntry) => calls.push("favourite")) }
    });
    const result = projectSelectionWorkspacePresentation(input);

    expect(result.selectedDetails).toBe(entry);
    expect(result.selectedFilePath).toBe("Projects/report.pdf");
    expect(result.showDetailsRail).toBe(true);
    expect(result.showMobileSelectionSheet).toBe(true);
    expect(result.showMobileBatchBar).toBe(false);
    result.detailsStage.onOpenSelected();
    result.detailsStage.onDownloadSelected();
    result.detailsStage.onKeepOfflineSelected();
    result.detailsStage.onToggleFavourite();
    result.detailsStage.onToggleMobileSheetDetails();
    result.detailsStage.onRenameSelected();
    result.detailsStage.onCopyMoveSelected();
    result.detailsStage.onDeleteSelected();
    result.detailsStage.onCloseMobileSelectionSheet();

    expect(commands.openFile).toHaveBeenCalledWith(entry);
    expect(input.favourite.toggle).toHaveBeenCalledWith(entry);
    expect(commands.downloadFocused).toHaveBeenCalledWith("Projects/report.pdf", "/Projects/report.pdf");
    expect(commands.keepOfflineFocused).toHaveBeenCalledWith(entry);
    expect(calls).toEqual([
      "open-file",
      "download-focused",
      "keep-offline-focused",
      "favourite",
      "mobile-details",
      "rename-focused",
      "copy-move-focused",
      "delete-focused",
      "clear-focused",
      "close-mobile-details",
      "mobile-actions"
    ]);

    const batchResult = projectSelectionWorkspacePresentation(buildInput({
      selection: {
        focusedEntry: entry,
        focusedMobileSubview: "details",
        batchSummary: batchSummary({ count: 1, fileCount: 1 }),
        isBatchSelected: () => true
      },
      commands,
      view: { fileSizeDisplayMode: "human", isNarrowScreen: false, mobileDetailsOpen: false, mutationBusy: false }
    }));
    batchResult.detailsStage.onDownloadBatchSelection();
    batchResult.detailsStage.onKeepOfflineBatchSelection();
    batchResult.detailsStage.onCopyMoveBatchSelection();
    batchResult.detailsStage.onDeleteBatchSelection();
    batchResult.detailsStage.onClearBatchSelection();

    expect(calls.slice(-5)).toEqual([
      "download-batch",
      "keep-offline-batch",
      "copy-move-batch",
      "delete-batch",
      "clear-batch"
    ]);
    expect(commands.copyMoveBatch).toHaveBeenCalledWith();
    expect(commands.deleteBatch).toHaveBeenCalledWith();
  });

  it("opens folders through navigation and forwards runtime/capability state", () => {
    const folder: FileEntry = buildFileEntry("Projects/Plans", { isFolder: true, mimeType: undefined });
    const input = buildInput({
      selection: {
        focusedEntry: folder,
        focusedMobileSubview: "details",
        batchSummary: batchSummary(),
        isBatchSelected: () => false
      },
      workspace: {
        folderLabel: "Plans",
        locationLabel: "/Projects/Plans",
        visibleItemCount: 0,
        searchActive: true,
        searchQuery: "draft",
        explicitOfflineMode: true,
        offline: true,
        workerUnavailable: true,
        folderCachedAt: "2026-01-01T00:00:00.000Z"
      },
      view: { fileSizeDisplayMode: "human", isNarrowScreen: true, mobileDetailsOpen: true, mutationBusy: true },
      capabilities: capabilities({ canMoveSelected: false }),
      formatters: { formatCacheTimestamp: () => "formatted" }
    });

    const result = projectSelectionWorkspacePresentation(input);
    result.detailsStage.onOpenSelected();

    expect(input.commands.navigateToFolder).toHaveBeenCalledWith(folder.path);
    expect(input.commands.openFile).not.toHaveBeenCalled();
    expect(result.selectedDetails).toBe(folder);
    expect(result.selectedFilePath).toBeUndefined();
    expect(result.showMobileSelectionSheet).toBe(true);
    expect(result.showMobileBatchBar).toBe(false);
    expect(result.detailsStage).toMatchObject({
      content: { kind: "single" },
      offline: true,
      mutationBusy: true,
      canMoveSelected: false
    });
  });
});
