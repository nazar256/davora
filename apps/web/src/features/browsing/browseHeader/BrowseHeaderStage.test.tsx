import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BreadcrumbItem } from "../presentation";
import { BrowseHeaderStage } from "./BrowseHeaderStage";

const ROOT_BREADCRUMB: BreadcrumbItem = { label: "Home", ariaLabel: "Go to home folder", value: "" };
const PROJECT_BREADCRUMBS: readonly BreadcrumbItem[] = [
  ROOT_BREADCRUMB,
  { label: "Projects", ariaLabel: "Go to /Projects", value: "Projects" },
  { label: "Plans", ariaLabel: "Go to /Projects/Plans", value: "Projects/Plans" }
];

function buildProps(overrides: Partial<ComponentProps<typeof BrowseHeaderStage>> = {}) {
  return {
    currentFolderLabel: "Plans",
    browseStatusLabel: "3 items in /Projects/Plans",
    currentPath: "Projects/Plans",
    breadcrumbs: PROJECT_BREADCRUMBS,
    showBreadcrumbs: true,
    searchActive: false,
    searchQuery: "",
    status: "Ready",
    cacheOnlyMode: false,
    refreshingFolder: false,
    staleFolder: false,
    canDownloadBatchSelection: false,
    canSyncBatchOffline: false,
    canCopyMoveBatchSelection: false,
    canDeleteBatchSelection: false,
    mutationBusy: false,
    fileSizeDisplayMode: "human" as const,
    sortMode: "name-asc" as const,
    sortReset: {
      confirming: false,
      count: 0,
      request: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn()
    },
    canCreateFolder: true,
    canUploadFiles: true,
    canUploadFolders: true,
    folderDropActive: false,
    currentLocationLabel: "/Projects/Plans",
    onNavigateToPath: vi.fn(),
    onClearSearch: vi.fn(),
    onDownloadSelection: vi.fn(),
    onKeepOfflineSelection: vi.fn(),
    onCopyMoveSelection: vi.fn(),
    onDeleteSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onFileSizeDisplayModeChange: vi.fn(),
    onSortModeChange: vi.fn(),
    onCreateFolder: vi.fn(),
    onUploadFiles: vi.fn(),
    directoryUploadInputRef: vi.fn(),
    ...overrides
  };
}

