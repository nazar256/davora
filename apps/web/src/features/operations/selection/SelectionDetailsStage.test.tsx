import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionDetailsStage } from "./SelectionDetailsStage";

function buildProps(overrides: Partial<ComponentProps<typeof SelectionDetailsStage>> = {}) {
  return {
    visible: true,
    content: {
      kind: "single" as const,
      item: {
        name: "report.pdf",
        displayPath: "/Projects/report.pdf",
        typeLabel: "PDF",
        modifiedLabel: "Jan 1, 2026",
        sizeLabel: "2.5 MB",
        includedInSelection: false,
        isFolder: false,
        canOpen: true,
        panelHeading: "Selected file" as const,
        ariaLabel: "Details for report.pdf"
      }
    },
    showMobileBatchBar: false,
    showMobileSelectionSheet: false,
    mobileSheetDetailsExpanded: false,
    offline: false,
    mutationBusy: false,
    canDownloadSelected: true,
    canSyncSelectedOffline: true,
    selectedIsFavourite: false,
    selectedFavouriteActionLabel: "Add to Favourites",
    canMoveSelected: true,
    canCopySelected: true,
    canDeleteSelected: true,
    canDownloadBatchSelection: false,
    canSyncBatchOffline: false,
    canCopyMoveBatchSelection: false,
    canDeleteBatchSelection: false,
    selectAllState: "none" as const,
    canSelectAll: true,
    canDeselectAll: false,
    onToggleSelectAll: vi.fn(),
    onOpenSelected: vi.fn(),
    onDownloadSelected: vi.fn(),
    onKeepOfflineSelected: vi.fn(),
    onToggleFavourite: vi.fn(),
    onFolderShortcut: vi.fn(),
    onToggleMobileSheetDetails: vi.fn(),
    onRenameSelected: vi.fn(),
    onCopyMoveSelected: vi.fn(),
    onDeleteSelected: vi.fn(),
    onDownloadBatchSelection: vi.fn(),
    onKeepOfflineBatchSelection: vi.fn(),
    onCopyMoveBatchSelection: vi.fn(),
    onDeleteBatchSelection: vi.fn(),
    onClearBatchSelection: vi.fn(),
    onCloseMobileSelectionSheet: vi.fn(),
    onCollapseMobileSheetDetails: vi.fn(),
    ...overrides
  };
}

