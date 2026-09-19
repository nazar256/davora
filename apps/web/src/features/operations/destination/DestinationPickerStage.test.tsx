import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFileEntry } from "../../../test/files";
import { DestinationPickerStage } from "./DestinationPickerStage";

function buildProps(overrides: Partial<ComponentProps<typeof DestinationPickerStage>> = {}) {
  const sourceEntry = buildFileEntry("Projects/report.txt");
  return {
    open: true,
    kind: "copyMove" as const,
    sourceEntries: [sourceEntry],
    batch: false,
    folderPath: "Projects",
    entries: [
      buildFileEntry("Projects/Archive", { isFolder: true }),
      buildFileEntry("Projects/report.txt")
    ],
    name: "report.txt",
    manualPath: "",
    manualMode: false,
    busy: false,
    copyAllowed: true,
    moveAllowed: true,
    loading: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onFolderChange: vi.fn(),
    onNameChange: vi.fn(),
    onManualModeChange: vi.fn(),
    onManualPathChange: vi.fn(),
    onReload: vi.fn(),
    ...overrides
  };
}

describe("DestinationPickerStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<DestinationPickerStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows copy, move, and batch titles from props", () => {
    const { rerender } = render(<DestinationPickerStage {...buildProps({ kind: "copyMove" })} />);
    const dialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("tabindex", "-1");

    rerender(<DestinationPickerStage {...buildProps({ kind: "copy" })} />);
    expect(screen.getByRole("dialog", { name: /^Copy item$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy here/i })).toBeInTheDocument();

    rerender(<DestinationPickerStage {...buildProps({ kind: "move" })} />);
    expect(screen.getByRole("dialog", { name: /^Move item$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move here/i })).toBeInTheDocument();

    rerender(
      <DestinationPickerStage
        {...buildProps({
          kind: "copyMove",
          batch: true,
          sourceEntries: [
            buildFileEntry("Projects/a.txt"),
            buildFileEntry("Projects/b.txt")
          ]
        })}
      />
    );
    expect(screen.getByRole("dialog", { name: /Copy or move 2 items/i })).toBeInTheDocument();
    expect(screen.getByText("2 selected items")).toBeInTheDocument();
    expect(screen.getByText("Projects/a.txt, Projects/b.txt")).toBeInTheDocument();
  });

  it("emits folder and breadcrumb navigation events", () => {
    const onFolderChange = vi.fn();
    render(
      <DestinationPickerStage
        {...buildProps({
          folderPath: "Projects/Archive",
          onFolderChange
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive/i }));
    expect(onFolderChange).toHaveBeenCalledWith("Projects/Archive");

    const breadcrumbs = within(dialog).getByRole("navigation", { name: /Destination folder path/i });
    fireEvent.click(within(breadcrumbs).getByRole("button", { name: /Go to home folder/i }));
    expect(onFolderChange).toHaveBeenCalledWith("");
  });

  it("exposes destination folder actions as a named control group", () => {
    render(<DestinationPickerStage {...buildProps()} />);

    const folderGroup = screen.getByRole("group", { name: "Destination folders" });
    expect(within(folderGroup).getByRole("button", { name: /Open destination folder Archive/i })).toBeInTheDocument();
  });

  it("projects empty and error states from props", () => {
    const { rerender } = render(
      <DestinationPickerStage
        {...buildProps({
          entries: [],
          loading: false
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    expect(within(dialog).getByText("No folders in this destination.")).toBeInTheDocument();

    rerender(
      <DestinationPickerStage
        {...buildProps({
          loading: true
        })}
      />
    );
    expect(within(dialog).getByText("Loading folders...")).toBeInTheDocument();

    rerender(
      <DestinationPickerStage
        {...buildProps({
          error: "Could not load destination folders.",
          actionError: "Copy failed.",
          validationMessage: "Destination already contains report.txt."
        })}
      />
    );
    expect(within(dialog).getByText("Could not load destination folders.")).toBeInTheDocument();
    expect(within(dialog).getByText("Copy failed.")).toBeInTheDocument();
    expect(within(dialog).getByText("Destination already contains report.txt.")).toBeInTheDocument();
  });

  it("toggles manual path mode and emits path changes", () => {
    const onManualModeChange = vi.fn();
    const onManualPathChange = vi.fn();
    const { rerender } = render(
      <DestinationPickerStage
        {...buildProps({
          onManualModeChange,
          onManualPathChange
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Manual path/i }));
    expect(onManualModeChange).toHaveBeenCalledWith(true);
    expect(within(dialog).queryByLabelText(/Full destination path/i)).not.toBeInTheDocument();

    rerender(
      <DestinationPickerStage
        {...buildProps({
          manualMode: true,
          manualPath: "Projects/Archive/report.txt",
          onManualPathChange
        })}
      />
    );
    const manualDialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    const manualInput = within(manualDialog).getByLabelText(/Full destination path/i);
    expect(manualInput).toHaveValue("Projects/Archive/report.txt");
    fireEvent.change(manualInput, { target: { value: "Projects/manual.txt" } });
    expect(onManualPathChange).toHaveBeenCalledWith("Projects/manual.txt");

    rerender(
      <DestinationPickerStage
        {...buildProps({
          batch: true,
          manualMode: true,
          manualPath: "Projects/Archive"
        })}
      />
    );
    expect(screen.getByLabelText(/Full destination folder path/i)).toBeInTheDocument();
  });

  it("disables confirm actions when the target is invalid", () => {
    render(
      <DestinationPickerStage
        {...buildProps({
          kind: "copyMove",
          validationMessage: "Destination already contains report.txt."
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Copy or move item/i });
    expect(within(dialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Move here/i })).toBeDisabled();
  });

  it("emits confirm and cancel events without performing mutations", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <DestinationPickerStage
        {...buildProps({
          kind: "copy",
          onSubmit,
          onClose
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /^Copy item$/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Copy here/i }));
    expect(onSubmit).toHaveBeenCalledWith("copy");
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