describe("BrowseHeaderStage", () => {
  afterEach(cleanup);

  it("invokes onNavigateToPath when a breadcrumb segment is clicked", () => {
    const onNavigateToPath = vi.fn();
    render(<BrowseHeaderStage {...buildProps({ onNavigateToPath })} />);

    const breadcrumbs = screen.getByRole("navigation", { name: /Breadcrumbs/i });
    fireEvent.click(within(breadcrumbs).getByRole("button", { name: "Go to /Projects" }));

    expect(onNavigateToPath).toHaveBeenCalledWith("Projects");
  });

  it("uses Home/root vocabulary from props without rendering breadcrumbs at root", () => {
    const { rerender } = render(
      <BrowseHeaderStage
        {...buildProps({
          currentFolderLabel: "Home",
          currentPath: "",
          breadcrumbs: [ROOT_BREADCRUMB],
          showBreadcrumbs: false,
          browseStatusLabel: "0 items in /"
        })}
      />
    );

    expect(screen.getByRole("heading", { level: 2, name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Breadcrumbs/i })).not.toBeInTheDocument();

    rerender(<BrowseHeaderStage {...buildProps()} />);
    const breadcrumbs = screen.getByRole("navigation", { name: /Breadcrumbs/i });
    expect(within(breadcrumbs).getByRole("button", { name: /Go to home folder/i })).toBeInTheDocument();
    expect(within(breadcrumbs).queryByText("Home")).not.toBeInTheDocument();
  });

  it("projects disabled state onto create-folder and upload controls from props", () => {
    render(
      <BrowseHeaderStage
        {...buildProps({
          canCreateFolder: false,
          canUploadFiles: false,
          canUploadFolders: false,
          mutationBusy: true
        })}
      />
    );

    expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(screen.getByLabelText(/Upload files/i)).toBeDisabled();
    expect(screen.getByLabelText(/Upload folder/i)).toBeDisabled();
  });

  it("keeps batch mutation actions independently gated by capability and busy state", () => {
    const copyMove = vi.fn();
    const deleteSelection = vi.fn();
    render(
      <BrowseHeaderStage
        {...buildProps({
          selectionSummaryLabel: "2 items selected",
          canCopyMoveBatchSelection: false,
          canDeleteBatchSelection: true,
          onCopyMoveSelection: copyMove,
          onDeleteSelection: deleteSelection
        })}
      />
    );

    const selectionRow = document.querySelector<HTMLElement>(".browse-selection-row");
    expect(selectionRow).not.toBeNull();
    if (!selectionRow) return;
    const copyButton = within(selectionRow).getByRole("button", { name: /Copy or move selected/i });
    const deleteButton = within(selectionRow).getByRole("button", { name: /Delete selected/i });
    expect(copyButton).toBeDisabled();
    expect(deleteButton).toBeEnabled();
    fireEvent.click(copyButton);
    fireEvent.click(deleteButton);
    expect(copyMove).not.toHaveBeenCalled();
    expect(deleteSelection).toHaveBeenCalledTimes(1);

    cleanup();
    const busyCopyMove = vi.fn();
    const busyDeleteSelection = vi.fn();
    render(
      <BrowseHeaderStage
        {...buildProps({
          selectionSummaryLabel: "2 items selected",
          canCopyMoveBatchSelection: true,
          canDeleteBatchSelection: true,
          mutationBusy: true,
          onCopyMoveSelection: busyCopyMove,
          onDeleteSelection: busyDeleteSelection
        })}
      />
    );
    expect(screen.getByRole("button", { name: /Copy or move selected/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete selected/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Copy or move selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /Delete selected/i }));
    expect(busyCopyMove).not.toHaveBeenCalled();
    expect(busyDeleteSelection).not.toHaveBeenCalled();
  });

  it("shows a clear-search affordance when search is active", () => {
    const onClearSearch = vi.fn();
    const { container, rerender } = render(
      <BrowseHeaderStage {...buildProps({ searchActive: false, onClearSearch })} />
    );
    expect(screen.queryByRole("button", { name: /Clear search/i })).not.toBeInTheDocument();
    expect(container.querySelector(".browse-context-row")).toBeNull();

    rerender(
      <BrowseHeaderStage
        {...buildProps({ searchActive: true, onClearSearch })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear search/i }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      canUploadFolders: true,
      canUploadFiles: true,
      cacheOnlyMode: false,
      currentLocationLabel: "/Projects",
      expected: /drag and drop files anywhere in this folder view, or use Upload folder to keep directory structure under \/Projects/i
    },
    {
      canUploadFolders: false,
      canUploadFiles: true,
      cacheOnlyMode: false,
      currentLocationLabel: "/Projects",
      expected: /drag and drop files anywhere in this folder view to upload them under \/Projects/i
    },
    {
      canUploadFolders: false,
      canUploadFiles: false,
      cacheOnlyMode: true,
      currentLocationLabel: "/Projects",
      expected: /Uploads are unavailable while cached-shell mode is active/i
    },
    {
      canUploadFolders: false,
      canUploadFiles: false,
      cacheOnlyMode: false,
      currentLocationLabel: "/Projects",
      expected: /Uploads are unavailable when this account is read-only/i
    }
  ])("renders upload tip variant $expected", ({ expected, ...tipProps }) => {
    render(<BrowseHeaderStage {...buildProps(tipProps)} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders a desktop reset control beside the sort field with two-step inline confirmation", () => {
    const request = vi.fn();
    const confirm = vi.fn();
    const cancel = vi.fn();
    const { rerender } = render(
      <BrowseHeaderStage
        {...buildProps({
          sortReset: { confirming: false, count: 4, request, confirm, cancel }
        })}
      />
    );

    const resetButton = screen.getByRole("button", { name: "Reset saved folder sort settings" });
    expect(resetButton).not.toBeDisabled();
    fireEvent.click(resetButton);
    expect(request).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();

    rerender(
      <BrowseHeaderStage
        {...buildProps({
          sortReset: { confirming: true, count: 4, request, confirm, cancel }
        })}
      />
    );

    const confirmGroup = screen.getByRole("group", { name: "Confirm clearing folder sort settings" });
    expect(within(confirmGroup).getByText("Clear saved sort for 4 folders?")).toBeInTheDocument();
    fireEvent.click(within(confirmGroup).getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(confirmGroup).getByRole("button", { name: "Clear" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("disables the desktop reset control when no folder sort overrides exist", () => {
    const request = vi.fn();
    render(
      <BrowseHeaderStage
        {...buildProps({
          sortReset: { confirming: false, count: 0, request, confirm: vi.fn(), cancel: vi.fn() }
        })}
      />
    );

    const resetButton = screen.getByRole("button", { name: "Reset saved folder sort settings" });
    expect(resetButton).toBeDisabled();
    fireEvent.click(resetButton);
    expect(request).not.toHaveBeenCalled();
  });
});