describe("SelectionDetailsStage", () => {
  afterEach(cleanup);

  it("renders nothing when hidden with no details or batch chrome", () => {
    const { container } = render(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: false
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows single-item metadata and action enablement from props", () => {
    const onDownloadSelected = vi.fn();
    render(
      <SelectionDetailsStage
        {...buildProps({
          onDownloadSelected,
          canDownloadSelected: true,
          canMoveSelected: false,
          canCopySelected: false,
          canDeleteSelected: false,
          mutationBusy: true
        })}
      />
    );

    const panel = screen.getByLabelText(/Details for report\.pdf/i);
    expect(within(panel).getByRole("heading", { level: 2, name: "Selected file" })).toBeInTheDocument();
    expect(within(panel).getByText("report.pdf")).toBeInTheDocument();
    expect(within(panel).getAllByText("/Projects/report.pdf")).toHaveLength(2);
    expect(within(panel).getByText("PDF")).toBeInTheDocument();
    expect(within(panel).getByText("Jan 1, 2026")).toBeInTheDocument();
    expect(within(panel).getByText("2.5 MB")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /^Download$/i }));
    expect(onDownloadSelected).toHaveBeenCalledTimes(1);
    expect(within(panel).getByRole("button", { name: /Rename or move/i })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /Copy or move/i })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /^Delete$/i })).toBeDisabled();
  });

  it("shows batch summary counts and selection actions from props", () => {
    const onDeleteBatchSelection = vi.fn();
    render(
      <SelectionDetailsStage
        {...buildProps({
          content: {
            kind: "batch",
            batch: {
              count: 3,
              countLabel: "3 items selected",
              selectionLabel: "2 files and 1 folder",
              fileCount: 2,
              folderCount: 1,
              sizeLabel: "4.2 MB known",
              ariaLabel: "Selection details for 3 items"
            }
          },
          canDownloadBatchSelection: true,
          canSyncBatchOffline: false,
          canCopyMoveBatchSelection: true,
          canDeleteBatchSelection: true,
          onDeleteBatchSelection
        })}
      />
    );

    const panel = screen.getByLabelText(/Selection details for 3 items/i);
    expect(within(panel).getByRole("heading", { level: 2, name: "Selection" })).toBeInTheDocument();
    expect(within(panel).getByText("3 items selected")).toBeInTheDocument();
    expect(within(panel).getByText("2 files and 1 folder")).toBeInTheDocument();
    const metadata = panel.querySelector(".context-metadata");
    expect(metadata).toBeInstanceOf(HTMLElement);
    if (!(metadata instanceof HTMLElement)) {
      return;
    }
    expect(within(metadata).getByText("2")).toBeInTheDocument();
    expect(within(metadata).getByText("1")).toBeInTheDocument();
    expect(within(panel).getByText("4.2 MB known")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /Delete selected/i }));
    expect(onDeleteBatchSelection).toHaveBeenCalledTimes(1);
    expect(within(panel).getByRole("button", { name: /Keep offline/i })).toBeDisabled();
  });

  it("keeps batch copy and delete actions independently disabled while busy", () => {
    const copyMoveBatch = vi.fn();
    const deleteBatch = vi.fn();
    render(
      <SelectionDetailsStage
        {...buildProps({
          content: {
            kind: "batch",
            batch: {
              count: 2,
              countLabel: "2 items selected",
              selectionLabel: "2 files",
              fileCount: 2,
              folderCount: 0,
              sizeLabel: "8 B",
              ariaLabel: "Selection details for 2 items"
            }
          },
          mutationBusy: true,
          canCopyMoveBatchSelection: true,
          canDeleteBatchSelection: true,
          onCopyMoveBatchSelection: copyMoveBatch,
          onDeleteBatchSelection: deleteBatch
        })}
      />
    );

    const panel = screen.getByLabelText(/Selection details for 2 items/i);
    expect(within(panel).getByRole("button", { name: /Copy or move selected/i })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /Delete selected/i })).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: /Copy or move selected/i }));
    fireEvent.click(within(panel).getByRole("button", { name: /Delete selected/i }));
    expect(copyMoveBatch).not.toHaveBeenCalled();
    expect(deleteBatch).not.toHaveBeenCalled();
  });

  it("shows empty-workspace summary metadata from props", () => {
    render(
      <SelectionDetailsStage
        {...buildProps({
          content: {
            kind: "workspace",
            workspace: {
              folderLabel: "Plans",
              locationLabel: "/Projects/Plans",
              itemsLabel: "5 items",
              itemsHeading: "Items",
              searchActive: true,
              searchQuery: "budget",
              modeLabel: "Online",
              staleInfo: "Cached 5 minutes ago"
            }
          }
        })}
      />
    );

    const panel = screen.getByLabelText(/Workspace details/i);
    expect(within(panel).getByRole("heading", { level: 2, name: "Workspace details" })).toBeInTheDocument();
    expect(within(panel).getByText("Plans")).toBeInTheDocument();
    expect(within(panel).getByText("/Projects/Plans")).toBeInTheDocument();
    expect(within(panel).getByText("5 items")).toBeInTheDocument();
    expect(within(panel).getByText("budget")).toBeInTheDocument();
    expect(within(panel).getByText("Online")).toBeInTheDocument();
    expect(within(panel).getByText("Cached 5 minutes ago")).toBeInTheDocument();
  });

  it("shows the narrow mobile batch bar when batch selection is active and the sheet is closed", () => {
    render(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: true,
          content: {
            kind: "batch",
            batch: {
              count: 2,
              countLabel: "2 items selected",
              selectionLabel: "2 files",
              fileCount: 2,
              folderCount: 0,
              sizeLabel: "1.0 MB known",
              ariaLabel: "Selection details for 2 items"
            }
          },
          canDownloadBatchSelection: true,
          canDeleteBatchSelection: true
        })}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: /Selection actions/i });
    expect(within(toolbar).getByText("2 items selected")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /Download/i })).toBeEnabled();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("renders a state-aware select-all action in the mobile batch bar", () => {
    const onToggleSelectAll = vi.fn();
    const batchContent = {
      kind: "batch" as const,
      batch: {
        count: 2,
        countLabel: "2 items selected",
        selectionLabel: "2 files",
        fileCount: 2,
        folderCount: 0,
        sizeLabel: "1.0 MB known",
        ariaLabel: "Selection details for 2 items"
      }
    };
    const { rerender } = render(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: true,
          content: batchContent,
          selectAllState: "partial",
          onToggleSelectAll
        })}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: /Selection actions/i });
    const selectAll = within(toolbar).getByRole("button", { name: /^Select all$/i });
    expect(selectAll).toBeEnabled();
    expect(selectAll).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(selectAll);
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);

    rerender(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: true,
          content: batchContent,
          selectAllState: "all",
          onToggleSelectAll
        })}
      />
    );
    const deselectAll = within(toolbar).getByRole("button", { name: /^Deselect all$/i });
    expect(deselectAll).toHaveAttribute("aria-pressed", "true");

    rerender(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: true,
          content: batchContent,
          selectAllState: "partial",
          canSelectAll: false,
          onToggleSelectAll
        })}
      />
    );
    expect(within(toolbar).getByRole("button", { name: /^Select all$/i })).toBeDisabled();

    rerender(
      <SelectionDetailsStage
        {...buildProps({
          visible: false,
          showMobileBatchBar: true,
          content: batchContent,
          selectAllState: "all",
          canSelectAll: false,
          canDeselectAll: true,
          onToggleSelectAll
        })}
      />
    );
    expect(within(toolbar).getByRole("button", { name: /^Deselect all$/i })).toBeEnabled();
  });

  it("projects mobile sheet classes, backdrop, and details toggle from props", () => {
    const onToggleMobileSheetDetails = vi.fn();
    const onCloseMobileSelectionSheet = vi.fn();
    const onCollapseMobileSheetDetails = vi.fn();
    const { rerender } = render(
      <SelectionDetailsStage
        {...buildProps({
          showMobileSelectionSheet: true,
          mobileSheetDetailsExpanded: false,
          onToggleMobileSheetDetails,
          onCloseMobileSelectionSheet,
          onCollapseMobileSheetDetails
        })}
      />
    );

    const panel = screen.getByRole("region", { name: /Details for report\.pdf/i });
    expect(panel).toHaveClass("details-panel-sheet-open");
    expect(panel).not.toHaveClass("details-panel-sheet-details-open");
    expect(panel).toHaveAttribute("data-mobile-hidden", "false");
    expect(screen.getByRole("button", { name: /Dismiss item actions/i })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /View details/i }));
    expect(onToggleMobileSheetDetails).toHaveBeenCalledTimes(1);

    rerender(
      <SelectionDetailsStage
        {...buildProps({
          showMobileSelectionSheet: true,
          mobileSheetDetailsExpanded: true,
          onToggleMobileSheetDetails,
          onCloseMobileSelectionSheet,
          onCollapseMobileSheetDetails
        })}
      />
    );

    expect(panel).toHaveClass("details-panel-sheet-details-open");
    fireEvent.click(within(panel).getByRole("button", { name: /Back to actions/i }));
    expect(onToggleMobileSheetDetails).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Close item actions/i }));
    expect(onCloseMobileSelectionSheet).toHaveBeenCalledTimes(1);
  });

  it("uses the same close command for the mobile scrim and sheet close button", () => {
    const onCloseMobileSelectionSheet = vi.fn();
    render(
      <SelectionDetailsStage
        {...buildProps({
          showMobileSelectionSheet: true,
          onCloseMobileSelectionSheet
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Dismiss item actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Close item actions/i }));

    expect(onCloseMobileSelectionSheet).toHaveBeenCalledTimes(2);
  });

  it("projects favourite aria-pressed state and fires clear and action events", () => {
    const onToggleFavourite = vi.fn();
    const onClearBatchSelection = vi.fn();
    const { rerender } = render(
      <SelectionDetailsStage
        {...buildProps({
          selectedIsFavourite: true,
          selectedFavouriteActionLabel: "Remove from Favourites",
          onToggleFavourite
        })}
      />
    );

    const panel = screen.getByLabelText(/Details for report\.pdf/i);
    const favouriteButton = within(panel).getByRole("button", { name: /Remove from Favourites/i });
    expect(favouriteButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(favouriteButton);
    expect(onToggleFavourite).toHaveBeenCalledTimes(1);

    rerender(
      <SelectionDetailsStage
        {...buildProps({
          content: {
            kind: "batch",
            batch: {
              count: 1,
              countLabel: "1 item selected",
              selectionLabel: "1 file",
              fileCount: 1,
              folderCount: 0,
              sizeLabel: "10 KB known",
              ariaLabel: "Selection details for 1 item"
            }
          },
          onClearBatchSelection
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear selection/i }));
    expect(onClearBatchSelection).toHaveBeenCalledTimes(1);
  });
});
