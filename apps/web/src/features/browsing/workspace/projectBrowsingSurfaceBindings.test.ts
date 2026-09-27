import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { projectBrowsingSurfaceBindings, type BrowsingSurfaceInput } from "./projectBrowsingSurfaceBindings";

const folder: FileEntry = { path: "Projects", name: "Projects", isFolder: true };
const file: FileEntry = { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false };

function buildInput(): BrowsingSurfaceInput {
  const navigateToPath = vi.fn();
  const openFile = vi.fn();
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
        }
      },
      operation: {
        capabilities: { canCreateFolder: true, canUploadFiles: true, canUploadFolders: true, canMarkForBatchDownload: true },
        mutation: { state: { busy: false } },
        commands: { openCreateFolder: vi.fn() },
        upload: { uploadFiles: vi.fn(), drop: { active: false, onDragEnter: vi.fn(), onDragLeave: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn() } }
      },
      offline: { explicitOfflineMode: false, isItemAvailableOffline: () => false },
      navigation: { getCurrentPath: () => "", navigateToPath },
      settings: { preferences: { fileSizeDisplayMode: "human" }, commands: { handleFileSizeDisplayModeChange: vi.fn() } },
      status: { message: "Ready" },
      pullToRefresh: { fileListRef: vi.fn() },
      viewport: { isNarrowScreen: false }
    },
    ports: {
      directoryUploadInputRef: vi.fn(), loadFolder: vi.fn(), openFile
    }
  };
}

describe("projectBrowsingSurfaceBindings", () => {
  it("projects complete stage bindings from owner outputs", () => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings(input);
    expect(projected.fileList.props.items).toBe(input.owners.browse.list.items);
    expect(projected.fileList.props.getItemSubtitle(file)).toBe("/Projects");
    expect(projected.fileList.props.breadcrumbs).toBe(input.owners.browse.presentation.breadcrumbs);
    expect(projected.fileList.props.currentPath).toBe(input.owners.browse.context.path);
    expect(projected.fileList.props.onNavigateToPath).toBe(input.owners.navigation.navigateToPath);
    expect(projected.fileList.ref).toBe(input.owners.pullToRefresh.fileListRef);
  });

  it.each([
    { isNarrowScreen: true, showBreadcrumbs: true, expected: true },
    { isNarrowScreen: true, showBreadcrumbs: false, expected: false },
    { isNarrowScreen: false, showBreadcrumbs: true, expected: false },
    { isNarrowScreen: false, showBreadcrumbs: false, expected: false }
  ])("gates in-list breadcrumbs to narrow viewports inside folders (%j)", ({ isNarrowScreen, showBreadcrumbs, expected }) => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings({
      ...input,
      owners: {
        ...input.owners,
        browse: {
          ...input.owners.browse,
          presentation: { ...input.owners.browse.presentation, showBreadcrumbs }
        },
        viewport: { isNarrowScreen }
      }
    });
    expect(projected.fileList.props.showBreadcrumbs).toBe(expected);
  });

  it("forwards Header mutation commands by identity without adding arguments or effects", () => {
    const input = buildInput();
    const createFolder = vi.fn();
    const customizedInput: BrowsingSurfaceInput = {
      ...input,
      owners: {
        ...input.owners,
        operation: {
          ...input.owners.operation,
          commands: { openCreateFolder: createFolder }
        }
      }
    };

    const projected = projectBrowsingSurfaceBindings(customizedInput);

    expect(projected.browseHeader.onCreateFolder).toBe(createFolder);
    expect(projected.browseHeader.onCreateFolder()).toBeUndefined();
    expect(createFolder).toHaveBeenCalledWith();
  });

  it("routes folders to navigation and files to the open-file port", () => {
    const input = buildInput();
    const projected = projectBrowsingSurfaceBindings(input);
    projected.fileList.props.onRowOpenClick(folder);
    projected.fileList.props.onRowOpenClick(file);
    expect(input.owners.navigation.navigateToPath).toHaveBeenCalledWith("Projects");
    expect(input.ports.openFile).toHaveBeenCalledWith(file);
  });
});
