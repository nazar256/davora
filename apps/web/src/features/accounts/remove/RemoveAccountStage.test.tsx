import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoveAccountStage } from "./RemoveAccountStage";

function preventDefaultSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function buildProps(overrides: Partial<ComponentProps<typeof RemoveAccountStage>> = {}) {
  return {
    open: true,
    accountLabel: "Personal cloud",
    confirmation: "",
    busy: false,
    onConfirmationChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(preventDefaultSubmit),
    ...overrides
  };
}

describe("RemoveAccountStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<RemoveAccountStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders account label, empty confirmation field, and danger submit", () => {
    render(<RemoveAccountStage {...buildProps()} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByRole("heading", { name: /Remove account/i })).toBeInTheDocument();
    expect(within(dialog).getByText("Personal cloud", { selector: "strong" })).toBeInTheDocument();
    expect(dialog.querySelector(".dialog-copy")).toHaveTextContent(
      "Remove Personal cloud from Davora and clear its saved data on this device. Your Nextcloud files stay unchanged."
    );
    const details = dialog.querySelector("details.account-removal-details");
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toHaveAttribute("aria-label", "Account removal details");
    expect(within(dialog).getByLabelText(/Account label to confirm/i)).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: /^Remove account$/i })).toHaveClass("button-danger");
  });

  it("explains saved-password removal separately from provider revocation", () => {
    render(<RemoveAccountStage {...buildProps()} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    fireEvent.click(dialog.querySelector("details.account-removal-details summary")!);

    expect(within(dialog).getByText("This deletes Davora’s saved app password. Revoke the app password in Nextcloud Security to disable it there too.")).toBeInTheDocument();
  });

  it("emits confirmation changes and submit without removal side effects", () => {
    const onConfirmationChange = vi.fn();
    const onSubmit = vi.fn(preventDefaultSubmit);

    render(<RemoveAccountStage {...buildProps({ onConfirmationChange, onSubmit })} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    fireEvent.change(within(dialog).getByLabelText(/Account label to confirm/i), { target: { value: "Personal cloud" } });
    expect(onConfirmationChange).toHaveBeenCalledWith("Personal cloud");

    fireEvent.submit(dialog.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("emits submit even when confirmation does not match the account label", () => {
    const onSubmit = vi.fn(preventDefaultSubmit);

    render(<RemoveAccountStage {...buildProps({ confirmation: "wrong label", onSubmit })} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables confirmation input and submit while busy", () => {
    render(<RemoveAccountStage {...buildProps({ busy: true, confirmation: "Personal cloud" })} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    expect(within(dialog).getByLabelText(/Account label to confirm/i)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Remove account$/i })).toBeDisabled();
  });

  it("shows an error banner when provided", () => {
    render(<RemoveAccountStage {...buildProps({ error: "Type the active account label exactly to remove it." })} />);
    expect(screen.getByText("Type the active account label exactly to remove it.")).toHaveClass("banner-state", "error");
  });

  it("dismisses on cancel and scrim click only", () => {
    const onClose = vi.fn();
    const { container } = render(<RemoveAccountStage {...buildProps({ onClose })} />);

    const dialog = screen.getByRole("dialog", { name: /Remove Personal cloud/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(container.querySelector(".modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
