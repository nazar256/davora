import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { FileListStage } from "./FileListStage";

const PROJECTS_FOLDER: FileEntry = {
  path: "Projects",
  name: "Projects",
  isFolder: true,
  lastModified: "2026-06-01T12:00:00.000Z",
  size: 0
};

const ROADMAP_FILE: FileEntry = {
  path: "Projects/roadmap.txt",
  name: "roadmap.txt",
  isFolder: false,
  lastModified: "2026-06-02T08:30:00.000Z",
  size: 4096,
  mimeType: "text/plain"
};

function buildProps(overrides: Partial<ComponentProps<typeof FileListStage>> = {}) {
  return {
    items: [PROJECTS_FOLDER, ROADMAP_FILE],
    folderDropActive: false,
    batchModeActive: false,
    showEmptyState: false,
    emptyTitle: "",
    emptyStatus: "",
    showClearSearchButton: false,
    showRetryFolderButton: false,
    canMarkForBatchDownload: true,
    selectionModeActive: false,
    selectAllState: "none" as const,
    canSelectAll: true,
    canDeselectAll: false,
    onToggleSelectAll: vi.fn(),
    fileSizeDisplayMode: "human" as const,
    suppressNarrowScreenContextMenu: false,
    isItemBatchSelected: () => false,
    isItemSelected: () => false,
    isItemAvailableOffline: () => false,
    getItemSubtitle: () => undefined,
    onClearSearch: vi.fn(),
    onRetryFolder: vi.fn(),
    onToggleBatchSelection: vi.fn(),
    onRowOpenClick: vi.fn(),
    getRowOpenSuppressed: () => false,
    clearRowOpenSuppression: vi.fn(),
    onToggleEntrySelection: vi.fn(),
    onRowPointerDown: vi.fn(),
    onRowPointerCancel: vi.fn(),
    onRowPointerLeave: vi.fn(),
    onRowPointerUp: vi.fn(),
    onDragEnter: vi.fn(),
    onDragLeave: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    ...overrides
  };
}

