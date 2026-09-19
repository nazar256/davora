import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderShortcutStage } from "./FolderShortcutStage";

function buildProps(overrides: Partial<ComponentProps<typeof FolderShortcutStage>> = {}) {
  return {
    open: true,
    folderName: "Plans",
    displayPath: "/Projects/Plans",
    accountName: "Alpha Cloud",
    link: "https://davora.example/?path=Projects%2FPlans&account=account-alpha",
    linkCopied: false,
    manualHint: "Manual hint text.",
    appShortcutEnabled: false,
    installState: "idle" as const,
    onCopyLink: vi.fn(),
    onInstallAsApp: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe("FolderShortcutStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<FolderShortcutStage {...buildProps({ open: false })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the folder identity, deep link, and manual hint", () => {
    render(<FolderShortcutStage {...buildProps()} />);

    expect(screen.getByRole("dialog", { name: "Folder shortcut" })).toBeInTheDocument();
    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(screen.getByText("/Projects/Plans")).toBeInTheDocument();
    expect(screen.getByText("Alpha Cloud")).toBeInTheDocument();
    expect(screen.getByLabelText("Folder link")).toHaveValue(
      "https://davora.example/?path=Projects%2FPlans&account=account-alpha"
    );
    expect(screen.getByText("Manual hint text.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shortcut as app" })).not.toBeInTheDocument();
  });

  it("routes copy and close intents", () => {
    const props = buildProps();
    render(<FolderShortcutStage {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy folder link" }));
    expect(props.onCopyLink).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the copied confirmation only after a successful copy", () => {
    const { rerender } = render(<FolderShortcutStage {...buildProps()} />);
    expect(screen.queryByText("Link copied to the clipboard.")).not.toBeInTheDocument();

    rerender(<FolderShortcutStage {...buildProps({ linkCopied: true })} />);
    expect(screen.getByText("Link copied to the clipboard.")).toBeInTheDocument();
  });

  it("exposes the experimental app install only when enabled and routes its intent", () => {
    const props = buildProps({ appShortcutEnabled: true });
    render(<FolderShortcutStage {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Shortcut as app" }));
    expect(props.onInstallAsApp).toHaveBeenCalledTimes(1);
  });

  it("disables the app install button while a request is in flight", () => {
    render(<FolderShortcutStage {...buildProps({ appShortcutEnabled: true, installState: "requesting" })} />);

    expect(screen.getByRole("button", { name: "Shortcut as app" })).toBeDisabled();
    expect(screen.getByText("Waiting for the browser install prompt…")).toBeInTheDocument();
  });

  it("surfaces unavailable install feedback inside the dialog", () => {
    render(<FolderShortcutStage {...buildProps({ appShortcutEnabled: true, installState: "unavailable" })} />);

    expect(screen.getByText("Install is not available in this browser.")).toBeInTheDocument();
  });

  it("dismisses on scrim click but not on dialog content click", () => {
    const props = buildProps();
    const { container } = render(<FolderShortcutStage {...props} />);
    const scrim = container.querySelector(".modal-scrim");
    const dialog = screen.getByRole("dialog");

    fireEvent.click(dialog);
    expect(props.onClose).not.toHaveBeenCalled();

    if (scrim) {
      fireEvent.click(scrim);
    }
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
