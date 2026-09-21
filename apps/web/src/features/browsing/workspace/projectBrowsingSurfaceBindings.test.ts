import { parseNormalizedPath, type FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { projectBrowsingSurfaceBindings, type BrowsingSurfaceInput } from "./projectBrowsingSurfaceBindings";

const folder: FileEntry = { path: "Projects", name: "Projects", isFolder: true };
const file: FileEntry = { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false };
const archiveInputFixture = { roots: [{ entry: file, archiveRoot: "roadmap.txt" }], archiveLabel: "selected-files.zip" };
const captureFixture = {
  accountId: "alpha",
  memberships: [{ identity: { accountId: "alpha", path: parseNormalizedPath(file.path) }, membershipVersion: 7 }]
};

function buildInput(): BrowsingSurfaceInput {
  const navigateToPath = vi.fn();
  const openFile = vi.fn();
  const capture = vi.fn(() => captureFixture);
  return {
    owners: {
      browse: {
        context: { path: "" },
        mode: { cacheOnly: false },
        query: { raw: "road", active: true, set: vi.fn(), clear: vi.fn() },
        folder: { refreshing: false, stale: false },
        list: { items: [folder, file] },
        presentation: {
          breadcrumbs: [], browseStatusLabel: "2 items", folderLabel: "All files", locationLabel: "/", folderCachedAt: undefined,
          empty: { emptyStatus: "Location: /", emptyTitle: "This folder is empty.", listRecoveryAvailable: false, showEmptyState: false }, showBreadcrumbs: false
        },
        sort: {
          mode: "name-asc",
          select: vi.fn(),
          reset: { confirming: false, count: 0, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }
        }
      },
      selection: {
        fileList: {
          batchModeActive: false, selectionModeActive: false, selectAllState: "none", canSelectAll: false, canDeselectAll: false, onToggleSelectAll: vi.fn(), isItemBatchSelected: () => false, isItemSelected: () => false,
          clearRowOpenSuppression: vi.fn(), getRowOpenSuppressed: () => false, onRowPointerCancel: vi.fn(), onRowPointerDown: vi.fn(), onRowPointerLeave: vi.fn(), onRowPointerUp: vi.fn(), onToggleBatchSelection: vi.fn(), onToggleEntrySelection: vi.fn(), suppressNarrowScreenContextMenu: false
        },
        presentation: { selectionSummaryLabel: "2 items selected" }, interaction: { clearBatchSelection: vi.fn() },
        batch: { entries: [file], archiveInput: archiveInputFixture, capture }
      },
      operation: {
        capabilities: { canCopyMoveBatchSelection: true, canCreateFolder: true, canDeleteBatchSelection: true, canDownloadBatchSelection: true, canSyncBatchOffline: true, canUploadFiles: true, canUploadFolders: true, canMarkForBatchDownload: true },
        mutation: { state: { busy: false } },
        commands: { openCreateFolder: vi.fn(), openDeleteSelection: vi.fn(), openCopyMoveSelection: vi.fn() },
        download: { downloadBatch: vi.fn() },
        upload: { uploadFiles: vi.fn(), drop: { active: false, onDragEnter: vi.fn(), onDragLeave: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn() } }
      },
      offline: { explicitOfflineMode: false, isItemAvailableOffline: () => false },
      navigation: { getCurrentPath: () => "", navigateToPath },
      settings: { preferences: { fileSizeDisplayMode: "human" }, commands: { handleFileSizeDisplayModeChange: vi.fn() } },
      status: { message: "Ready" },
      pullToRefresh: { fileListRef: vi.fn() }
    },
    ports: {
      directoryUploadInputRef: vi.fn(), loadFolder: vi.fn(), openFile, openOfflineSync: vi.fn()
    }
  };
}

describe("projectBrowsingSurfaceBindings", () => {
  it("projects complete stage bindings from owner outputs", () => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings(input);
    expect(projected.browseHeader.selectionSummaryLabel).toBe("2 items selected");
    expect(projected.fileList.props.items).toBe(input.owners.browse.list.items);
    expect(projected.fileList.props.getItemSubtitle(file)).toBe("/Projects");
    expect(projected.fileList.ref).toBe(input.owners.pullToRefresh.fileListRef);
  });

  it("forwards Header mutation commands by identity without adding arguments or effects", () => {
    const input = buildInput();
    const copyMove = vi.fn();
    const deleteSelection = vi.fn();
    const customizedInput: BrowsingSurfaceInput = {
      ...input,
      owners: {
        ...input.owners,
        operation: {
          ...input.owners.operation,
          commands: {
            ...input.owners.operation.commands,
            openCopyMoveSelection: copyMove,
            openDeleteSelection: deleteSelection
          }
        }
      }
    };

    const projected = projectBrowsingSurfaceBindings(customizedInput);

    expect(projected.browseHeader.onCopyMoveSelection).toBe(copyMove);
    expect(projected.browseHeader.onDeleteSelection).toBe(deleteSelection);
    expect(projected.browseHeader.onCopyMoveSelection()).toBeUndefined();
    expect(projected.browseHeader.onDeleteSelection()).toBeUndefined();
    expect(copyMove).toHaveBeenCalledWith();
    expect(deleteSelection).toHaveBeenCalledWith();
  });

  it("routes folders to navigation and files to the open-file port", () => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings(input);
    projected.fileList.props.onRowOpenClick(folder);
    projected.fileList.props.onRowOpenClick(file);
    expect(input.owners.navigation.navigateToPath).toHaveBeenCalledWith("Projects");
    expect(input.ports.openFile).toHaveBeenCalledWith(file);
  });

  it("forwards the current batch capture through keep-offline exactly once", () => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings(input);
    projected.browseHeader.onKeepOfflineSelection();
    expect(input.owners.selection.batch.capture).toHaveBeenCalledTimes(1);
    const openOfflineSync = vi.mocked(input.ports.openOfflineSync);
    expect(openOfflineSync).toHaveBeenCalledTimes(1);
    const [entries, archiveInput, capture] = openOfflineSync.mock.calls[0] ?? [];
    expect(entries).toBe(input.owners.selection.batch.entries);
    expect(archiveInput).toBe(archiveInputFixture);
    expect(capture).toBe(captureFixture);
  });
});