describe("FileListStage", () => {
  afterEach(cleanup);

  it("forwards the public scroll-panel ref and clears it on unmount", () => {
    const ref = createRef<HTMLElement>();
    const { unmount } = render(<FileListStage {...buildProps()} ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current).toHaveClass("file-list-panel");

    unmount();
    expect(ref.current).toBeNull();
  });

  it("does not render empty state while initial folder load is gated off", () => {
    render(
      <FileListStage
        {...buildProps({
          items: [],
          showEmptyState: false
        })}
      />
    );

    expect(document.querySelector(".empty-state")).toBeNull();
  });

  it.each([
    {
      label: "search empty",
      props: {
        items: [],
        showEmptyState: true,
        emptyTitle: "No files match this search yet.",
        emptyStatus: "Search scope: /Projects",
        showClearSearchButton: true
      },
      title: /No files match this search yet/i,
      status: /Search scope: \/Projects/i,
      action: { name: /Clear search/i, handler: "onClearSearch" as const }
    },
    {
      label: "folder empty",
      props: {
        items: [],
        showEmptyState: true,
        emptyTitle: "This folder is empty.",
        emptyStatus: "Location: /",
        showClearSearchButton: false
      },
      title: /This folder is empty/i,
      status: /Location: \/$/i,
      action: null
    },
    {
      label: "search load error",
      props: {
        items: [],
        showEmptyState: true,
        emptyTitle: "Unable to load search results.",
        emptyStatus: "Network error",
        showClearSearchButton: true
      },
      title: /Unable to load search results/i,
      status: /Network error/i,
      action: { name: /Clear search/i, handler: "onClearSearch" as const }
    },
    {
      label: "folder load error with retry",
      props: {
        items: [],
        showEmptyState: true,
        emptyTitle: "Unable to load this folder.",
        emptyStatus: "Network error",
        showRetryFolderButton: true
      },
      title: /Unable to load this folder/i,
      status: /Network error/i,
      action: { name: /Retry folder/i, handler: "onRetryFolder" as const }
    }
  ])("renders $label copy and actions", ({ props, title, status, action }) => {
    const handlers = {
      onClearSearch: vi.fn(),
      onRetryFolder: vi.fn()
    };
    render(<FileListStage {...buildProps({ ...props, ...handlers })} />);

    const emptyState = document.querySelector(".empty-state");
    expect(emptyState).toBeInstanceOf(HTMLElement);
    if (!(emptyState instanceof HTMLElement)) {
      return;
    }
    expect(within(emptyState).getByText(title)).toBeInTheDocument();
    expect(within(emptyState).getByText(status)).toBeInTheDocument();

    if (action) {
      fireEvent.click(screen.getByRole("button", { name: action.name }));
      expect(handlers[action.handler]).toHaveBeenCalledTimes(1);
    }
  });

  it("shows search subtitle and offline marker from props", () => {
    render(
      <FileListStage
        {...buildProps({
          getItemSubtitle: (item) => (item.path === ROADMAP_FILE.path ? "/Projects" : undefined),
          isItemAvailableOffline: (item) => item.path === ROADMAP_FILE.path
        })}
      />
    );

    const roadmapRow = screen.getByRole("button", { name: /Open file roadmap.txt/i }).closest(".item-row");
    expect(roadmapRow).toBeInstanceOf(HTMLElement);
    if (!(roadmapRow instanceof HTMLElement)) {
      return;
    }
    expect(within(roadmapRow).getByText("/Projects")).toHaveClass("item-subtitle");
    expect(within(roadmapRow).getByLabelText(/roadmap.txt is available offline/i)).toBeInTheDocument();
  });

  it("projects selected and batch-selected classes from props", () => {
    render(
      <FileListStage
        {...buildProps({
          isItemSelected: (item) => item.path === PROJECTS_FOLDER.path,
          isItemBatchSelected: (item) => item.path === ROADMAP_FILE.path,
          batchModeActive: true
        })}
      />
    );

    const projectsRow = screen.getByRole("button", { name: /Open folder Projects/i }).closest(".item-row");
    const roadmapRow = screen.getByRole("button", { name: /Open file roadmap.txt/i }).closest(".item-row");
    expect(projectsRow?.className).toContain("selected");
    expect(roadmapRow?.className).toContain("batch-selected");
    expect(document.querySelector(".file-list-panel")?.className).toContain("batch-download-mode");
  });

  it("routes primary row clicks to batch toggle while selection mode is active", () => {
    const onToggleBatchSelection = vi.fn();
    const onRowOpenClick = vi.fn();
    render(
      <FileListStage
        {...buildProps({
          selectionModeActive: true,
          onToggleBatchSelection,
          onRowOpenClick
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Select Projects folder/i }));
    expect(onToggleBatchSelection).toHaveBeenCalledWith(PROJECTS_FOLDER);
    expect(onRowOpenClick).not.toHaveBeenCalled();
  });

  it("suppresses row open when long-press handling is active", () => {
    const onRowOpenClick = vi.fn();
    const clearRowOpenSuppression = vi.fn();
    render(
      <FileListStage
        {...buildProps({
          getRowOpenSuppressed: () => true,
          clearRowOpenSuppression,
          onRowOpenClick
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    expect(onRowOpenClick).not.toHaveBeenCalled();
    expect(clearRowOpenSuppression).toHaveBeenCalledTimes(1);
  });

  it("renders an accessible select-all checkbox in the list header and routes toggles", () => {
    const onToggleSelectAll = vi.fn();
    render(<FileListStage {...buildProps({ selectAllState: "none", onToggleSelectAll })} />);

    const selectAll = screen.getByRole("checkbox", { name: /Select all items in this folder/i });
    expect(selectAll).toBeEnabled();
    expect(selectAll).not.toBeChecked();

    fireEvent.click(selectAll);
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it("exposes mixed state for partial selections and checked state for complete selections", () => {
    const { unmount } = render(<FileListStage {...buildProps({ selectAllState: "partial" })} />);
    const mixed = screen.getByRole("checkbox", { name: /Select all items in this folder/i });
    expect(mixed).toHaveAttribute("aria-checked", "mixed");
    expect(mixed).toHaveProperty("indeterminate", true);
    unmount();

    render(<FileListStage {...buildProps({ selectAllState: "all" })} />);
    const complete = screen.getByRole("checkbox", { name: /Deselect all items in this folder/i });
    expect(complete).toBeChecked();
  });

  it("disables select-all when the capability is unavailable", () => {
    render(<FileListStage {...buildProps({ canSelectAll: false })} />);
    expect(screen.getByRole("checkbox", { name: /Select all items in this folder/i })).toBeDisabled();
  });

  it("keeps the header checkbox enabled for deselect-all when marking is unavailable", () => {
    render(<FileListStage {...buildProps({ canSelectAll: false, canDeselectAll: true, selectAllState: "all" })} />);
    expect(screen.getByRole("checkbox", { name: /Deselect all items in this folder/i })).toBeEnabled();
  });

  it("disables batch checkbox when marking is unavailable", () => {
    render(<FileListStage {...buildProps({ canMarkForBatchDownload: false })} />);
    expect(screen.getByRole("checkbox", { name: /Select Projects folder/i })).toBeDisabled();
  });

  it("forwards ref to the file list panel section", () => {
    const ref = vi.fn();
    render(<FileListStage {...buildProps()} ref={ref} />);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0]?.[0]).toHaveClass("file-list-panel");
  });
});
