import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfflineSyncConfirmStage } from "./OfflineSyncConfirmStage";

function buildProps(overrides: Partial<ComponentProps<typeof OfflineSyncConfirmStage>> = {}) {
  return {
    open: true,
    busy: false,
    estimating: false,
    selectionLabel: "roadmap.txt",
    includesFolders: false,
    filesLabel: "1",
    storageLabel: "128 B",
    canStart: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides
  };
}

describe("OfflineSyncConfirmStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<OfflineSyncConfirmStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows estimating copy and keeps Start sync enabled", () => {
    render(
      <OfflineSyncConfirmStage
        {...buildProps({
          estimating: true,
          filesLabel: "Calculating…",
          storageLabel: "Calculating…"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByText("Offline sync")).toBeInTheDocument();
    expect(within(dialog).getByText(/local device storage and does not create a server-side copy/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/excluded from normal automatic cache eviction/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText("Calculating…", { selector: "dd" })).toHaveLength(2);
    expect(within(dialog).getByText(/size keeps calculating in the background/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Start sync/i })).toBeEnabled();
  });

  it("shows ready file count and estimated storage", () => {
    render(
      <OfflineSyncConfirmStage
        {...buildProps({
          filesLabel: "3",
          storageLabel: "4.5 KB"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByText("4.5 KB", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Start sync/i })).toBeEnabled();
  });

  it("shows unknown storage labels and an estimate error banner", () => {
    render(
      <OfflineSyncConfirmStage
        {...buildProps({
          filesLabel: "2",
          storageLabel: "Unknown",
          estimateError: "Folder size unavailable"
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText("Unknown", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Storage size could not be calculated exactly: Folder size unavailable/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Start sync/i })).toBeEnabled();
  });

  it("renders singular selection name and recursive folder copy", () => {
    render(
      <OfflineSyncConfirmStage
        {...buildProps({
          selectionLabel: "Projects",
          includesFolders: true
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText("Projects", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByText("Synced recursively", { selector: "dd" })).toBeInTheDocument();
  });

  it("renders plural selection label and no-folder copy", () => {
    render(
      <OfflineSyncConfirmStage
        {...buildProps({
          selectionLabel: "2 items",
          includesFolders: false
        })}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText("2 items", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByText("None selected", { selector: "dd" })).toBeInTheDocument();
  });

  it("disables dismiss actions and Start sync while busy", () => {
    render(<OfflineSyncConfirmStage {...buildProps({ busy: true })} />);

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByRole("button", { name: /Close keep offline confirmation/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Cancel/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Starting…/i })).toBeDisabled();
  });

  it("disables Start sync when keep-offline policy blocks it", () => {
    render(<OfflineSyncConfirmStage {...buildProps({ canStart: false })} />);
    expect(within(screen.getByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i })).toBeDisabled();
  });

  it("emits confirm and cancel without side effects", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(<OfflineSyncConfirmStage {...buildProps({ onClose, onConfirm })} />);

    const dialog = screen.getByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    onClose.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses on scrim click when not busy", () => {
    const onClose = vi.fn();
    const { container } = render(<OfflineSyncConfirmStage {...buildProps({ onClose })} />);

    fireEvent.click(container.querySelector(".modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on scrim click while busy", () => {
    const onClose = vi.fn();
    const { container } = render(<OfflineSyncConfirmStage {...buildProps({ busy: true, onClose })} />);

    fireEvent.click(container.querySelector(".modal-scrim")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not dismiss when clicking inside the dialog card", () => {
    const onClose = vi.fn();
    render(<OfflineSyncConfirmStage {...buildProps({ onClose })} />);

    fireEvent.click(screen.getByRole("dialog", { name: /Keep offline confirmation/i }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
